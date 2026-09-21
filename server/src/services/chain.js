const crypto = require('crypto');
const Block = require('../models/Block');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const env = require('../config/env');
const { pickFairBatch } = require('./mempool');
const { getSettings } = require('./stats');
const { notifyUser } = require('./telegram');

let mining = false;
let timer = null;

function blockHash(number, prevHash, txHashes) {
  return (
    '0x' +
    crypto
      .createHash('sha256')
      .update(`${number}:${prevHash}:${txHashes.join(',')}:${Date.now()}`)
      .digest('hex')
  );
}

async function getHeight() {
  const last = await Block.findOne().sort({ number: -1 }).lean();
  return last ? last.number : -1;
}

async function ensureGenesis() {
  const count = await Block.countDocuments();
  if (count === 0) {
    await Block.create({
      number: 0,
      hash: '0x' + '0'.repeat(63) + '1',
      prevHash: '0x' + '0'.repeat(64),
      txs: [],
      txCount: 0,
      miner: 'genesis',
      reward: 0,
      gasUsed: 0,
    });
    console.log('[chain] genesis block created');
  }
}

/**
 * Mine one block: fair-pick mempool txs, settle balances atomically-ish,
 * append block, confirm txs, notify users. Runs on an interval.
 */
async function mineOnce() {
  if (mining) return null;
  mining = true;
  try {
    const s = await getSettings();
    if (s.chainPaused) return null;

    const { picked } = await pickFairBatch();
    if (picked.length === 0) return null;

    // Mark processing (so concurrent miners/admins don't double-pick)
    const hashes = picked.map((t) => t.hash);
    await Transaction.updateMany(
      { hash: { $in: hashes }, status: { $in: ['pending', 'queued'] } },
      { $set: { status: 'processing' } }
    );

    const settled = [];
    const failed = [];

    for (const p of picked) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await settleOne(p.hash);
        if (res.ok) settled.push(p.hash);
        else failed.push({ hash: p.hash, reason: res.reason });
      } catch (e) {
        failed.push({ hash: p.hash, reason: e.message });
        // eslint-disable-next-line no-await-in-loop
        await Transaction.updateOne(
          { hash: p.hash },
          { $set: { status: 'failed', failureReason: e.message, processedAt: new Date() }, $inc: { attempts: 1 } }
        );
      }
    }

    // Append block even if some failed (failures are recorded on-chain as receipts)
    const last = await Block.findOne().sort({ number: -1 });
    const number = (last ? last.number : -1) + 1;
    const hash = blockHash(number, last ? last.hash : '0x0', settled);
    await Block.create({
      number,
      hash,
      prevHash: last ? last.hash : '0x0',
      txs: settled,
      txCount: settled.length,
      miner: 'tbt-miner',
      reward: Number(settled.length * 0.1).toFixed(4),
      gasUsed: settled.length * 21000,
    });

    if (settled.length) {
      await Transaction.updateMany(
        { hash: { $in: settled } },
        { $set: { status: 'confirmed', blockNumber: number, confirmations: 1, processedAt: new Date() } }
      );
      // Bump confirmations of recent blocks' txs (cheap finality simulation)
      await Transaction.updateMany(
        { status: 'confirmed', blockNumber: { $lt: number, $gte: number - 12 } },
        { $inc: { confirmations: 1 } }
      );
    }

    // Notify users (best-effort)
    for (const h of settled) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const tx = await Transaction.findOne({ hash: h });
        if (tx && tx.fromUser) {
          // eslint-disable-next-line no-await-in-loop
          const u = await User.findById(tx.fromUser);
          if (u) notifyUser(u, 'Transaction confirmed', `Sent ${tx.amount} ${env.TOKEN_SYMBOL} → ${tx.toAddress.slice(0, 10)}… in block #${number}`, h).catch(() => {});
        }
        if (tx && tx.toUser) {
          // eslint-disable-next-line no-await-in-loop
          const u2 = await User.findById(tx.toUser);
          if (u2 && String(u2._id) !== String(tx.fromUser)) {
            notifyUser(u2, 'Tokens received', `+${tx.amount} ${env.TOKEN_SYMBOL} from ${tx.fromAddress.slice(0, 10)}… (block #${number})`, h).catch(() => {});
          }
        }
      } catch (_) {
        /* ignore */
      }
    }

    if (settled.length || failed.length) {
      console.log(`[chain] block #${number}: ${settled.length} confirmed, ${failed.length} failed`);
    }
    return { number, settled, failed };
  } finally {
    mining = false;
  }
}

/**
 * Settle a single tx: debit sender (balance + unlock), credit receiver wallet if internal.
 * Handles faucet/mint (no sender debit) and burn (no receiver credit).
 */
async function settleOne(hash) {
  const tx = await Transaction.findOne({ hash });
  if (!tx) return { ok: false, reason: 'not found' };
  if (tx.status === 'confirmed') return { ok: true };

  tx.attempts += 1;

  const senderAddr = tx.fromAddress.toLowerCase();
  const receiverAddr = tx.toAddress.toLowerCase();

  if (tx.type === 'faucet' || tx.type === 'mint' || tx.type === 'reward') {
    await Wallet.updateOne({ address: receiverAddr }, { $inc: { balance: tx.amount } }, { upsert: false });
    // If receiver wallet doesn't exist yet (shouldn't happen), still confirm as external credit
    tx.status = 'confirming';
    await tx.save();
    return { ok: true };
  }

  // Debit sender
  const sender = await Wallet.findOne({ address: senderAddr });
  if (!sender) {
    tx.status = 'failed';
    tx.failureReason = 'Sender wallet not found';
    tx.processedAt = new Date();
    await tx.save();
    return { ok: false, reason: tx.failureReason };
  }
  const total = tx.amount + tx.fee;
  if ((sender.balance || 0) < total) {
    // Release lock, fail
    sender.lockedBalance = Math.max(0, (sender.lockedBalance || 0) - total);
    await sender.save();
    tx.status = 'failed';
    tx.failureReason = 'Insufficient balance at settlement';
    tx.processedAt = new Date();
    await tx.save();
    return { ok: false, reason: tx.failureReason };
  }
  sender.balance = Number((sender.balance - total).toFixed(4));
  sender.lockedBalance = Math.max(0, (sender.lockedBalance || 0) - total);
  sender.nonce += 1;
  await sender.save();

  if (tx.type !== 'burn') {
    const recv = await Wallet.findOne({ address: receiverAddr });
    if (recv) {
      recv.balance = Number((recv.balance + tx.amount).toFixed(4));
      await recv.save();
    }
    // else: external address — value leaves the internal ledger (settlement log only)
  }

  tx.status = 'confirming';
  await tx.save();
  return { ok: true };
}

function startMiner() {
  ensureGenesis().catch((e) => console.error('[chain] genesis error', e.message));
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    mineOnce().catch((e) => console.error('[chain] mine error', e.message));
  }, env.BLOCK_TIME_MS);
  console.log(`[chain] miner started (block every ${env.BLOCK_TIME_MS}ms)`);
  return timer;
}

module.exports = { startMiner, mineOnce, getHeight, ensureGenesis, settleOne };
