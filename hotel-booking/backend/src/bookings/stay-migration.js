module.exports = async (client) => {
  if (
    (
      await client.query(
        "SELECT 1 FROM app_migrations WHERE id='stay_operations_v4'",
      )
    ).rowCount
  )
    return;
  await client.query(`
    ALTER TABLE rooms ADD COLUMN cleaning_status VARCHAR(20) NOT NULL DEFAULT 'dirty'
      CHECK(cleaning_status IN ('ready','dirty','cleaning'));
    ALTER TABLE rooms ALTER COLUMN cleaning_status SET DEFAULT 'ready';
    ALTER TABLE bookings DROP CONSTRAINT booking_status_valid;
    ALTER TABLE bookings ADD CONSTRAINT booking_status_valid CHECK(status IN ('pending','expired','confirmed','checked_in','checked_out','cancelled','no_show'));
    ALTER TABLE booking_events ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';
    CREATE TABLE booking_revisions (
      id BIGSERIAL PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id),
      version INTEGER NOT NULL CHECK(version>0), request_key UUID NOT NULL,
      action VARCHAR(20) NOT NULL CHECK(action IN ('move','extend','charge','void-charge')),
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
      state JSONB NOT NULL, reason VARCHAR(500) NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500), actor_user_id INTEGER NOT NULL,
      actor_name VARCHAR(120) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      fingerprint TEXT NOT NULL, delta NUMERIC(12,2) NOT NULL,
      UNIQUE(booking_id,version),UNIQUE(booking_id,request_key)
    );
    CREATE VIEW booking_current AS SELECT current_row.*,COALESCE(r.version,0) AS revision_version,
      b.booking_snapshot AS original_snapshot,b.total_price AS original_total
      FROM bookings b LEFT JOIN LATERAL
        (SELECT state,version FROM booking_revisions WHERE booking_id=b.id ORDER BY version DESC LIMIT 1) r ON TRUE
      CROSS JOIN LATERAL jsonb_populate_record(NULL::bookings,to_jsonb(b)||COALESCE(r.state,'{}')) current_row;
    CREATE FUNCTION validate_stay_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE current_booking booking_current%ROWTYPE; item jsonb; calculated numeric:=0;
    BEGIN
      PERFORM pg_advisory_xact_lock(80462060);
      SELECT * INTO current_booking FROM booking_current WHERE id=NEW.booking_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE='23503'; END IF;
      IF jsonb_typeof(NEW.state->'room_id') IS DISTINCT FROM 'number'
        OR jsonb_typeof(NEW.state->'check_out_date') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW.state->'total_price') IS DISTINCT FROM 'number'
        OR jsonb_typeof(NEW.state->'booking_snapshot'->'room'->'id') IS DISTINCT FROM 'number'
        OR jsonb_typeof(NEW.state->'booking_snapshot'->'room'->'name') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW.state->'booking_snapshot'->'room'->'type') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW.state->'booking_snapshot'->'pricing'->'total') IS DISTINCT FROM 'number'
        OR jsonb_typeof(NEW.state->'booking_snapshot'->'pricing'->'items') IS DISTINCT FROM 'array'
        OR (NEW.state->'booking_snapshot'->'pricing'->>'currency') IS DISTINCT FROM 'VND' THEN
          RAISE EXCEPTION 'Missing revision fields' USING ERRCODE='23514';
      END IF;
      IF current_booking.status NOT IN ('confirmed','checked_in') OR NEW.version<>current_booking.revision_version+1
        OR (NEW.state-ARRAY['room_id','check_out_date','total_price','booking_snapshot'])<>'{}'::jsonb
        OR NOT NEW.state ?& ARRAY['room_id','check_out_date','total_price','booking_snapshot']
        OR (NEW.state->>'room_id')::integer<>NEW.room_id
        OR (NEW.state->>'check_out_date')::date<=current_booking.check_in_date
        OR (NEW.state->>'total_price')::numeric<=0
        OR (NEW.state->>'total_price')::numeric>9999999999.99
        OR (NEW.state->>'total_price')::numeric-current_booking.total_price<>NEW.delta
        OR (NEW.state->'booking_snapshot'->'pricing'->>'total')::numeric<>(NEW.state->>'total_price')::numeric
        OR (NEW.state->'booking_snapshot'->'room'->>'id')::integer<>NEW.room_id THEN
          RAISE EXCEPTION 'Invalid stay revision' USING ERRCODE='23514';
      END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(NEW.state->'booking_snapshot'->'pricing'->'items') LOOP
        IF jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
          OR jsonb_typeof(item->'unit_price') IS DISTINCT FROM 'number'
          OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'number'
          OR (item->>'quantity')::numeric<=0
          OR (item->>'quantity')::numeric*(item->>'unit_price')::numeric<>(item->>'amount')::numeric THEN
          RAISE EXCEPTION 'Invalid revision line amount' USING ERRCODE='23514';
        END IF;
        calculated:=calculated+(item->>'amount')::numeric;
      END LOOP;
      IF calculated<>(NEW.state->>'total_price')::numeric THEN RAISE EXCEPTION 'Invalid revision total' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER stay_revision_guard BEFORE INSERT ON booking_revisions FOR EACH ROW EXECUTE FUNCTION validate_stay_revision();
    INSERT INTO app_migrations(id) VALUES('stay_operations_v4');
  `);
};
