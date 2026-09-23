CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BANNED');
CREATE TYPE "LedgerType" AS ENUM ('DEPOSIT', 'CLAIM', 'WITHDRAWAL', 'FEE', 'REFUND', 'TRANSFER');
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "EnvelopeMode" AS ENUM ('RANDOM', 'EQUAL');
CREATE TYPE "EnvelopeStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'REFUNDED');
CREATE TYPE "Chain" AS ENUM ('TRC20');
CREATE TYPE "WithdrawalStatus" AS ENUM ('QUEUED', 'PROCESSING', 'BROADCAST', 'CONFIRMING', 'COMPLETED', 'FAILED', 'REJECTED');
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'FINANCE', 'SUPPORT');

CREATE TABLE "User" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "telegramId" BIGINT NOT NULL,
  "username" TEXT,
  "depositAddress" TEXT,
  "firstName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isAdmin" BOOLEAN NOT NULL DEFAULT false,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE UNIQUE INDEX "User_depositAddress_key" ON "User"("depositAddress");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "User_status_idx" ON "User"("status");

CREATE TABLE "WalletAccount" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "availableMinor" BIGINT NOT NULL DEFAULT 0,
  "lockedMinor" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WalletAccount_userId_key" ON "WalletAccount"("userId");
CREATE INDEX "WalletAccount_availableMinor_idx" ON "WalletAccount"("availableMinor");

CREATE TABLE "LedgerEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "type" "LedgerType" NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "balanceAfterMinor" BIGINT NOT NULL,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");
CREATE INDEX "LedgerEntry_referenceType_referenceId_idx" ON "LedgerEntry"("referenceType", "referenceId");

CREATE TABLE "RedEnvelope" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "senderId" UUID NOT NULL,
  "groupId" BIGINT NOT NULL,
  "messageId" INTEGER NOT NULL,
  "totalMinor" BIGINT NOT NULL,
  "remainingMinor" BIGINT NOT NULL,
  "totalSlots" INTEGER NOT NULL,
  "remainingSlots" INTEGER NOT NULL,
  "mode" "EnvelopeMode" NOT NULL,
  "status" "EnvelopeStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RedEnvelope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RedEnvelope_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RedEnvelope_groupId_createdAt_idx" ON "RedEnvelope"("groupId", "createdAt");
CREATE INDEX "RedEnvelope_status_expiresAt_idx" ON "RedEnvelope"("status", "expiresAt");

CREATE TABLE "RedEnvelopeClaim" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "envelopeId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RedEnvelopeClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RedEnvelopeClaim_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "RedEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RedEnvelopeClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RedEnvelopeClaim_envelopeId_userId_key" ON "RedEnvelopeClaim"("envelopeId", "userId");
CREATE INDEX "RedEnvelopeClaim_userId_claimedAt_idx" ON "RedEnvelopeClaim"("userId", "claimedAt");

CREATE TABLE "Withdrawal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "feeMinor" BIGINT NOT NULL,
  "toAddress" TEXT NOT NULL,
  "chain" "Chain" NOT NULL DEFAULT 'TRC20',
  "txHash" TEXT,
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Withdrawal_idempotencyKey_key" ON "Withdrawal"("idempotencyKey");
CREATE INDEX "Withdrawal_status_createdAt_idx" ON "Withdrawal"("status", "createdAt");
CREATE INDEX "Withdrawal_userId_createdAt_idx" ON "Withdrawal"("userId", "createdAt");

CREATE TABLE "Deposit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "txHash" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "fromAddress" TEXT NOT NULL,
  "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
  "confirmations" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Deposit_txHash_key" ON "Deposit"("txHash");
CREATE INDEX "Deposit_status_createdAt_idx" ON "Deposit"("status", "createdAt");

CREATE TABLE "AdminUser" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL DEFAULT 'SUPPORT',
  "mfaSecret" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

CREATE TABLE "GroupSetting" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" BIGINT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
  "minMessages" INTEGER NOT NULL DEFAULT 0,
  "maxClaimsPerDay" INTEGER NOT NULL DEFAULT 10,
  CONSTRAINT "GroupSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GroupSetting_chatId_key" ON "GroupSetting"("chatId");
