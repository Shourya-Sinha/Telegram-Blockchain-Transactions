const express = require('express');
const mongoose = require('mongoose');
const env = require('../config/env');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'tbt-server',
    time: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    symbol: env.TOKEN_SYMBOL,
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
  });
});

module.exports = router;
