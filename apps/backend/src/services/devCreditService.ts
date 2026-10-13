import { config } from '../config';
import { prisma } from '../lib/prisma';
import { LedgerType } from '../utils/prismaEnums';
import { creditWallet, type Transaction, writeAudit } from './ledgerService';

/**
 * Grants the configured test-mode welcome balance once per user. The wallet row
 * is locked before checking the immutable ledger marker, so concurrent /start
 * and Mini App /me requests cannot grant the credit twice.
 */
export async function grantAutomaticTestCredit(userId: string): Promise<boolean> {
  if (!config.allowDevCredit || config.devAutoCreditMinor <= 0n) return false;
  const referenceId = `automatic:${userId}`;
  return prisma.$transaction(async (tx: Transaction) => {
    await tx.$queryRawUnsafe(`SELECT \"id\" FROM \"WalletAccount\" WHERE \"userId\" = $1 FOR UPDATE`, userId);
    const existing = await tx.ledgerEntry.findFirst({ where: { userId, referenceType: 'DEV_CREDIT', referenceId }, select: { id: true } });
    if (existing) return false;
    const credited = await creditWallet(tx, userId, config.devAutoCreditMinor, LedgerType.TRANSFER, 'DEV_CREDIT', referenceId);
    await writeAudit(tx, {
      action: 'DEV_SIGNUP_WALLET_CREDITED',
      entityType: 'User',
      entityId: userId,
      after: {
        amountMinor: config.devAutoCreditMinor.toString(),
        availableMinor: credited.availableMinor.toString(),
        source: 'DEV_AUTO_CREDIT_USDT'
      }
    });
    return true;
  });
}
