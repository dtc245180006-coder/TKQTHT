module.exports = async function migrate(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(80462026)');
    await client.query('CREATE TABLE IF NOT EXISTS app_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const exists = await client.query("SELECT 1 FROM app_migrations WHERE id='booking_lifecycle_v1'");
    if (!exists.rowCount) {
      await client.query(`
        INSERT INTO customers (name,phone,email)
        SELECT DISTINCT ON (lower(customer_email)) customer_name,customer_phone,lower(customer_email)
        FROM bookings ORDER BY lower(customer_email),id DESC ON CONFLICT (email) DO NOTHING;
        UPDATE bookings b SET customer_id=c.id FROM customers c WHERE lower(b.customer_email)=c.email AND b.customer_id IS NULL;
        ALTER TABLE bookings ADD COLUMN guest_count INTEGER NOT NULL DEFAULT 1 CHECK (guest_count BETWEEN 1 AND 50);
        ALTER TABLE bookings ADD COLUMN checked_in_at TIMESTAMPTZ;
        ALTER TABLE bookings ADD COLUMN checked_out_at TIMESTAMPTZ;
        ALTER TABLE bookings ADD CONSTRAINT booking_status_valid CHECK (status IN ('confirmed','checked_in','checked_out','cancelled'));
        ALTER TABLE bookings ADD CONSTRAINT booking_dates_valid CHECK (check_out_date > check_in_date);
        DROP INDEX IF EXISTS idx_bookings_room_dates;
        CREATE INDEX idx_bookings_room_dates ON bookings (room_id,check_in_date,check_out_date) WHERE status IN ('confirmed','checked_in');
        CREATE TABLE booking_payments (
          id SERIAL PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id),
          kind VARCHAR(10) NOT NULL CHECK (kind IN ('payment','refund')),
          amount NUMERIC(12,2) NOT NULL,
          method VARCHAR(20) NOT NULL CHECK (method IN ('cash','bank_transfer')),
          reference VARCHAR(200) NOT NULL DEFAULT '',
          request_key VARCHAR(36) NOT NULL,
          staff_user_id INTEGER NOT NULL, staff_name VARCHAR(120) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (booking_id,request_key),
          CHECK ((kind='payment' AND amount>0) OR (kind='refund' AND amount<0))
        );
        CREATE INDEX idx_payments_booking ON booking_payments (booking_id);
        CREATE TABLE booking_events (
          id SERIAL PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id),
          action VARCHAR(20) NOT NULL, staff_user_id INTEGER,
          staff_name VARCHAR(120) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_events_booking ON booking_events (booking_id);
        INSERT INTO app_migrations (id) VALUES ('booking_lifecycle_v1');
      `);
    }
    const holds = await client.query("SELECT 1 FROM app_migrations WHERE id='booking_public_holds_v2'");
    if (!holds.rowCount) {
      await client.query(`
        ALTER TABLE bookings ADD COLUMN hold_expires_at TIMESTAMPTZ;
        ALTER TABLE bookings ADD COLUMN confirmed_at TIMESTAMPTZ;
        ALTER TABLE bookings ADD COLUMN confirmed_by INTEGER;
        ALTER TABLE bookings ADD COLUMN contact_verified_at TIMESTAMPTZ;
        ALTER TABLE bookings DROP CONSTRAINT booking_status_valid;
        ALTER TABLE bookings ADD CONSTRAINT booking_status_valid CHECK (status IN ('pending','expired','confirmed','checked_in','checked_out','cancelled'));
        ALTER TABLE bookings ADD CONSTRAINT booking_pending_expiry CHECK (status<>'pending' OR hold_expires_at IS NOT NULL);
        DROP INDEX IF EXISTS idx_bookings_room_dates;
        CREATE INDEX idx_bookings_room_dates ON bookings (room_id,check_in_date,check_out_date) WHERE status IN ('pending','confirmed','checked_in');
        CREATE INDEX idx_bookings_hold_expiry ON bookings (hold_expires_at,room_id) WHERE status='pending';
        CREATE TABLE booking_requests (
          scope_hash CHAR(64) NOT NULL, request_key UUID NOT NULL, fingerprint CHAR(64) NOT NULL,
          booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id), is_public BOOLEAN NOT NULL,
          ip_hash CHAR(64) NOT NULL, email_hash CHAR(64) NOT NULL, phone_hash CHAR(64) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (scope_hash,request_key)
        );
        CREATE INDEX idx_request_ip ON booking_requests (ip_hash,created_at) WHERE is_public;
        CREATE INDEX idx_request_email ON booking_requests (email_hash,created_at) WHERE is_public;
        CREATE INDEX idx_request_phone ON booking_requests (phone_hash,created_at) WHERE is_public;
        INSERT INTO app_migrations (id) VALUES ('booking_public_holds_v2');
      `);
    }
    const history = await client.query("SELECT 1 FROM app_migrations WHERE id='booking_history_v3'");
    if (!history.rowCount) {
      // Old rows intentionally remain NULL: the current catalogue cannot prove past names/rates.
      await client.query(`
        ALTER TABLE bookings ADD COLUMN booking_snapshot JSONB;
        ALTER TABLE bookings DROP CONSTRAINT bookings_room_id_fkey;
        ALTER TABLE bookings ADD CONSTRAINT bookings_room_id_fkey FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE RESTRICT;
        ALTER TABLE rooms ADD CONSTRAINT room_status_valid CHECK(status IN ('available','maintenance','retired'));
        ALTER TABLE bookings ADD CONSTRAINT booking_snapshot_valid CHECK(booking_snapshot IS NULL OR COALESCE(
          jsonb_typeof(booking_snapshot)='object' AND (booking_snapshot->>'version')='1'
          AND jsonb_typeof(booking_snapshot->'room'->'name')='string'
          AND jsonb_typeof(booking_snapshot->'room'->'type')='string'
          AND (booking_snapshot->'room'->>'id')::integer=room_id
          AND (booking_snapshot->'pricing'->>'currency')='VND'
          AND (booking_snapshot->'pricing'->>'total')::numeric=total_price
          AND (booking_snapshot->'pricing'->>'nights')::integer=(check_out_date-check_in_date)
          AND (booking_snapshot->'pricing'->>'nightly_rate')::numeric>0
          AND (booking_snapshot->'pricing'->>'nightly_rate')::numeric*(check_out_date-check_in_date)=total_price
          AND jsonb_array_length(booking_snapshot->'pricing'->'items')=1
          AND (booking_snapshot->'pricing'->'items'->0->>'amount')::numeric=total_price
          AND (booking_snapshot->'pricing'->'items'->0->>'quantity')::integer=(check_out_date-check_in_date)
          AND (booking_snapshot->'pricing'->'items'->0->>'unit_price')::numeric=(booking_snapshot->'pricing'->>'nightly_rate')::numeric,
          FALSE));
        CREATE FUNCTION protect_booking_history() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP='INSERT' THEN
            IF NEW.booking_snapshot IS NULL THEN RAISE EXCEPTION 'New bookings require a historical snapshot' USING ERRCODE='23514'; END IF;
          ELSIF ROW(NEW.booking_snapshot,NEW.total_price,NEW.room_id,NEW.check_in_date,NEW.check_out_date,NEW.guest_count)
            IS DISTINCT FROM ROW(OLD.booking_snapshot,OLD.total_price,OLD.room_id,OLD.check_in_date,OLD.check_out_date,OLD.guest_count) THEN
            RAISE EXCEPTION 'Booking history is immutable; use an explicit revision workflow' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER booking_history_guard BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_history();
        INSERT INTO app_migrations(id) VALUES('booking_history_v3');
      `);
    }
    await require('./stay-migration')(client);
    await require('../finance/migration')(client);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
};
