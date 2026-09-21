const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const connectDB = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimit');
const { startMiner } = require('./services/chain');
const { ensureSettings } = require('./services/stats');
const { startBot } = require('./bot/bot');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallets');
const txRoutes = require('./routes/transactions');
const blockRoutes = require('./routes/blocks');
const adminRoutes = require('./routes/admin');
const healthRoutes = require('./routes/health');

const app = express();
app.use(helmet());
app.use(cors({ origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(morgan('dev'));
app.use(generalLimiter);

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/transactions', txRoutes);
app.use('/api/blocks', blockRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => {
  res.json({ service: 'telegram-blockchain-transactions', symbol: env.TOKEN_SYMBOL, docs: '/api/health' });
});

app.use(notFound);
app.use(errorHandler);

async function boot() {
  await connectDB();
  await ensureSettings();
  startMiner();
  startBot();
  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`[server] listening on :${env.PORT} (${env.TOKEN_SYMBOL})`);
  });
}

boot().catch((e) => {
  console.error('[server] boot failed', e);
  process.exit(1);
});
