-- DropIndex
DROP INDEX "Deposit_toAddress_createdAt_idx";

-- DropIndex
DROP INDEX "Deposit_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "GroupMember" ALTER COLUMN "id" DROP DEFAULT;
