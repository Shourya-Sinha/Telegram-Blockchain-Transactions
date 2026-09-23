import 'dotenv/config';

const number = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`);
  return parsed;
};

const required = (key: string, fallback = ''): string => process.env[key] ?? fallback;

export const config = {
  nodeEnv: required('NODE_ENV', 'development'),
  port: number('PORT', 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://red_envelope:red_envelope@localhost:5432/red_envelope?schema=public'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  botToken: required('BOT_TOKEN'),
  telegramWebhookSecret: required('TELEGRAM_WEBHOOK_SECRET', 'development-webhook-secret'),
  telegramInitDataMaxAge: number('TELEGRAM_INIT_DATA_MAX_AGE_SECONDS', 86400),
  publicAppUrl: required('PUBLIC_APP_URL', 'http://localhost:5173'),
  corsOrigins: required('CORS_ORIGINS', 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean),
  jwtSecret: required('JWT_SECRET', 'development-only-change-me'),
  jwtExpiresIn: required('JWT_EXPIRES_IN', '12h'),
  tron: {
    fullHost: required('TRON_FULL_HOST', 'https://api.trongrid.io'),
    apiKey: required('TRONGRID_API_KEY'),
    usdtContract: required('TRON_USDT_CONTRACT', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj'),
    hotWalletAddress: required('TRON_HOT_WALLET_ADDRESS'),
    privateKey: required('HOT_WALLET_PRIVATE_KEY'),
    confirmations: number('TRON_CONFIRMATIONS', 19),
    capMinor: BigInt(Math.round(number('HOT_WALLET_CAP_USDT', 500) * 1_000_000))
  },
  withdrawal: {
    minMinor: BigInt(Math.round(number('WITHDRAWAL_MIN_USDT', 20) * 1_000_000)),
    feeMinor: BigInt(Math.round(number('WITHDRAWAL_FEE_USDT', 1) * 1_000_000)),
    autoApprovalLimitMinor: BigInt(Math.round(number('WITHDRAWAL_AUTO_APPROVAL_LIMIT', 50) * 1_000_000))
  },
  rateLimitPerMinute: number('RATE_LIMIT_PER_MINUTE', 60),
  claimRateLimitPerMinute: number('CLAIM_RATE_LIMIT_PER_MINUTE', 20)
} as const;

export function assertProductionConfig(): void {
  if (config.nodeEnv === 'production') {
    const missing = ['BOT_TOKEN', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'TRON_HOT_WALLET_ADDRESS', 'HOT_WALLET_PRIVATE_KEY']
      .filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(', ')}`);
    if (config.jwtSecret === 'development-only-change-me') throw new Error('JWT_SECRET must be changed in production');
  }
}
