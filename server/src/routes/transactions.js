const express = require('express');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const { auth } = require('../middleware/auth');
const { validateSend } = require('../middleware/validate');
const { sendLimiter } = require('../middleware/rateLimit');
const { createTransfer, cancelOwn } = require('../services/txService');
const { getSettings, calcFee } = require('../services/stats');
const { paginate } = require('../utils/paginate');
const { sendCSV, TX_COLUMNS } = require('../utils/csv');

const router = express.Router();
router.use(auth);

// GET /api/transactions/estimate?amount=10 — fee preview
router.get('/estimate', async (req, res, next) => {
  try {
    const s = await getSettings();
    const amount = Number(req.query.amount || 0);
    const fee = calcFee(amount, s);
    res.json({
      amount,
      fee,
      total: Number((amount + fee).toFixed(4)),
      feePercent: s.feePercent,
      feeMin: s.feeMin,
      needsApproval: s.largeTxApprovalThreshold > 0 && amount >= s.largeTxApprovalThreshold,
      approvalThreshold: s.largeTxApprovalThreshold,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/transactions/mine
router.get('/mine', async (req, res, next) => {
  try {
    const filter = { $or: [{ fromUser: req.user._id }, { toUser: req.user._id }] };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    const result = await paginate(Transaction, filter, req.query);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/transactions/notifications
router.get('/notifications', async (req, res, next) => {
  try {
    const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30).lean();
    const unread = await Notification.countDocuments({ user: req.user._id, read: false });
    res.json({ items, unread });
  } catch (e) {
    next(e);
  }
});

router.post('/notifications/read-all', async (req, res, next) => {
  try {
    await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/transactions/export — my history as CSV (must be before /:hash)
router.get('/export', async (req, res, next) => {
  try {
    const filter = { $or: [{ fromUser: req.user._id }, { toUser: req.user._id }] };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    const rows = await Transaction.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
    sendCSV(res, 'my-transactions.csv', TX_COLUMNS, rows);
  } catch (e) {
    next(e);
  }
});

// POST /api/transactions/send
router.post('/send', sendLimiter, validateSend, async (req, res, next) => {
  try {
    const { tx, duplicate, needsApproval } = await createTransfer(req.user, {
      fromAddress: req.body.fromAddress,
      toAddress: req.body.toAddress,
      amount: req.body.amount,
      note: req.body.note,
      idempotencyKey: req.body.idempotencyKey || req.headers['idempotency-key'],
    });
    res.status(duplicate ? 200 : 201).json({
      tx,
      duplicate,
      message: needsApproval
        ? 'Large transfer queued for admin approval'
        : 'Transaction submitted to mempool',
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/transactions/:hash
router.get('/:hash', async (req, res, next) => {
  try {
    const tx = await Transaction.findOne({ hash: req.params.hash });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ tx });
  } catch (e) {
    next(e);
  }
});

// POST /api/transactions/:hash/cancel
router.post('/:hash/cancel', async (req, res, next) => {
  try {
    const tx = await cancelOwn(req.user, req.params.hash);
    res.json({ tx, message: 'Transaction cancelled, funds unlocked' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
