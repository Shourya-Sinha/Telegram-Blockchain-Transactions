const mongoose = require('mongoose');

// Lifecycle: pending -> queued -> processing -> confirming -> confirmed
// Alt terminals: failed | cancelled | rejected | requires_approval (+ admin approve/reject)
const txSchema = new mongoose.Schema(
  {
    hash: { type: String, required: true, unique: true, index: true },
    type: {
      type: String,
      enum: ['transfer', 'faucet', 'mint', 'reward', 'burn'],
      default: 'transfer',
      index: true,
    },
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    fromAddress: { type: String, required: true, lowercase: true, index: true },
    toAddress: { type: String, required: true, lowercase: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    fee: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: [
        'pending',
        'queued',
        'processing',
        'confirming',
        'confirmed',
        'failed',
        'cancelled',
        'rejected',
        'requires_approval',
      ],
      default: 'pending',
      index: true,
    },
    nonce: { type: Number, default: 0 },
    blockNumber: { type: Number, default: null, index: true },
    confirmations: { type: Number, default: 0 },
    failureReason: { type: String, default: null },
    idempotencyKey: { type: String, default: null, index: true },
    note: { type: String, default: null, maxlength: 280 },
    fairnessScore: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    processedAt: { type: Date, default: null },
    evmTxHash: { type: String, default: null }, // optional real-chain settlement ref
  },
  { timestamps: true }
);

txSchema.index({ fromAddress: 1, nonce: 1 }, { unique: false });
txSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', txSchema);
