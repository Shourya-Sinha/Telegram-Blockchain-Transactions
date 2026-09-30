-- Track whether a withdrawal used the available -> locked reservation flow.
-- Existing withdrawals remain false so deployment cannot release or settle funds
-- that were debited by the legacy implementation.
ALTER TABLE "Withdrawal"
  ADD COLUMN "fundsReserved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completedAt" TIMESTAMP(3);

-- Keep the complete on-chain deposit identity required for reconciliation.
ALTER TABLE "Deposit"
  ADD COLUMN "toAddress" TEXT,
  ADD COLUMN "tokenContract" TEXT,
  ADD COLUMN "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- Legacy rows predate these reconciliation fields. Preserve them with explicit
-- markers, then make the fields mandatory for every new deposit.
UPDATE "Deposit" SET
  "toAddress" = 'LEGACY_UNKNOWN',
  "tokenContract" = 'LEGACY_UNKNOWN'
WHERE "toAddress" IS NULL OR "tokenContract" IS NULL;

ALTER TABLE "Deposit"
  ALTER COLUMN "toAddress" SET NOT NULL,
  ALTER COLUMN "tokenContract" SET NOT NULL;

CREATE INDEX "Deposit_userId_createdAt_idx" ON "Deposit"("userId", "createdAt");
CREATE INDEX "Deposit_toAddress_createdAt_idx" ON "Deposit"("toAddress", "createdAt");
