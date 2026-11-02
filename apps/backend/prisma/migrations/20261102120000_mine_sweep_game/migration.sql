CREATE TYPE "EnvelopeGameType" AS ENUM ('STANDARD', 'MINE');

ALTER TYPE "LedgerType" ADD VALUE 'GAME_STAKE';
ALTER TYPE "LedgerType" ADD VALUE 'GAME_PAYOUT';

ALTER TABLE "RedEnvelope"
  ADD COLUMN "gameType" "EnvelopeGameType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "mineDigit" INTEGER;

ALTER TABLE "RedEnvelope"
  ADD CONSTRAINT "RedEnvelope_mineDigit_valid"
  CHECK (
    ("gameType" = 'STANDARD' AND "mineDigit" IS NULL)
    OR ("gameType" = 'MINE' AND "mineDigit" IS NOT NULL AND "mineDigit" BETWEEN 0 AND 9)
  ),
  ADD CONSTRAINT "RedEnvelope_mine_configuration_valid"
  CHECK (
    "gameType" = 'STANDARD'
    OR (
      "gameType" = 'MINE'
      AND "mode" = 'RANDOM'
      AND "totalSlots" IN (5, 6, 9)
      AND "totalMinor" % 10000 = 0
      AND "totalMinor" >= "totalSlots"::BIGINT * 10000
    )
  );

ALTER TABLE "RedEnvelopeClaim"
  ADD COLUMN "lastDigit" INTEGER,
  ADD COLUMN "mineHit" BOOLEAN,
  ADD COLUMN "payoutMinor" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "RedEnvelopeClaim"
  ADD CONSTRAINT "RedEnvelopeClaim_lastDigit_valid"
  CHECK ("lastDigit" IS NULL OR "lastDigit" BETWEEN 0 AND 9),
  ADD CONSTRAINT "RedEnvelopeClaim_payoutMinor_nonnegative"
  CHECK ("payoutMinor" >= 0),
  ADD CONSTRAINT "RedEnvelopeClaim_mine_result_consistent"
  CHECK (
    ("mineHit" IS NULL AND "lastDigit" IS NULL AND "payoutMinor" = 0)
    OR (
      "mineHit" IS NOT NULL
      AND "lastDigit" IS NOT NULL
      AND "lastDigit" BETWEEN 0 AND 9
      AND (("mineHit" = FALSE AND "payoutMinor" = 0) OR ("mineHit" = TRUE AND "payoutMinor" > 0))
    )
  );
