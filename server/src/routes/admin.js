const express = require('express');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Block = require('../models/Block');
const Setting = require('../models/Setting');
const AuditLog = require('../models/AuditLog');
const { auth } = require('../middleware/auth');
const { admin } = require('../middleware/admin');
const { paginate } = require('../utils/paginate');
const { getSettings } = require('../services/stats');
const { mempoolStats, listPending } = require('../services/mempool');
const { adminMint } = require('../services/txService');
const { mineOnce } = require('../services/chain');
const { sendTelegramMessage } = require('../services/telegram');
const { isAddress } = require('../middleware/validate');
const { pulseSummary } = require('../middleware/pulse');
const { sendCSV, dateRange, TX_COLUMNS } = require('../utils/csv');
const { evmStatus, retryPendingAnchors, SEPOLIA_EXPLORER } = require('../services/evmAnchor');
const { emitAll, onlineCount } = require('../realtime/socket');

const router = express.Router();
router.use(auth, admin);

function audit(req, action, target = null, detail = null) {
  return AuditLog.create({
    actor: req.user._id,
    actorEmail: req.user.email,
    action,
    target,
    detail,
    ip: req.ip,
  }).catch(() => {});
}

// GET /api/admin/overview
router.get('/overview', async (req, res, next) => {
  try {
    const [users, wallets, txTotal, blocks, mempool, settings] = await Promise.all([
      User.countDocuments(),
      Wallet.countDocuments(),
      Transaction.countDocuments(),
      Block.countDocuments(),
      mempoolStats(),
      getSettings(),
    ]);
    const byStatus = await Transaction.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, volume: { $sum: '$amount' } } },
    ]);
    const last24h = await Transaction.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } });
    const newUsers24h = await User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } });
    const supplyAgg = await Wallet.aggregate([{ $group: { _id: null, supply: { $sum: '$balance' } } }]);
    // 14-day tx chart
    const daily = await Transaction.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 14 * 86400000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 }, volume: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({
      users,
      wallets,
      transactions: txTotal,
      blocks,
      byStatus,
      last24h,
      newUsers24h,
      supply: supplyAgg[0]?.supply || 0,
      mempool,
      daily,
      settings,
      online: onlineCount(),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.role) filter.role = req.query.role;
    if (req.query.search) {
      const s = req.query.search;
      filter.$or = [{ email: new RegExp(s, 'i') }, { name: new RegExp(s, 'i') }, { telegramUsername: new RegExp(s, 'i') }];
    }
    const result = await paginate(User, filter, req.query);
    // attach wallet balances
    const userIds = result.items.map((u) => u._id);
    const wallets = await Wallet.find({ user: { $in: userIds } }).lean();
    const byUser = {};
    for (const w of wallets) {
      const k = String(w.user);
      byUser[k] = byUser[k] || { balance: 0, count: 0 };
      byUser[k].balance += w.balance || 0;
      byUser[k].count += 1;
    }
    result.items = result.items.map((u) => ({ ...u, wallets: byUser[String(u._id)] || { balance: 0, count: 0 } }));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (String(user._id) === String(req.user._id) && (req.body.status === 'banned' || req.body.role === 'user')) {
      return res.status(400).json({ error: 'You cannot demote/ban yourself' });
    }
    const { status, role, dailyLimit } = req.body || {};
    if (status && ['active', 'frozen', 'banned'].includes(status)) user.status = status;
    if (role && ['user', 'admin'].includes(role)) user.role = role;
    if (dailyLimit !== undefined) user.dailyLimit = Math.max(0, Number(dailyLimit) || 0);
    await user.save();
    await audit(req, 'user.update', user.email, { status: user.status, role: user.role, dailyLimit: user.dailyLimit });
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/transactions
router.get('/transactions', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.search) {
      const s = req.query.search;
      filter.$or = [{ hash: new RegExp(s, 'i') }, { fromAddress: new RegExp(s, 'i') }, { toAddress: new RegExp(s, 'i') }];
    }
    const result = await paginate(Transaction, filter, req.query);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/transactions/:hash/approve (requires_approval -> pending)
router.post('/transactions/:hash/approve', async (req, res, next) => {
  try {
    const tx = await Transaction.findOne({ hash: req.params.hash });
    if (!tx) return res.status(404).json({ error: 'Not found' });
    if (tx.status !== 'requires_approval') return res.status(400).json({ error: `Cannot approve ${tx.status} tx` });
    tx.status = 'pending';
    await tx.save();
    await audit(req, 'tx.approve', tx.hash, { amount: tx.amount });
    res.json({ tx });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/transactions/:hash/reject
router.post('/transactions/:hash/reject', async (req, res, next) => {
  try {
    const tx = await Transaction.findOne({ hash: req.params.hash });
    if (!tx) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'queued', 'requires_approval'].includes(tx.status)) {
      return res.status(400).json({ error: `Cannot reject ${tx.status} tx` });
    }
    if (tx.type === 'transfer') {
      const total = tx.amount + tx.fee;
      await Wallet.updateOne({ address: tx.fromAddress }, { $inc: { lockedBalance: -total } });
      await Wallet.updateMany({ lockedBalance: { $lt: 0 } }, { $set: { lockedBalance: 0 } });
    }
    tx.status = 'rejected';
    tx.failureReason = req.body.reason || `Rejected by admin ${req.user.email}`;
    tx.processedAt = new Date();
    await tx.save();
    await audit(req, 'tx.reject', tx.hash, { reason: tx.failureReason });
    res.json({ tx });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/transactions/:hash/retry (failed -> pending)
router.post('/transactions/:hash/retry', async (req, res, next) => {
  try {
    const tx = await Transaction.findOne({ hash: req.params.hash });
    if (!tx) return res.status(404).json({ error: 'Not found' });
    if (tx.status !== 'failed') return res.status(400).json({ error: 'Only failed txs can be retried' });
    tx.status = 'pending';
    tx.failureReason = null;
    await tx.save();
    await audit(req, 'tx.retry', tx.hash);
    res.json({ tx });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/mempool
router.get('/mempool', async (req, res, next) => {
  try {
    const [stats, pending] = await Promise.all([mempoolStats(), listPending(100)]);
    res.json({ stats, pending });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/mempool/:hash — drop a pending tx (unlocks funds)
router.delete('/mempool/:hash', async (req, res, next) => {
  try {
    const tx = await Transaction.findOne({ hash: req.params.hash });
    if (!tx) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'queued'].includes(tx.status)) return res.status(400).json({ error: `Cannot drop ${tx.status} tx` });
    if (tx.type === 'transfer') {
      await Wallet.updateOne({ address: tx.fromAddress }, { $inc: { lockedBalance: -(tx.amount + tx.fee) } });
      await Wallet.updateMany({ lockedBalance: { $lt: 0 } }, { $set: { lockedBalance: 0 } });
    }
    tx.status = 'cancelled';
    tx.failureReason = `Dropped from mempool by admin ${req.user.email}`;
    tx.processedAt = new Date();
    await tx.save();
    await audit(req, 'mempool.drop', tx.hash);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/mine — force-mine a block now
router.post('/mine', async (req, res, next) => {
  try {
    const result = await mineOnce();
    await audit(req, 'chain.mine', result ? `block-${result.number}` : 'empty');
    res.json({ result: result || { message: 'Nothing to mine' } });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/mint
router.post('/mint', async (req, res, next) => {
  try {
    const { toAddress, amount } = req.body || {};
    if (!isAddress(toAddress)) return res.status(400).json({ error: 'Invalid address' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1e9) return res.status(400).json({ error: 'Invalid amount' });
    const tx = await adminMint(toAddress, amt, req.user);
    await audit(req, 'tx.mint', toAddress, { amount: amt });
    res.status(201).json({ tx });
  } catch (e) {
    next(e);
  }
});

// GET/PUT /api/admin/settings
router.get('/settings', async (req, res, next) => {
  try {
    const docs = await Setting.find({}).lean();
    res.json({ settings: docs });
  } catch (e) {
    next(e);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const allowed = ['feePercent', 'feeMin', 'maxTxPerBlock', 'maxTxPerUserPerBlock', 'faucetAmount', 'faucetCooldownMs', 'dailySendLimit', 'largeTxApprovalThreshold', 'chainPaused', 'registrationsOpen', 'evmAnchorMode', 'evmAnchorAddress'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        let v = req.body[k];
        if (k === 'evmAnchorMode' && !['off', 'post'].includes(v)) {
          return res.status(400).json({ error: 'evmAnchorMode must be off|post' });
        }
        if (k === 'evmAnchorAddress' && v && !isAddress(v)) {
          return res.status(400).json({ error: 'Invalid evmAnchorAddress' });
        }
        updates[k] = v;
        // eslint-disable-next-line no-await-in-loop
        await Setting.updateOne({ key: k }, { $set: { value: v } }, { upsert: true });
      }
    }
    await audit(req, 'settings.update', null, updates);
    const settings = await getSettings();
    res.json({ settings });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/audit
router.get('/audit', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.action) filter.action = new RegExp(req.query.action, 'i');
    const result = await paginate(AuditLog, filter, req.query);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/broadcast — Telegram broadcast to linked users + realtime to all online
router.post('/broadcast', async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message || message.length < 2) return res.status(400).json({ error: 'Message required' });
    const users = await User.find({ telegramId: { $ne: null }, status: 'active' }).select('telegramId').lean();
    let sent = 0;
    for (const u of users) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await sendTelegramMessage(u.telegramId, `📢 <b>Announcement</b>\n${message}`);
      if (ok) sent += 1;
    }
    emitAll('announcement', { message, time: new Date().toISOString(), online: onlineCount() });
    await audit(req, 'broadcast', null, { message: message.slice(0, 120), sent, total: users.length });
    res.json({ sent, total: users.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/pulse — live API-hit buffer + per-route stats + rpm (streams live via socket)
router.get('/pulse', async (req, res) => {
  res.json({ ...pulseSummary(), online: onlineCount() });
});

// GET /api/admin/evm — Sepolia anchoring status + recent anchors
router.get('/evm', async (req, res, next) => {
  try {
    const [status, recent, counts] = await Promise.all([
      evmStatus(),
      Block.find({ 'anchor.evmTxHash': { $ne: null } }).sort({ number: -1 }).limit(5).lean(),
      Block.aggregate([{ $group: { _id: '$anchor.status', count: { $sum: 1 } } }]),
    ]);
    res.json({ status, recent, counts, explorer: SEPOLIA_EXPLORER });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/evm/retry — run the anchor retry worker now
router.post('/evm/retry', async (req, res, next) => {
  try {
    const result = await retryPendingAnchors(10);
    await audit(req, 'evm.retry', null, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/export/:dataset — CSV exports (users|transactions|blocks|audit)
router.get('/export/:dataset', async (req, res, next) => {
  try {
    const { dataset } = req.params;
    const range = dateRange(req.query);
    const CAP = 10000;

    if (dataset === 'users') {
      const filter = { ...range };
      if (req.query.status) filter.status = req.query.status;
      if (req.query.role) filter.role = req.query.role;
      if (req.query.search) {
        const s = req.query.search;
        filter.$or = [{ email: new RegExp(s, 'i') }, { name: new RegExp(s, 'i') }];
      }
      const rows = await User.find(filter).sort({ createdAt: -1 }).limit(CAP).lean();
      await audit(req, 'export.users', null, { count: rows.length });
      return sendCSV(res, 'tbt-users.csv', [
        { key: 'name', label: 'name' },
        { key: 'email', label: 'email' },
        { key: 'role', label: 'role' },
        { key: 'status', label: 'status' },
        { key: 'telegramUsername', label: 'telegram' },
        { key: 'dailySent', label: 'daily_sent' },
        { key: 'dailyLimit', label: 'daily_limit' },
        { key: 'createdAt', label: 'created_at' },
      ], rows);
    }

    if (dataset === 'transactions') {
      const filter = { ...range };
      if (req.query.status) filter.status = req.query.status;
      if (req.query.type) filter.type = req.query.type;
      if (req.query.search) {
        const s = req.query.search;
        filter.$or = [{ hash: new RegExp(s, 'i') }, { fromAddress: new RegExp(s, 'i') }, { toAddress: new RegExp(s, 'i') }];
      }
      const rows = await Transaction.find(filter).sort({ createdAt: -1 }).limit(CAP).lean();
      await audit(req, 'export.transactions', null, { count: rows.length });
      return sendCSV(res, 'tbt-transactions.csv', TX_COLUMNS, rows);
    }

    if (dataset === 'blocks') {
      const rows = await Block.find({}).sort({ number: -1 }).limit(CAP).lean();
      await audit(req, 'export.blocks', null, { count: rows.length });
      return sendCSV(res, 'tbt-blocks.csv', [
        { key: 'number', label: 'number' },
        { key: 'hash', label: 'hash' },
        { key: 'prevHash', label: 'prev_hash' },
        { key: 'txCount', label: 'tx_count' },
        { key: 'miner', label: 'miner' },
        { key: 'reward', label: 'reward' },
        { key: 'timestamp', label: 'timestamp' },
        { label: 'anchor_status', get: (r) => r.anchor?.status || 'none' },
        { label: 'evm_tx', get: (r) => r.anchor?.evmTxHash || '' },
      ], rows);
    }

    if (dataset === 'audit') {
      const filter = { ...range };
      if (req.query.action) filter.action = new RegExp(req.query.action, 'i');
      const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(CAP).lean();
      return sendCSV(res, 'tbt-audit.csv', [
        { key: 'createdAt', label: 'time' },
        { key: 'actorEmail', label: 'actor' },
        { key: 'action', label: 'action' },
        { key: 'target', label: 'target' },
        { key: 'detail', label: 'detail' },
        { key: 'ip', label: 'ip' },
      ], rows);
    }

    return res.status(404).json({ error: 'Unknown dataset (users|transactions|blocks|audit)' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
