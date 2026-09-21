const Setting = require('../models/Setting');
const env = require('../config/env');

const DEFAULTS = {
  feePercent: { value: env.TX_FEE_PERCENT, description: 'Fee % per transfer' },
  feeMin: { value: env.TX_FEE_MIN, description: 'Minimum fee' },
  maxTxPerBlock: { value: env.MAX_TX_PER_BLOCK, description: 'Block capacity' },
  maxTxPerUserPerBlock: { value: env.MAX_TX_PER_USER_PER_BLOCK, description: 'Fairness: per-user cap per block' },
  faucetAmount: { value: env.FAUCET_AMOUNT, description: 'Faucet payout' },
  faucetCooldownMs: { value: env.FAUCET_COOLDOWN_MS, description: 'Faucet cooldown ms' },
  dailySendLimit: { value: env.DAILY_SEND_LIMIT, description: 'Default daily send limit per user' },
  largeTxApprovalThreshold: { value: env.LARGE_TX_APPROVAL_THRESHOLD, description: 'Amount above which admin approval is required (0 = off)' },
  chainPaused: { value: false, description: 'Pause mining (maintenance)' },
  registrationsOpen: { value: true, description: 'Allow new signups' },
  evmAnchorMode: { value: env.EVM_ANCHOR_MODE || 'off', description: 'Sepolia anchoring: off | post' },
  evmAnchorAddress: { value: env.EVM_ANCHOR_ADDRESS || '', description: 'Sepolia address receiving anchor txs (blank = self)' },
};

async function ensureSettings() {
  for (const [key, { value, description }] of Object.entries(DEFAULTS)) {
    await Setting.updateOne({ key }, { $setOnInsert: { value, description } }, { upsert: true });
  }
}

async function getSettings() {
  await ensureSettings();
  const docs = await Setting.find({}).lean();
  const out = {};
  for (const d of docs) out[d.key] = d.value;
  // Fill any missing defaults without extra write
  for (const [k, { value }] of Object.entries(DEFAULTS)) {
    if (out[k] === undefined) out[k] = value;
  }
  return out;
}

function calcFee(amount, s) {
  const pct = (Number(amount) * Number(s.feePercent)) / 100;
  return Number(Math.max(pct, Number(s.feeMin)).toFixed(4));
}

module.exports = { ensureSettings, getSettings, calcFee, DEFAULTS };
