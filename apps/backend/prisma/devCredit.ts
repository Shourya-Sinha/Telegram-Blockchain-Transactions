import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

function parseAmount(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('Amount must be a positive USDT value with at most 6 decimals');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (minor <= 0n) throw new Error('Amount must be greater than zero');
  return minor;
}

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEV_CREDIT !== 'true') {
    throw new Error('Development credit is disabled. Set ALLOW_DEV_CREDIT=true only in a local development .env.');
  }
  const [telegramIdRaw, amountRaw] = process.argv.slice(2);
  if (!telegramIdRaw || !/^\d+$/.test(telegramIdRaw) || !amountRaw) {
    throw new Error('Usage: npm run db:dev-credit -- <telegram-id> <amount-usdt>');
  }
  const telegramId = BigInt(telegramIdRaw);
  const amountMinor = parseAmount(amountRaw);
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { telegramId }, include: { wallet: true } });
    if (!user?.wallet) throw new Error('Telegram user or wallet not found. Send /start to the bot first.');

    const balance = await prisma.$transaction(async (tx: any) => {
      const rows = await tx.$queryRawUnsafe(
        `SELECT "id", "availableMinor" FROM "WalletAccount" WHERE "userId" = $1 FOR UPDATE`,
        user.id
      ) as Array<{ id: string; availableMinor: bigint }>;
      const wallet = rows[0];
      if (!wallet) throw new Error('Wallet not found');
      const availableMinor = wallet.availableMinor + amountMinor;
      await tx.walletAccount.update({ where: { id: wallet.id }, data: { availableMinor, version: { increment: 1 } } });
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amountMinor,
          type: 'TRANSFER',
          direction: 'CREDIT',
          balanceAfterMinor: availableMinor,
          referenceType: 'DEV_CREDIT',
          referenceId: `dev-credit:${Date.now()}`
        }
      });
      await tx.auditLog.create({
        data: {
          action: 'DEV_WALLET_CREDITED',
          entityType: 'User',
          entityId: user.id,
          after: { amountMinor: amountMinor.toString(), availableMinor: availableMinor.toString() }
        }
      });
      return availableMinor;
    });

    console.log(`Credited ${amountRaw} test USDT to Telegram ID ${telegramIdRaw}. New minor-unit balance: ${balance}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
