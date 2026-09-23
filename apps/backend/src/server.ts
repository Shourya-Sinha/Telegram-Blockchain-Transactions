import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';
import { config, assertProductionConfig } from './config';
import { userRouter } from './routes/userRoutes';
import { adminRouter } from './routes/adminRoutes';
import { createTelegramBot } from './bot/bot';
import { startWorkers } from './jobs/workers';
import { AppError } from './utils/errors';

assertProductionConfig();
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (origin, callback) => {
  if (!origin || config.corsOrigins.includes(origin) || config.nodeEnv !== 'production') { callback(null, true); return; }
  callback(new Error('Origin not allowed by CORS'));
}, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'red-envelope-backend', time: new Date().toISOString() }));
app.get('/ready', (_req, res) => res.json({ ok: true }));
app.use('/api/admin', adminRouter);
app.use('/api', userRouter);

const bot = config.botToken ? createTelegramBot() : null;
app.post('/telegram/webhook', async (req, res, next) => {
  if (!bot) { res.status(503).json({ error: 'Telegram bot is not configured' }); return; }
  if (req.header('x-telegram-bot-api-secret-token') !== config.telegramWebhookSecret) { res.status(401).json({ error: 'Invalid webhook secret' }); return; }
  try { await bot.handleUpdate(req.body); res.sendStatus(200); } catch (error) { next(error); }
});

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;
  let status = 500;
  let message = 'An unexpected error occurred';
  let code = 'INTERNAL_ERROR';
  if (error instanceof AppError) { status = error.statusCode; message = error.message; code = error.code; }
  else if (error instanceof ZodError) { status = 400; message = error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; '); code = 'VALIDATION_ERROR'; }
  else if (typeof error === 'object' && error !== null && 'code' in error && String((error as { code?: unknown }).code).startsWith('P')) { const prismaCode = String((error as { code?: unknown }).code); status = prismaCode === 'P2002' ? 409 : 500; message = prismaCode === 'P2002' ? 'A record with these values already exists' : 'Database operation failed'; code = prismaCode; }
  else if (error instanceof Error && error.message === 'Origin not allowed by CORS') { status = 403; message = error.message; code = 'CORS_ERROR'; }
  if (status >= 500) console.error('[uncaught-error]', { path: req.path, error });
  res.status(status).json({ error: message, code });
};
app.use(errorHandler);

if (config.nodeEnv !== 'test') {
  startWorkers();
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`[backend] listening on 0.0.0.0:${config.port}`));
  if (bot && process.env.TELEGRAM_WEBHOOK_URL) {
    void bot.api.setWebhook(process.env.TELEGRAM_WEBHOOK_URL, { secret_token: config.telegramWebhookSecret }).then(() => console.log('[telegram] webhook configured')).catch((error) => console.error('[telegram-webhook]', error));
  }
  const shutdown = () => { server.close(() => process.exit(0)); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}

export { app };
