-- Test-mode, non-custodial game records and agent attribution/reporting.
-- The game APIs enforce FUNDS_MODE=test; this migration does not enable real-funds play.
CREATE TYPE "TestGameVariant" AS ENUM ('SINGLE_MINE', 'CHAIN_MINE', 'NINE_MULTI_MINE');
CREATE TYPE "TestGameRoundStatus" AS ENUM ('OPEN', 'SETTLED');
CREATE TYPE "TestGamePayoutPolicy" AS ENUM ('MULTIPLIER_INCLUDES_STAKE', 'MULTIPLIER_IS_PROFIT');

CREATE TABLE "Agent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "inviteCode" VARCHAR(32) NOT NULL,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Agent_userId_key" ON "Agent"("userId");
CREATE UNIQUE INDEX "Agent_inviteCode_key" ON "Agent"("inviteCode");
CREATE INDEX "Agent_active_createdAt_idx" ON "Agent"("active", "createdAt");
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "referredByAgentId" UUID;
CREATE INDEX "User_referredByAgentId_idx" ON "User"("referredByAgentId");
ALTER TABLE "User" ADD CONSTRAINT "User_referredByAgentId_fkey"
    FOREIGN KEY ("referredByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TestGameProfile" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "stakeMinMinor" BIGINT NOT NULL,
    "stakeMaxMinor" BIGINT NOT NULL,
    "odds" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TestGameProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TestGameProfile_key_key" ON "TestGameProfile"("key");
CREATE INDEX "TestGameProfile_active_key_idx" ON "TestGameProfile"("active", "key");

CREATE TABLE "TestGameRound" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "profileName" VARCHAR(100) NOT NULL,
    "stakeMinMinor" BIGINT NOT NULL,
    "stakeMaxMinor" BIGINT NOT NULL,
    "oddsSnapshot" JSONB NOT NULL,
    "variant" "TestGameVariant" NOT NULL,
    "packetCount" INTEGER NOT NULL,
    "targetDigit" INTEGER NOT NULL DEFAULT 0,
    "status" "TestGameRoundStatus" NOT NULL DEFAULT 'OPEN',
    "outcomeKey" VARCHAR(40),
    "payoutPolicySelected" "TestGamePayoutPolicy",
    "payoutPolicyApprovalReference" VARCHAR(200),
    "createdByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "TestGameRound_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TestGameRound_status_createdAt_idx" ON "TestGameRound"("status", "createdAt");
CREATE INDEX "TestGameRound_profileId_createdAt_idx" ON "TestGameRound"("profileId", "createdAt");
ALTER TABLE "TestGameRound" ADD CONSTRAINT "TestGameRound_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "TestGameProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TestGameBet" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "agentId" UUID,
    "outcomeKey" VARCHAR(40) NOT NULL,
    "stakeMinor" BIGINT NOT NULL,
    "multiplierHundredths" INTEGER NOT NULL,
    "agentCommissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "agentCommissionMinor" BIGINT NOT NULL DEFAULT 0,
    "isWin" BOOLEAN,
    "payoutIncludesStakeMinor" BIGINT NOT NULL DEFAULT 0,
    "payoutIsProfitMinor" BIGINT NOT NULL DEFAULT 0,
    "netIncludesStakeMinor" BIGINT NOT NULL DEFAULT 0,
    "netIsProfitMinor" BIGINT NOT NULL DEFAULT 0,
    "selectedPayoutMinor" BIGINT,
    "manualPayoutReference" VARCHAR(200),
    "manualPayoutAt" TIMESTAMP(3),
    "manualPayoutByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestGameBet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TestGameBet_roundId_userId_outcomeKey_key" ON "TestGameBet"("roundId", "userId", "outcomeKey");
CREATE INDEX "TestGameBet_userId_createdAt_idx" ON "TestGameBet"("userId", "createdAt");
CREATE INDEX "TestGameBet_agentId_createdAt_idx" ON "TestGameBet"("agentId", "createdAt");
CREATE INDEX "TestGameBet_roundId_isWin_idx" ON "TestGameBet"("roundId", "isWin");
ALTER TABLE "TestGameBet" ADD CONSTRAINT "TestGameBet_roundId_fkey"
    FOREIGN KEY ("roundId") REFERENCES "TestGameRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestGameBet" ADD CONSTRAINT "TestGameBet_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestGameBet" ADD CONSTRAINT "TestGameBet_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
