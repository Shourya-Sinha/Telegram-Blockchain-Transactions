import { Worker } from 'bullmq';
import { redis } from '../lib/redis';
import { config } from '../config';
import { processWithdrawal } from '../services/withdrawalService';
import { depositQueue, withdrawalQueue } from './queues';
import { tronGateway } from '../services/tronGateway';
import { prisma } from '../lib/prisma';
import { recordIncomingTransfer } from '../services/depositService';
import { expireEnvelopes } from '../services/envelopeService';

let started = false;

export function startWorkers(): void {
  if (started) return;
  started = true;
  new Worker('withdrawals', async (job) => processWithdrawal(job.data.withdrawalId), { connection: redis, concurrency: 2 });
  new Worker('deposits', async (job) => {
    const sinceMs = job.data.sinceMs ?? Date.now() - 10 * 60_000;
    const transfers = await tronGateway.pollIncomingTransfers(sinceMs);
    for (const transfer of transfers) {
      const user = await prisma.user.findFirst({ where: { depositAddress: transfer.toAddress }, select: { id: true } });
      if (user) await recordIncomingTransfer(user.id, transfer);
    }
    await expireEnvelopes();
  }, { connection: redis, concurrency: 1 });
  void depositQueue.add('poll', { sinceMs: Date.now() - 10 * 60_000 }, { repeat: { every: 60_000 }, jobId: 'incoming-transfers-poll' });
  console.log(`[workers] started; requiring ${config.tron.confirmations} Tron confirmations for deposits`);
}

export { withdrawalQueue };
