import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export type WithdrawalJob = { withdrawalId: string };
export type DepositJob = { sinceMs?: number };
export type EnvelopeExpiryJob = Record<string, never>;

export const withdrawalQueue = new Queue<WithdrawalJob>('withdrawals', { connection: redis, defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } });
export const depositQueue = new Queue<DepositJob>('deposits', { connection: redis, defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 50, removeOnFail: 50 } });
export const envelopeExpiryQueue = new Queue<EnvelopeExpiryJob>('envelope-expiry', { connection: redis, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 50, removeOnFail: 50 } });
