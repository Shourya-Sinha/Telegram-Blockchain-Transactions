CREATE TABLE "AdminDeveloperMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "adminId" UUID NOT NULL,
  "adminUsername" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminDeveloperMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminDeveloperMessage_createdAt_idx" ON "AdminDeveloperMessage"("createdAt");
CREATE INDEX "AdminDeveloperMessage_adminId_createdAt_idx" ON "AdminDeveloperMessage"("adminId", "createdAt");
