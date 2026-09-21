const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  message: { error: 'Too many auth attempts, try again later' },
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 sends/min per IP — anti-spam for fair mempool
  standardHeaders: 'draft-7',
  message: { error: 'Too many transactions, slow down (fair-use limit)' },
});

const faucetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  message: { error: 'Faucet rate limit exceeded' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: 'draft-7',
});

module.exports = { authLimiter, sendLimiter, faucetLimiter, generalLimiter };
