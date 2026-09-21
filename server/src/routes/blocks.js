const express = require('express');
const Block = require('../models/Block');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { getSettings } = require('../services/stats');
const { mempoolStats } = require('../services/mempool');
const { paginate } = require('../utils/paginate');
const env = require('../config/env');

const router = express.Router();

// GET /api/blocks — latest blocks (public explorer)
router.get('/', async (req, res, next) => {
  try {
    const result = await paginate(Block, {}, req.query, { number: -1 });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/explorer/stats — chain overview (public)
router.get('/explorer/stats', async (req, res, next) => {
  try {
    const [height, txCount, userCount, walletCount, mempool, settings] = await Promise.all([
      Block.countDocuments(),
      Transaction.countDocuments(),
      User.countDocuments(),
      Wallet.countDocuments(),
      mempoolStats(),
      getSettings(),
    ]);
    const confirmed = await Transaction.countDocuments({ status: 'confirmed' });
    const volumeAgg = await Transaction.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: null, volume: { $sum: '$amount' }, fees: { $sum: '$fee' } } },
    ]);
    const latest = await Block.findOne().sort({ number: -1 }).lean();
    res.json({
      symbol: env.TOKEN_SYMBOL,
      name: env.TOKEN_NAME,
      height: height ? height - 1 : 0,
      blocks: height,
      transactions: txCount,
      confirmed,
      users: userCount,
      wallets: walletCount,
      volume: volumeAgg[0]?.volume || 0,
      feesCollected: volumeAgg[0]?.fees || 0,
      mempool: mempool.total,
      latestBlock: latest,
      fairness: {
        maxTxPerBlock: settings.maxTxPerBlock,
        maxTxPerUserPerBlock: settings.maxTxPerUserPerBlock,
        policy: 'round-robin per sender + capped fee priority + FIFO',
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/blocks/search?q= — search tx hash / address / block number
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Query required' });
    if (/^\d+$/.test(q)) {
      const block = await Block.findOne({ number: Number(q) });
      if (block) return res.json({ type: 'block', block });
    }
    if (q.startsWith('0x') && q.length === 66) {
      const tx = await Transaction.findOne({ hash: q });
      if (tx) return res.json({ type: 'transaction', tx });
      const block = await Block.findOne({ hash: q });
      if (block) return res.json({ type: 'block', block });
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
      const wallet = await Wallet.findOne({ address: q.toLowerCase() });
      const txs = await Transaction.find({ $or: [{ fromAddress: q.toLowerCase() }, { toAddress: q.toLowerCase() }] })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      return res.json({ type: 'address', wallet, txs });
    }
    return res.status(404).json({ error: 'No block, transaction or address found' });
  } catch (e) {
    next(e);
  }
});

// GET /api/blocks/:number
router.get('/:number', async (req, res, next) => {
  try {
    const block = await Block.findOne({ number: Number(req.params.number) }).lean();
    if (!block) return res.status(404).json({ error: 'Block not found' });
    const txs = await Transaction.find({ hash: { $in: block.txs } }).lean();
    res.json({ block, txs });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
