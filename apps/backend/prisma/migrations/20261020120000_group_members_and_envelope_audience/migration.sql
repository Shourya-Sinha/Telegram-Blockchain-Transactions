CREATE TYPE "EnvelopeAudience" AS ENUM ('ALL', 'SELECTED');

ALTER TABLE "RedEnvelope"
  ADD COLUMN "audience" "EnvelopeAudience" NOT NULL DEFAULT 'ALL';

CREATE TABLE "GroupMember" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" BIGINT NOT NULL,
  "telegramId" BIGINT NOT NULL,
  "username" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT,
  "languageCode" TEXT,
  "isBot" BOOLEAN NOT NULL DEFAULT false,
  "isPremium" BOOLEAN NOT NULL DEFAULT false,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMessageAt" TIMESTAMP(3),
  "isMember" BOOLEAN NOT NULL DEFAULT true,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GroupMember_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "GroupSetting"("chatId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GroupMember_chatId_telegramId_key" ON "GroupMember"("chatId", "telegramId");
CREATE INDEX "GroupMember_chatId_isMember_lastSeenAt_idx" ON "GroupMember"("chatId", "isMember", "lastSeenAt");
CREATE INDEX "GroupMember_telegramId_idx" ON "GroupMember"("telegramId");

CREATE TABLE "RedEnvelopeEligibleUser" (
  "envelopeId" UUID NOT NULL,
  "telegramId" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RedEnvelopeEligibleUser_pkey" PRIMARY KEY ("envelopeId", "telegramId"),
  CONSTRAINT "RedEnvelopeEligibleUser_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "RedEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RedEnvelopeEligibleUser_telegramId_idx" ON "RedEnvelopeEligibleUser"("telegramId");
