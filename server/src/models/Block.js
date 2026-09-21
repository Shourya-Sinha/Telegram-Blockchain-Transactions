const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true, index: true },
    hash: { type: String, required: true, unique: true },
    prevHash: { type: String, required: true },
    txs: { type: [String], default: [] }, // tx hashes
    txCount: { type: Number, default: 0 },
    miner: { type: String, default: 'tbt-miner' },
    reward: { type: Number, default: 0 },
    gasUsed: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now },
    anchor: {
      status: { type: String, enum: ['none', 'submitted', 'confirmed', 'failed'], default: 'none' },
      evmTxHash: { type: String, default: null },
      evmChainId: { type: Number, default: null },
      evmTo: { type: String, default: null },
      attempts: { type: Number, default: 0 },
      lastError: { type: String, default: null },
      confirmedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Block', blockSchema);
