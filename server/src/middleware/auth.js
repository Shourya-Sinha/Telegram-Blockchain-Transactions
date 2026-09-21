const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const payload = verifyToken(token);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status === 'banned') return res.status(403).json({ error: 'Account banned' });
    req.user = user;
    req.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { auth };
