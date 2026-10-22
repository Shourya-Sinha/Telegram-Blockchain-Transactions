import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * npm runs workspace scripts with the workspace as cwd, while the documented
 * .env file lives at the repository root. Walk upwards so the same file is
 * loaded whether the backend is started from the root, apps/backend, or dist.
 * Existing process environment values still take precedence.
 */
function findEnvFile(start: string): string | undefined {
  let directory = resolve(start);
  const root = parse(directory).root;
  while (true) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) return candidate;
    if (directory === root) return undefined;
    directory = dirname(directory);
  }
}

const envFile = [process.cwd(), process.env.INIT_CWD, __dirname]
  .filter((value): value is string => Boolean(value))
  .map(findEnvFile)
  .find((value): value is string => Boolean(value));
loadDotenv(envFile ? { path: envFile } : undefined);

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

/**
 * Required TRC20 destination address for simulated withdrawals while
 * FUNDS_MODE=test. When set, users can exercise the full withdrawal flow
 * (amount + fee reserved, settled, recorded) against exactly this address and
 * no real TRC20 transaction is ever broadcast. Leaving it empty keeps the
 * withdrawal button disabled in test mode.
 */
const testWithdrawalAddress = required('TEST_WITHDRAWAL_ADDRESS').trim();
if (testWithdrawalAddress && !testWithdrawalAddress.match(/^T[1-9A-HJ-NP-Za-km-z]{33}$/)) {
  throw new Error('TEST_WITHDRAWAL_ADDRESS must be a valid TRON (TRC20) address such as TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj');
}
if (fundsMode === 'real' && testWithdrawalAddress) {
  throw new Error('TEST_WITHDRAWAL_ADDRESS must not be set when FUNDS_MODE=real; real withdrawals go to any user-supplied TRC20 address');
}

export const config = {
  nodeEnv,
  fundsMode: fundsMode as 'test' | 'real',
  depositMode: depositMode as 'disabled' | 'unique',
  port: number('PORT', 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://red_envelope:red_envelope@localhost:5432/red_envelope?schema=public'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  botToken: required('BOT_TOKEN'),
  telegramWebhookSecret: required('TELEGRAM_WEBHOOK_SECRET', 'development-webhook-secret'),
  telegramWebhookUrl: required('TELEGRAM_WEBHOOK_URL'),
  telegramInitDataMaxAge: number('TELEGRAM_INIT_DATA_MAX_AGE_SECONDS', 86400),
  // Optional BotFather Mini App short name. When set, group envelope buttons can
  // open the Mini App directly with a startapp payload instead of first opening
  // the bot private chat.
  telegramMiniAppShortName: required('TELEGRAM_MINI_APP_SHORT_NAME').trim(),
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
    autoApprovalLimitMinor: BigInt(Math.round(number('WITHDRAWAL_AUTO_APPROVAL_LIMIT', 50) * 1_000_000)),
    testWithdrawalAddress,
    // Simulated withdrawals are a test-mode feature only.
    testWithdrawalsEnabled: fundsMode === 'test' && Boolean(testWithdrawalAddress)
  },
  rateLimitPerMinute: number('RATE_LIMIT_PER_MINUTE', 60),
  claimRateLimitPerMinute: number('CLAIM_RATE_LIMIT_PER_MINUTE', 20),
  // Test credits mint internal ledger balance and must never enter real-funds mode.
  allowDevCredit: required('ALLOW_DEV_CREDIT', 'false') === 'true' && nodeEnv !== 'production' && fundsMode === 'test',
  devAutoCreditMinor: BigInt(Math.round(Math.max(0, Math.min(10_000, number('DEV_AUTO_CREDIT_USDT', 0))) * 1_000_000)),
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
  if (config.nodeEnv === 'production' && config.devAutoCreditMinor > 0n) {
    throw new Error('DEV_AUTO_CREDIT_USDT must be 0 in production');
  }
  if (config.fundsMode === 'real') {
    const missing = ['BOT_TOKEN', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'TRON_HOT_WALLET_ADDRESS', 'HOT_WALLET_PRIVATE_KEY']
      .filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Real-funds mode is missing required environment variables: ${missing.join(', ')}`);
    if (config.jwtSecret === 'development-only-change-me') throw new Error('JWT_SECRET must be changed in real-funds mode');
    if (config.depositMode !== 'unique') throw new Error('Real-funds mode requires DEPOSIT_MODE=unique; shared deposit addresses are not supported');
  }
}
