const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { txHash } = require('../utils/crypto');
const { getSettings, calcFee } = require('./stats');
const { fairnessScore } = require('../utils/fairness');
const { emitUser, emitPublic, emitAdmin } = require('../realtime/socket');

const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000001';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create a user transfer with real-world guards:
 * - account + wallet checks, daily limits, idempotency, balance lock,
 * - large-tx admin approval, fair-score stamping.
 * Emits realtime events for live UI updates.
 */
async function createTransfer(user, { fromAddress, toAddress, amount, note, idempotencyKey }) {
  const s = await getSettings();
  if (user.status === 'frozen') throw Object.assign(new Error('Account frozen — contact support'), { status: 403 });

  const amt = Number(amount);
  const to = toAddress.toLowerCase();

  // Idempotency: same key returns the original tx
  if (idempotencyKey) {
    const existing = await Transaction.findOne({ idempotencyKey, fromUser: user._id });
    if (existing) return { tx: existing, duplicate: true };
  }

  // Resolve sender wallet (default: user's first wallet)
  let wallet;
  if (fromAddress) {
    wallet = await Wallet.findOne({ address: fromAddress.toLowerCase(), user: user._id });
    if (!wallet) throw Object.assign(new Error('Sender wallet not found'), { status: 404 });
  } else {
    wallet = await Wallet.findOne({ user: user._id }).sort({ createdAt: 1 });
    if (!wallet) throw Object.assign(new Error('No wallet yet — create one first'), { status: 400 });
  }
  if (wallet.address === to) throw Object.assign(new Error('Cannot send to yourself'), { status: 400 });

  const fee = calcFee(amt, s);
  const total = Number((amt + fee).toFixed(4));

  // Daily limit (resets by day)
  const day = todayKey();
  if (user.dailySentDay !== day) {
    user.dailySentDay = day;
    user.dailySent = 0;
  }
  const limit = user.dailyLimit ?? s.dailySendLimit;
  if (user.dailySent + amt > limit) {
    throw Object.assign(new Error(`Daily send limit exceeded (${user.dailySent}/${limit})`), { status: 429 });
  }

  // Balance check + lock (atomic-ish)
  const fresh = await Wallet.findById(wallet._id);
  const available = (fresh.balance || 0) - (fresh.lockedBalance || 0);
  if (available < total) {
    throw Object.assign(new Error(`Insufficient balance. Available ${available.toFixed(4)}, need ${total}`), { status: 400 });
  }
  fresh.lockedBalance = Number(((fresh.lockedBalance || 0) + total).toFixed(4));
  await fresh.save();

  // Resolve internal recipient
  const toWallet = await Wallet.findOne({ address: to });
  const toUser = toWallet ? toWallet.user : null;

  const needsApproval = s.largeTxApprovalThreshold > 0 && amt >= s.largeTxApprovalThreshold;

  const tx = await Transaction.create({
    hash: txHash(),
    type: 'transfer',
    fromUser: user._id,
    toUser,
    fromAddress: fresh.address,
    toAddress: to,
    amount: amt,
    fee,
    status: needsApproval ? 'requires_approval' : 'pending',
    nonce: fresh.nonce + (await Transaction.countDocuments({ fromAddress: fresh.address, status: { $in: ['pending', 'queued', 'processing', 'requires_approval'] } })),
    idempotencyKey: idempotencyKey || null,
    note: note || null,
    fairnessScore: fairnessScore({ fee, createdAt: new Date() }),
  });

  user.dailySent = Number(((user.dailySent || 0) + amt).toFixed(4));
  await user.save();

  // ---- Realtime ----
  emitUser(user._id, 'tx:submitted', { hash: tx.hash, amount: amt, fee, toAddress: to, needsApproval });
  emitPublic('mempool:update', { time: new Date().toISOString() });
  if (needsApproval) {
    emitAdmin('tx:approval_needed', { hash: tx.hash, amount: amt, from: user.email, toAddress: to });
  }

  return { tx, duplicate: false, needsApproval };
}

async function faucetClaim(user) {
  const s = await getSettings();
  const now = Date.now();
  if (user.lastFaucetAt && now - new Date(user.lastFaucetAt).getTime() < s.faucetCooldownMs) {
    const waitMin = Math.ceil((s.faucetCooldownMs - (now - new Date(user.lastFaucetAt).getTime())) / 60000);
    throw Object.assign(new Error(`Faucet cooldown — try again in ~${waitMin} min`), { status: 429 });
  }
  let wallet = await Wallet.findOne({ user: user._id }).sort({ createdAt: 1 });
  if (!wallet) throw Object.assign(new Error('Create a wallet first'), { status: 400 });

  const tx = await Transaction.create({
    hash: txHash(),
    type: 'faucet',
    fromUser: null,
    toUser: user._id,
    fromAddress: SYSTEM_ADDRESS,
    toAddress: wallet.address,
    amount: s.faucetAmount,
    fee: 0,
    status: 'pending',
    nonce: 0,
    note: 'Testnet faucet',
  });
  user.lastFaucetAt = new Date();
  await user.save();

  emitUser(user._id, 'tx:submitted', { hash: tx.hash, amount: tx.amount, fee: 0, toAddress: wallet.address, type: 'faucet' });
  emitPublic('mempool:update', { time: new Date().toISOString() });
  return tx;
}

async function adminMint(toAddress, amount, adminUser) {
  const to = toAddress.toLowerCase();
  const toWallet = await Wallet.findOne({ address: to });
  const tx = await Transaction.create({
    hash: txHash(),
    type: 'mint',
    fromUser: adminUser._id,
    toUser: toWallet ? toWallet.user : null,
    fromAddress: SYSTEM_ADDRESS,
    toAddress: to,
    amount: Number(amount),
    fee: 0,
    status: 'pending',
    nonce: 0,
    note: `Minted by admin ${adminUser.email}`,
  });
  emitPublic('mempool:update', { time: new Date().toISOString() });
  if (toWallet) emitUser(toWallet.user, 'tx:submitted', { hash: tx.hash, amount: tx.amount, fee: 0, toAddress: to, type: 'mint' });
  return tx;
}

async function cancelOwn(user, hash) {
  const tx = await Transaction.findOne({ hash, fromUser: user._id });
  if (!tx) throw Object.assign(new Error('Transaction not found'), { status: 404 });
  if (!['pending', 'queued', 'requires_approval'].includes(tx.status)) {
    throw Object.assign(new Error(`Cannot cancel a ${tx.status} transaction`), { status: 400 });
  }
  // Release lock
  if (tx.type === 'transfer') {
    const total = tx.amount + tx.fee;
    await Wallet.updateOne(
      { address: tx.fromAddress },
      { $inc: { lockedBalance: -total } }
    );
    await Wallet.updateMany({ lockedBalance: { $lt: 0 } }, { $set: { lockedBalance: 0 } });
    // Roll back daily sent
    const u = await User.findById(user._id);
    if (u) {
      u.dailySent = Math.max(0, (u.dailySent || 0) - tx.amount);
      await u.save();
    }
  }
  tx.status = 'cancelled';
  tx.processedAt = new Date();
  await tx.save();

  emitUser(user._id, 'tx:cancelled', { hash: tx.hash });
  emitPublic('mempool:update', { time: new Date().toISOString() });
  return tx;
}

module.exports = { createTransfer, faucetClaim, adminMint, cancelOwn, SYSTEM_ADDRESS };
