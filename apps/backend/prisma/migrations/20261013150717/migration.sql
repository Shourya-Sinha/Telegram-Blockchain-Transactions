-- AlterTable
ALTER TABLE "AdminUser" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Deposit" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GroupSetting" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LedgerEntry" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RedEnvelope" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RedEnvelopeClaim" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WalletAccount" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Withdrawal" ALTER COLUMN "id" DROP DEFAULT;
