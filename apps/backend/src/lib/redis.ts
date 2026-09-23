import IORedis from 'ioredis';
import { config } from '../config';

export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });

redis.on('error', (error) => console.error('[redis]', error.message));
