const express = require('express');
const { ethers } = require('ethers');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
const { faucetLimiter } = require('../middleware/rateLimit');
const { encrypt } = require('../utils/crypto');
const { faucetClaim } = require('../services/txService');
const { paginate } = require('../utils/paginate');
const { isAddress } = require('../middleware/validate');

const router = express.Router();
router.use(auth);

// GET /api/wallets
router.get('/', async (req, res, next) => {
  try {
    const wallets = await Wallet.find({ user: req.user._id }).sort({ createdAt: 1 });
    res.json({ wallets: wallets.map(fmt) });
  } catch (e) {
    next(e);
  }
});

// POST /api/wallets — create new custodial wallet (max 5)
router.post('/', async (req, res, next) => {
  try {
    const count = await Wallet.countDocuments({ user: req.user._id });
    if (count >= 5) return res.status(400).json({ error: 'Wallet limit reached (5)' });
    const w = ethers.Wallet.createRandom();
    const wallet = await Wallet.create({
      user: req.user._id,
      address: w.address.toLowerCase(),
      label: (req.body.label || `Wallet ${count + 1}`).slice(0, 40),
      encryptedKey: encrypt(w.privateKey),
      balance: 0,
    });
    res.status(201).json({ wallet: fmt(wallet) });
  } catch (e) {
    next(e);
  }
});

// POST /api/wallets/watch — add external watch-only address
router.post('/watch', async (req, res, next) => {
  try {
    const { address, label } = req.body || {};
    if (!isAddress(address)) return res.status(400).json({ error: 'Invalid address' });
    const exists = await Wallet.findOne({ address: address.toLowerCase(), user: req.user._id });
    if (exists) return res.status(409).json({ error: 'Already added' });
    const wallet = await Wallet.create({
      user: req.user._id,
      address: address.toLowerCase(),
      label: (label || 'Watched').slice(0, 40),
      isExternal: true,
      balance: 0,
    });
    res.status(201).json({ wallet: fmt(wallet) });
  } catch (e) {
    next(e);
  }
});

// POST /api/wallets/faucet
router.post('/faucet', faucetLimiter, async (req, res, next) => {
  try {
    const tx = await faucetClaim(req.user);
    res.status(201).json({ tx, message: `Faucet tx queued: ${tx.amount} tokens incoming` });
  } catch (e) {
    next(e);
  }
});

// GET /api/wallets/:address
router.get('/:address', async (req, res, next) => {
  try {
    const wallet = await Wallet.findOne({ address: req.params.address.toLowerCase(), user: req.user._id });
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    res.json({ wallet: fmt(wallet) });
  } catch (e) {
    next(e);
  }
});

// GET /api/wallets/:address/transactions
router.get('/:address/transactions', async (req, res, next) => {
  try {
    const addr = req.params.address.toLowerCase();
    const filter = { $or: [{ fromAddress: addr }, { toAddress: addr }] };
    if (req.query.status) filter.status = req.query.status;
    const result = await paginate(Transaction, filter, req.query);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

function fmt(w) {
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
