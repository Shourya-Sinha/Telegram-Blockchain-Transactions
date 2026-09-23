# Red Envelope Wallet · Telegram Mini App

A TypeScript monorepo for a custodial Telegram Mini App (TMA) wallet and crypto red-envelope system. It keeps everyday user interactions off-chain and uses a PostgreSQL double-entry ledger; TRC20 USDT is used only at deposit and withdrawal boundaries.

> **Financial safety:** this repository contains a complete reference implementation, but a real deployment still needs an operational review, a Tron hot-wallet runbook, KMS/Vault integration, monitoring, and legal/compliance approval before accepting customer funds. Never use development secrets in production.

## What is included

```
apps/
  backend/       Express + TypeScript API, grammY bot, Prisma, BullMQ workers, TronWeb gateway
  frontend/      React/Vite Telegram Mini App with Wallet, DeFi, Yield and Apps tabs
  admin/         React/Vite operations console with JWT/MFA-ready login, charts and controls
packages/
  shared/        BigInt minor-unit money utilities and request schemas
```

The backend has:

- PostgreSQL-only persistence through Prisma and an explicit `WalletAccount` + `LedgerEntry` ledger.
- Row locks (`SELECT ... FOR UPDATE`) around every financial mutation and versioned wallet updates.
- Integer-only USDT arithmetic (`1 USDT = 1,000,000` minor units).
- HMAC-SHA256 Telegram `initData` validation; client-side Telegram identity is never trusted.
- Atomic random/equal envelope creation, claim, expiry refund and unique `[envelopeId, userId]` claims.
- Redis/BullMQ asynchronous withdrawals and TronGrid confirmation polling.
- Idempotent withdrawal keys, broadcast intent audit records, hot-wallet cap alerts and retry-safe outgoing transfer lookup.
- Redis rate limiting, Telegram group message counters, group account-age/claim policy, audit logs and emergency withdrawal/envelope switches.

## Local development

Requirements: Node.js 20+, Docker (recommended), and npm 10+.

1. Install dependencies:

   ```bash
   cp .env.example .env
   npm install
   ```

2. Start only infrastructure:

   ```bash
   docker compose up -d postgres redis
   ```

   Or run the complete stack with `docker compose up --build` after setting `.env`.

3. Create the Prisma client and database migration:

   ```bash
   npm run db:generate
   npm run db:migrate -- --name init
   npm run db:seed
   ```

   `db:seed` creates the admin account from `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_ROLE`. Change the password before using the admin panel.

4. Run the development servers in separate terminals:

   ```bash
   npm run dev --workspace=@red-envelope/backend   # API on :4000
   npm run dev --workspace=@red-envelope/frontend  # TMA on :5173
   npm run dev --workspace=@red-envelope/admin     # Admin on :5174
   ```

   Or use `npm run dev` to run all three with `concurrently`.

The Vite applications proxy `/api` to `http://localhost:4000`. Open the frontend inside Telegram for signed `initData`; a normal browser still renders a safe preview state, but wallet mutations correctly require Telegram authentication.

## Telegram setup

1. Create a bot with BotFather and set `BOT_TOKEN`.
2. Set a long random `TELEGRAM_WEBHOOK_SECRET`.
3. Expose the backend over HTTPS and set `TELEGRAM_WEBHOOK_URL=https://your-domain/telegram/webhook`.
4. The backend registers the webhook on startup and checks `X-Telegram-Bot-Api-Secret-Token` on every webhook request.
5. Configure the bot menu or `/start` to open the Mini App URL (`PUBLIC_APP_URL`).

The bot supports `/start`, `/balance`, `/deposit`, `/withdraw`, `/history`, `/help`, and `/redpacket <amount> <count>`. Its claim callback data is only the UUID envelope ID.

## Tron / deposits / withdrawals

Set the TRC20 network values in `.env`:

- `TRONGRID_API_KEY`, `TRON_FULL_HOST`, `TRON_USDT_CONTRACT`.
- `TRON_HOT_WALLET_ADDRESS` and `HOT_WALLET_PRIVATE_KEY`.
- `TRON_CONFIRMATIONS` defaults to 19.
- `HOT_WALLET_CAP_USDT` defaults to 500.

`HOT_WALLET_PRIVATE_KEY` is intentionally read only from the environment. In production replace the signing path with AWS KMS or HashiCorp Vault; do not put a private key in source control, Docker images, logs, or ordinary database fields.

The `User.depositAddress` field is the safe mapping point for a production deposit-address allocator. The deposit worker polls TRC20 transfers, resolves the recipient to a provisioned user deposit address, records the unique transaction as `PENDING`, and credits the ledger only when 19 confirmations are present. The demo `/api/deposit/address` returns the configured hot-wallet address so the UI is usable during development; before accepting funds, provision unique addresses and return that address from the route (or implement an approved memo/address allocation service). Do not credit a shared address without a verified user-to-address mapping.

Withdrawals reserve the requested amount and fee in the ledger before queueing. Amounts below `WITHDRAWAL_AUTO_APPROVAL_LIMIT` are queued automatically; larger requests remain queued until a finance/super admin approves them. A failed request is never silently re-credited: the original debit remains the auditable liability settlement and finance can retry only after checking the chain.

## Production Docker deployment

1. Provision a VPS with Docker and a reverse proxy/TLS certificate.
2. Clone the repository and create a locked-down `.env`:

   ```bash
   cp .env.example .env
   chmod 600 .env
   # edit every secret, URL, database password, wallet setting and CORS origin
   ```

3. Build and start:

   ```bash
   docker compose up -d --build
   docker compose logs -f backend
   ```

   The backend container runs `prisma migrate deploy` before starting. Do not run `migrate dev` against production.

4. Put TLS in front of ports 5173 (TMA), 5174 (admin) and 4000 (webhook/API), or route both static apps and `/api` through a single domain. Set `PUBLIC_APP_URL`, `TELEGRAM_WEBHOOK_URL`, and `CORS_ORIGINS` to HTTPS origins.
5. Back up PostgreSQL and Redis persistence, alert on `alert:hot-wallet-cap`, worker failures, pending withdrawals, failed deposits and reserve coverage. Rotate secrets and restrict admin access at the network layer.

## Important API surface

TMA routes use `X-Telegram-Init-Data`:

- `GET /api/me`, `/api/wallet`, `/api/ledger`, `/api/deposit/address`
- `POST /api/envelopes`, `GET /api/envelopes/:id`, `POST /api/envelopes/:id/claim`
- `POST /api/withdrawals`, `GET /api/withdrawals`

Admin routes use `Authorization: Bearer <JWT>`:

- `POST /api/admin/auth/login`
- `GET /api/admin/dashboard`, `/users`, `/withdrawals`, `/audit-logs`
- `POST /api/admin/withdrawals/:id/approve`, `/retry`
- `POST /api/admin/emergency/disable-withdrawals`, `/disable-envelopes`
- `GET /api/admin/settings`, `PUT /api/admin/settings/:chatId`

All JSON responses serialize PostgreSQL `BigInt` values as decimal strings. Never parse financial values through JavaScript floating point in a client that performs a mutation.

## Verification

```bash
npm run lint
npm run build
```

Before a funds-bearing launch, add a staging Tron integration test with a funded test wallet, concurrency tests for the claim and withdrawal transactions, webhook replay tests, a restore drill, dependency scanning, and an independent security review.
