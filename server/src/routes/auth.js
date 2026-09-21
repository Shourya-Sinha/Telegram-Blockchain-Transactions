const express = require('express');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const AuditLog = require('../models/AuditLog');
const { signToken } = require('../utils/jwt');
const { linkCode } = require('../utils/crypto');
const { auth } = require('../middleware/auth');
const { validateRegister } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { getSettings } = require('../services/stats');
const { ethers } = require('ethers');
const { encrypt } = require('../utils/crypto');

const router = express.Router();

async function createDefaultWallet(user) {
  const w = ethers.Wallet.createRandom();
  const existing = await Wallet.findOne({ user: user._id });
  if (existing) return existing;
  return Wallet.create({
    user: user._id,
    address: w.address.toLowerCase(),
    label: 'Main wallet',
    encryptedKey: encrypt(w.privateKey),
    balance: 0,
  });
}

// POST /api/auth/register
router.post('/register', authLimiter, validateRegister, async (req, res, next) => {
  try {
    const s = await getSettings();
    if (s.registrationsOpen === false) return res.status(403).json({ error: 'Registrations are closed' });
    const { name, email, password } = req.body;
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await User.hashPassword(password);
    const userCount = await User.countDocuments();
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: userCount === 0 ? 'admin' : 'user', // first user becomes admin
      dailyLimit: s.dailySendLimit,
    });
    const wallet = await createDefaultWallet(user);
    await AuditLog.create({ actor: user._id, actorEmail: user.email, action: 'user.register', target: user.email });
    const token = signToken(user);
    res.status(201).json({
      token,
      user: publicUser(user),
      wallet: publicWallet(wallet),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await User.findOne({ email: String(email).toLowerCase() }).select('+passwordHash');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.status === 'banned') return res.status(403).json({ error: 'Account banned' });
    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken(user);
    const wallets = await Wallet.find({ user: user._id });
    res.json({ token, user: publicUser(user), wallets: wallets.map(publicWallet) });
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res, next) => {
  try {
    const wallets = await Wallet.find({ user: req.user._id });
    const Notification = require('../models/Notification');
    const unread = await Notification.countDocuments({ user: req.user._id, read: false });
    res.json({ user: publicUser(req.user), wallets: wallets.map(publicWallet), unreadNotifications: unread });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/link-code — generate Telegram link code
router.post('/link-code', auth, async (req, res, next) => {
  try {
    req.user.linkCode = linkCode();
    req.user.linkCodeExpires = new Date(Date.now() + 15 * 60 * 1000);
    await req.user.save();
    const env = require('../config/env');
    res.json({
      code: req.user.linkCode,
      expiresInMin: 15,
      botUsername: env.TELEGRAM_BOT_USERNAME || null,
      deepLink: env.TELEGRAM_BOT_USERNAME ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=link_${req.user.linkCode}` : null,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/unlink-telegram
router.post('/unlink-telegram', auth, async (req, res, next) => {
  try {
    req.user.telegramId = null;
    req.user.telegramUsername = null;
    await req.user.save();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

function publicUser(u) {
  return {
    id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    telegramId: u.telegramId,
    telegramUsername: u.telegramUsername,
    dailyLimit: u.dailyLimit,
    dailySent: u.dailySent,
    createdAt: u.createdAt,
  };
}

function publicWallet(w) {
  return {
    address: w.address,
    label: w.label,
    balance: w.balance,
    lockedBalance: w.lockedBalance,
    available: Math.max(0, (w.balance || 0) - (w.lockedBalance || 0)),
    nonce: w.nonce,
    isExternal: w.isExternal,
    createdAt: w.createdAt,
  };
}

module.exports = router;
module.exports.publicUser = publicUser;
module.exports.publicWallet = publicWallet;
