import 'dotenv/config';

const number = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`);
  return parsed;
};

const required = (key: string, fallback = ''): string => process.env[key] ?? fallback;
const nodeEnv = required('NODE_ENV', 'development');
const fundsMode = required('FUNDS_MODE', nodeEnv === 'production' ? 'real' : 'test').toLowerCase();
const depositMode = required('DEPOSIT_MODE', fundsMode === 'real' ? 'unique' : 'disabled').toLowerCase();
if (!['test', 'real'].includes(fundsMode)) throw new Error('FUNDS_MODE must be test or real');
if (!['disabled', 'unique'].includes(depositMode)) throw new Error('DEPOSIT_MODE must be disabled or unique');

export const config = {
  nodeEnv,
  fundsMode: fundsMode as 'test' | 'real',
  depositMode: depositMode as 'disabled' | 'unique',
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
  claimRateLimitPerMinute: number('CLAIM_RATE_LIMIT_PER_MINUTE', 20),
  // Test credits mint internal ledger balance and must never enter real-funds mode.
  allowDevCredit: required('ALLOW_DEV_CREDIT', 'false') === 'true' && nodeEnv !== 'production' && fundsMode === 'test',
  chainOperationsEnabled: fundsMode === 'real',
  redEnvelope: {
    // Admin-created envelopes are always paid from this real internal wallet.
    // Keeping the treasury explicit prevents the admin panel from minting unbacked balances.
    treasuryTelegramId: required('RED_ENVELOPE_TREASURY_TELEGRAM_ID')
  }
} as const;

export function assertProductionConfig(): void {
  if (config.nodeEnv === 'production' && config.fundsMode !== 'real') {
    throw new Error('Production requires FUNDS_MODE=real; test balances must never run in production');
  }
  if (config.nodeEnv === 'production' && process.env.ALLOW_DEV_CREDIT === 'true') {
    throw new Error('ALLOW_DEV_CREDIT must be false in production');
  }
  if (config.fundsMode === 'real') {
    const missing = ['BOT_TOKEN', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'TRON_HOT_WALLET_ADDRESS', 'HOT_WALLET_PRIVATE_KEY']
      .filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Real-funds mode is missing required environment variables: ${missing.join(', ')}`);
    if (config.jwtSecret === 'development-only-change-me') throw new Error('JWT_SECRET must be changed in real-funds mode');
    if (config.depositMode !== 'unique') throw new Error('Real-funds mode requires DEPOSIT_MODE=unique; shared deposit addresses are not supported');
  }
}
