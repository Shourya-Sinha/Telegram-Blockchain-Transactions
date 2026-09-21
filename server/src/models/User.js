const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    status: { type: String, enum: ['active', 'frozen', 'banned'], default: 'active', index: true },
    telegramId: { type: String, default: null, index: true, sparse: true },
    telegramUsername: { type: String, default: null },
    linkCode: { type: String, default: null, index: true },
    linkCodeExpires: { type: Date, default: null },
    dailyLimit: { type: Number, default: 10000 },
    dailySent: { type: Number, default: 0 },
    dailySentDay: { type: String, default: null }, // YYYY-MM-DD
    lastFaucetAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = async function (plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
};

module.exports = mongoose.model('User', userSchema);
