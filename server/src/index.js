const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const connectDB = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimit');
const { pulse } = require('./middleware/pulse');
const { initSocket } = require('./realtime/socket');
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
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(morgan('dev'));
app.use(generalLimiter);
app.use(pulse); // live pulse: every API hit streams to admins over WebSocket

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

  const server = http.createServer(app);
  initSocket(server);

  startMiner();
  startBot();

  // Background: Sepolia anchor retries (no-op when anchoring is off)
  const { retryPendingAnchors } = require('./services/evmAnchor');
  setInterval(() => {
    retryPendingAnchors(5).catch(() => {});
  }, 60000);

  // Background: public chain tick for live UIs (height + mempool)
  setInterval(async () => {
    try {
      const Block = require('./models/Block');
      const { mempoolStats } = require('./services/mempool');
      const { emitPublic } = require('./realtime/socket');
      const [blocks, mempool] = await Promise.all([Block.countDocuments(), mempoolStats()]);
      emitPublic('chain:tick', {
        time: new Date().toISOString(),
        height: blocks ? blocks - 1 : 0,
        mempool: mempool.total,
      });
    } catch (_) {
      /* ignore */
    }
  }, 15000);

  server.listen(env.PORT, '0.0.0.0', () => {
    console.log(`[server] listening on :${env.PORT} (${env.TOKEN_SYMBOL}) + socket.io`);
  });
}

boot().catch((e) => {
  console.error('[server] boot failed', e);
  process.exit(1);
});
