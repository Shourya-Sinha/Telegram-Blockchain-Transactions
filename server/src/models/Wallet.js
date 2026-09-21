const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    address: { type: String, required: true, unique: true, index: true, lowercase: true },
    label: { type: String, default: 'Main wallet', maxlength: 40 },
    encryptedKey: { type: String, default: null, select: false }, // custodial only
    isExternal: { type: Boolean, default: false }, // watch-only / user-supplied
    balance: { type: Number, default: 0, min: 0 },
    lockedBalance: { type: Number, default: 0, min: 0 }, // funds in pending txs
    nonce: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

walletSchema.methods.available = function () {
  return Math.max(0, (this.balance || 0) - (this.lockedBalance || 0));
};

module.exports = mongoose.model('Wallet', walletSchema);
