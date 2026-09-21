const validator = require('validator');

function isAddress(v) {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
}

function validateRegister(req, res, next) {
  const { name, email, password } = req.body || {};
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Name too short' });
  if (!email || !validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be 6+ chars' });
  next();
}

function validateSend(req, res, next) {
  const { toAddress, amount } = req.body || {};
  if (!isAddress(toAddress)) return res.status(400).json({ error: 'Invalid destination address (0x…)' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Amount must be > 0' });
  if (amt > 1_000_000_000) return res.status(400).json({ error: 'Amount too large' });
  next();
}

module.exports = { validateRegister, validateSend, isAddress };
