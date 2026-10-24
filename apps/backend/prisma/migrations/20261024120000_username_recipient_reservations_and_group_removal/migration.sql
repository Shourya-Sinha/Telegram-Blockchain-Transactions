ALTER TABLE "GroupSetting"
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "GroupSetting_deletionRequestedAt_idx" ON "GroupSetting"("deletionRequestedAt");
CREATE INDEX "GroupSetting_archivedAt_idx" ON "GroupSetting"("archivedAt");

CREATE TABLE "RedEnvelopeEligibleUsername" (
  "envelopeId" UUID NOT NULL,
  "username" TEXT NOT NULL,
  "telegramId" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "boundAt" TIMESTAMP(3),
  CONSTRAINT "RedEnvelopeEligibleUsername_pkey" PRIMARY KEY ("envelopeId", "username"),
  CONSTRAINT "RedEnvelopeEligibleUsername_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "RedEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RedEnvelopeEligibleUsername_envelopeId_telegramId_key" ON "RedEnvelopeEligibleUsername"("envelopeId", "telegramId");
CREATE INDEX "RedEnvelopeEligibleUsername_telegramId_idx" ON "RedEnvelopeEligibleUsername"("telegramId");
