-- Add Telegram-owned phone verification and allow card-transfer orders.
-- Existing phone values stay unverified until the Telegram contact is shared.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Existing production orders currently use cash. Replace the stale check
-- constraint so the payment method supported by the app can be persisted.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash', 'card_transfer'));

-- Order creation must go through the API, which verifies Telegram initData
-- and the user's shared contact before calling this SECURITY DEFINER RPC.
DO $$
DECLARE
  function_signature REGPROCEDURE;
BEGIN
  FOR function_signature IN
    SELECT oid::regprocedure
    FROM pg_proc
    WHERE proname = 'create_order_atomic'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      function_signature
    );
  END LOOP;
END $$;
