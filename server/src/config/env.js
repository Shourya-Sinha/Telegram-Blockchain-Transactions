require('dotenv').config();

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

module.exports = {
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/tbt_chain',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  PORT: num(process.env.PORT, 5000),
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  TOKEN_SYMBOL: process.env.TOKEN_SYMBOL || 'TBT',
  TOKEN_NAME: process.env.TOKEN_NAME || 'Telegram Blockchain Token',
  BLOCK_TIME_MS: num(process.env.BLOCK_TIME_MS, 10000),
  MAX_TX_PER_BLOCK: num(process.env.MAX_TX_PER_BLOCK, 10),
  MAX_TX_PER_USER_PER_BLOCK: num(process.env.MAX_TX_PER_USER_PER_BLOCK, 2),
  TX_FEE_PERCENT: num(process.env.TX_FEE_PERCENT, 0.1),
  TX_FEE_MIN: num(process.env.TX_FEE_MIN, 0.01),
  FAUCET_AMOUNT: num(process.env.FAUCET_AMOUNT, 100),
  FAUCET_COOLDOWN_MS: num(process.env.FAUCET_COOLDOWN_MS, 3600000),
  DAILY_SEND_LIMIT: num(process.env.DAILY_SEND_LIMIT, 10000),
  LARGE_TX_APPROVAL_THRESHOLD: num(process.env.LARGE_TX_APPROVAL_THRESHOLD, 5000),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || '',
  WALLET_ENCRYPTION_KEY: process.env.WALLET_ENCRYPTION_KEY || '',
  EVM_RPC_URL: process.env.EVM_RPC_URL || '',
  EVM_SETTLEMENT_KEY: process.env.EVM_SETTLEMENT_KEY || '',
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || 'admin@tbt.local',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'Admin123!',
};
