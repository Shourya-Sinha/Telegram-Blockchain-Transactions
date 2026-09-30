import { Worker } from 'bullmq';
import { redis } from '../lib/redis';
import { config } from '../config';
import { processWithdrawal } from '../services/withdrawalService';
import { depositQueue, envelopeExpiryQueue, withdrawalQueue } from './queues';
import { tronGateway } from '../services/tronGateway';
import { prisma } from '../lib/prisma';
import { recordIncomingTransfer } from '../services/depositService';
import { expireEnvelopes } from '../services/envelopeService';

let started = false;

export function startWorkers(): void {
  if (started) return;
  started = true;
  new Worker('envelope-expiry', async () => expireEnvelopes(), { connection: redis, concurrency: 1 });
  void envelopeExpiryQueue.add('expire', {}, { repeat: { every: 60_000 }, jobId: 'envelope-expiry' });

  if (config.chainOperationsEnabled) {
    new Worker('withdrawals', async (job) => processWithdrawal(job.data.withdrawalId), { connection: redis, concurrency: 2 });
    new Worker('deposits', async () => {
      // Each address belongs to one Telegram-ID-backed user. The overlapping
      // scan window is safe because Deposit.txHash is globally unique.
      const users = await prisma.user.findMany({ where: { depositAddress: { not: null } }, select: { id: true, depositAddress: true } });
      const sinceMs = Date.now() - 10 * 60_000;
      for (const user of users) {
        if (!user.depositAddress) continue;
        const transfers = await tronGateway.pollIncomingTransfers(user.depositAddress, sinceMs);
        for (const transfer of transfers) await recordIncomingTransfer(user.id, transfer);
      }
    }, { connection: redis, concurrency: 1 });
    void depositQueue.add('poll', {}, { repeat: { every: 60_000 }, jobId: 'incoming-transfers-poll' });
    console.log(`[workers] real-funds chain workers started; requiring ${config.tron.confirmations} Tron confirmations`);
  } else {
    console.log('[workers] test mode; blockchain deposit and withdrawal workers are disabled');
  }
}

export { withdrawalQueue };
