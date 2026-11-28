-- The wallet ledger is the record of money. Each entry below is meant to exist at most once, and the
-- application already guards against writing it twice (a payment, an order or a refund can only move
-- forward once). This makes the database the last line of defence: a second entry for the same thing
-- is refused, so a bug or a replay can never credit or reverse the same money twice.
--
--   vendor wallet: one SALE credit, one COMMISSION settlement and one REFUND reversal per order
--                  (reference_id is the order id)
--   user wallet:   one REFERRAL credit per referral (reference_id is the referral id)

-- Refuse with a clear message, rather than a bare index error, if the ledger already holds duplicates.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "wallet_transactions"
    WHERE "vendor_wallet_id" IS NOT NULL AND "reference_id" IS NOT NULL
      AND "reason" IN ('SALE', 'COMMISSION', 'REFUND')
    GROUP BY "vendor_wallet_id", "reason", "type", "reference_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'wallet_transactions already holds duplicate vendor ledger entries (same wallet, reason, type and order). Review and resolve them before applying this migration.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "wallet_transactions"
    WHERE "user_wallet_id" IS NOT NULL AND "reference_id" IS NOT NULL
      AND "reason" = 'REFERRAL'
    GROUP BY "user_wallet_id", "reason", "type", "reference_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'wallet_transactions already holds duplicate referral credits (same wallet and referral). Review and resolve them before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "wallet_transactions_vendor_once_idx"
  ON "wallet_transactions" ("vendor_wallet_id", "reason", "type", "reference_id")
  WHERE "vendor_wallet_id" IS NOT NULL
    AND "reference_id" IS NOT NULL
    AND "reason" IN ('SALE', 'COMMISSION', 'REFUND');

CREATE UNIQUE INDEX "wallet_transactions_user_referral_once_idx"
  ON "wallet_transactions" ("user_wallet_id", "reason", "type", "reference_id")
  WHERE "user_wallet_id" IS NOT NULL
    AND "reference_id" IS NOT NULL
    AND "reason" = 'REFERRAL';
