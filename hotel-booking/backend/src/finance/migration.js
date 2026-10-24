module.exports = async (client) => {
  if (
    (
      await client.query(
        "SELECT 1 FROM app_migrations WHERE id='finance_controls_v5'",
      )
    ).rowCount
  )
    return;
  await client.query(`
    ALTER TABLE booking_payments DROP CONSTRAINT booking_payments_method_check;
    ALTER TABLE booking_payments ADD CONSTRAINT booking_payments_method_check CHECK(method IN ('cash','bank_transfer','wallet'));
    ALTER TABLE booking_payments ADD COLUMN entry_type VARCHAR(24) NOT NULL DEFAULT 'normal'
      CHECK(entry_type IN ('normal','reversal','replacement','post_refund','post_payment'));
    ALTER TABLE booking_payments ADD COLUMN reverses_payment_id INTEGER UNIQUE REFERENCES booking_payments(id);
    ALTER TABLE booking_payments ADD COLUMN credit_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE booking_payments ADD COLUMN receipt_snapshot JSONB;
    ALTER TABLE booking_payments ADD COLUMN confirmation JSONB;
    CREATE TABLE finance_requests (
      id BIGSERIAL PRIMARY KEY,booking_id INTEGER NOT NULL REFERENCES bookings(id),
      request_key UUID NOT NULL,requester_id INTEGER NOT NULL,requester_name VARCHAR(120) NOT NULL,
      payload JSONB NOT NULL,fingerprint TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(requester_id,request_key)
    );
    CREATE TABLE finance_decisions (
      id BIGSERIAL PRIMARY KEY,request_id BIGINT NOT NULL UNIQUE REFERENCES finance_requests(id),
      outcome VARCHAR(12) NOT NULL CHECK(outcome IN ('approved','rejected')),
      approver_id INTEGER NOT NULL,approver_name VARCHAR(120) NOT NULL,reason VARCHAR(500) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE booking_payments ADD COLUMN finance_request_id BIGINT REFERENCES finance_requests(id);
    CREATE TABLE finance_reconciliations (
      id BIGSERIAL PRIMARY KEY,business_date DATE NOT NULL,request_key UUID NOT NULL,
      staff_user_id INTEGER NOT NULL,staff_name VARCHAR(120) NOT NULL,report_digest TEXT NOT NULL,
      expected JSONB NOT NULL,actual JSONB NOT NULL,difference JSONB NOT NULL,reason VARCHAR(500) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),UNIQUE(staff_user_id,request_key)
    );
    CREATE INDEX idx_finance_payment_date ON booking_payments(created_at,id);
    CREATE INDEX idx_finance_requests_booking ON finance_requests(booking_id,id);
    CREATE INDEX idx_finance_reconcile_date ON finance_reconciliations(business_date,id);
    CREATE FUNCTION guard_financial_entry() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE original booking_payments%ROWTYPE;
    BEGIN
      IF NEW.confirmation IS NULL OR NEW.confirmation->>'manual' IS DISTINCT FROM 'true' OR NEW.receipt_snapshot IS NULL THEN
        RAISE EXCEPTION 'Financial evidence required' USING ERRCODE='23514'; END IF;
      IF NEW.entry_type<>'reversal' AND NEW.method<>'cash' AND length(trim(NEW.reference))<3 THEN
        RAISE EXCEPTION 'External reference required' USING ERRCODE='23514'; END IF;
      IF NEW.entry_type='normal' AND (NEW.finance_request_id IS NOT NULL OR NEW.reverses_payment_id IS NOT NULL OR NEW.credit_amount<>0) THEN
        RAISE EXCEPTION 'Invalid normal financial entry' USING ERRCODE='23514'; END IF;
      IF NEW.entry_type<>'normal' AND NEW.finance_request_id IS NULL THEN
        RAISE EXCEPTION 'Adjustment request required' USING ERRCODE='23514'; END IF;
      IF NEW.entry_type='reversal' THEN
        SELECT * INTO original FROM booking_payments WHERE id=NEW.reverses_payment_id;
        IF NOT FOUND OR original.booking_id<>NEW.booking_id OR original.amount<>-NEW.amount OR original.method<>NEW.method OR original.credit_amount<>-NEW.credit_amount THEN
          RAISE EXCEPTION 'Reversal must match original entry' USING ERRCODE='23514'; END IF;
      ELSIF NEW.reverses_payment_id IS NOT NULL OR NEW.credit_amount<0 THEN
        RAISE EXCEPTION 'Invalid reversal/credit' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER financial_entry_guard BEFORE INSERT ON booking_payments FOR EACH ROW EXECUTE FUNCTION guard_financial_entry();
    INSERT INTO app_migrations(id) VALUES('finance_controls_v5');
  `);
};
