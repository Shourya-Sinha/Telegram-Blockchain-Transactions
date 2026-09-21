const Transaction = require('../models/Transaction');
const { fairBatch } = require('../utils/fairness');
const { getSettings } = require('./stats');

/**
 * Mempool lives in Mongo (status pending|queued) so it survives restarts
 * and is visible to the admin dashboard. This module is the fair selector.
 */
async function listPending(limit = 500) {
  return Transaction.find({ status: { $in: ['pending', 'queued'] } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
}

async function pickFairBatch() {
  const s = await getSettings();
  const pending = await listPending(500);
  const feeCap = Math.max(s.feeMin * 50, 1); // bounded fee advantage
  return {
    ...fairBatch(pending, {
      maxPerBlock: s.maxTxPerBlock,
      perUserCap: s.maxTxPerUserPerBlock,
      feeCap,
    }),
    settings: s,
  };
}

async function mempoolStats() {
  const rows = await Transaction.aggregate([
    { $match: { status: { $in: ['pending', 'queued', 'processing', 'requires_approval'] } } },
    { $group: { _id: '$status', count: { $sum: 1 }, volume: { $sum: '$amount' } } },
  ]);
  const bySender = await Transaction.aggregate([
    { $match: { status: { $in: ['pending', 'queued'] } } },
    { $group: { _id: '$fromAddress', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);
  return { rows, bySender, total: rows.reduce((a, r) => a + r.count, 0) };
}

module.exports = { listPending, pickFairBatch, mempoolStats };
