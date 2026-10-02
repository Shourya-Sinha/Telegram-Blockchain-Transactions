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

**New to the envelope flow?** Read the complete [group setup, admin sending, and user claiming guide](docs/RED_ENVELOPE_GUIDE.md). It explains which wallet pays, how a group is discovered, what members tap, and how to test safely without real funds.

**Confused about where the money actually moves?** [`docs/MONEY_FLOW.md`](docs/MONEY_FLOW.md) traces one envelope end to end: who is debited and when, why an admin send charges the treasury and not the admin, how the WeChat-style random split stays exact, and why a claim costs zero Tron transactions.

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
4. The backend registers a public HTTPS webhook on startup and checks `X-Telegram-Bot-Api-Secret-Token` on every webhook request. For local development (`localhost`, `127.0.0.1`, or a missing webhook URL), it automatically removes the unreachable webhook and uses Telegram long polling instead.
5. Configure the bot menu or `/start` to open the Mini App URL (`PUBLIC_APP_URL`). On startup the backend also registers a persistent `🧧 Wallet` chat-menu button and the full bot command list automatically (the URL must be HTTPS, or `localhost` during development).
6. Add the bot to each destination group, promote it so it can send/edit messages and verify membership, then run `/registergroup` in that group.
7. Run `/myid` from the funded treasury Telegram account and set that number as `RED_ENVELOPE_TREASURY_TELEGRAM_ID` to enable admin-created envelopes.

The bot supports `/start`, `/wallet`, `/myid`, `/registergroup`, `/balance`, `/deposit`, `/withdraw`, `/history`, `/lang en|zh`, `/help`, and `/redpacket <amount> <count>`. Every envelope message carries a bilingual `💰 Open My Wallet · 打开钱包` button, and each successful claim triggers a private message with the claimer's wallet details and a Mini App button. `/wallet` and `/start` also work inside groups: the group reply shows only the Mini App launcher while wallet details go to the user's private chat. The Mini App and the admin console both include a 🇬🇧 EN / 🇨🇳 ZH flag selector; the Mini App choice is stored on the user record (`User.locale`) and the bot localizes its messages to match. See the [user guide](docs/USER_GUIDE.md) for the complete user-facing flow, the [red-envelope guide](docs/RED_ENVELOPE_GUIDE.md) for the exact end-to-end flow, and the [requirements status](docs/REQUIREMENTS_STATUS.md) for an honest implemented/partial/production-gate matrix.

## Tron / deposits / withdrawals

Set the TRC20 network values in `.env`:

- `TRONGRID_API_KEY`, `TRON_FULL_HOST`, `TRON_USDT_CONTRACT`.
- `TRON_HOT_WALLET_ADDRESS` and `HOT_WALLET_PRIVATE_KEY`.
- `TRON_CONFIRMATIONS` defaults to 19.
- `HOT_WALLET_CAP_USDT` defaults to 500.

`HOT_WALLET_PRIVATE_KEY` is intentionally read only from the environment. In production replace the signing path with AWS KMS or HashiCorp Vault; do not put a private key in source control, Docker images, logs, or ordinary database fields.

## Troubleshooting

**The backend used to exit with `AppError: Insufficient available balance` after sending an envelope.**
Two separate things were going on:

1. *The error itself is correct behaviour:* admin-sent envelopes are paid from the treasury wallet (`RED_ENVELOPE_TREASURY_TELEGRAM_ID`), and that wallet held less than the envelope total. Fund it and try again — in test mode either from the admin console (**Users → treasury account → Add test USDT**, requires `ALLOW_DEV_CREDIT=true`) or with `npm run db:dev-credit -- <treasury-telegram-id> <amount-usdt>`. The treasury account must have run `/start` once so its wallet exists. The **Send envelope** page shows the current treasury balance next to the form.
2. *The crash was a bug, and is fixed:* Express 4 does not forward rejections from `async` route handlers to the error middleware, so the rejection became an unhandled promise rejection — which Node terminates the process for by default. Every async route handler is now wrapped with `asyncHandler` (`src/utils/asyncHandler.ts`), so business errors return a clean 4xx JSON response (the admin console shows a localized toast; the Mini App shows it in the form). A `process.on('unhandledRejection')` safety net in `server.ts` logs anything that still slips through instead of letting it kill the bot/API/workers, and a static test fails the build if a route is ever registered unwrapped again.

**`BUTTON_TYPE_INVALID` when a command or envelope is used in a group.**
Telegram allows native `web_app` (Mini App) buttons in **private chats only** — attaching one to a group message makes Telegram reject the entire message. All group-facing keyboards therefore use a `t.me/<bot>?start=wallet` deep link instead: one tap opens the bot's private chat, where `/start wallet` replies with the balance and the native Mini App buttons. Private-chat messages keep the real `web_app` buttons. `chatAppKeyboard(label, chatType)` in `src/services/telegramService.ts` centralizes the choice, and the tests in `src/utils/groupKeyboard.test.ts` fail the build if a group-posted message ever carries a `web_app` button again.

As a last line of defense, `installGroupButtonGuard(bot)` installs a grammY API transformer that inspects **every** outgoing Telegram call: any `web_app` button still aimed at a group or channel (negative chat id) is automatically converted to the bot's `t.me` wallet deep link — or dropped if the bot username is not yet known — so the message always stays deliverable. When the backend starts you should see:

```
[telegram] group button guard active — web_app buttons cannot reach group messages
```

If you still see `BUTTON_TYPE_INVALID` but your console does **not** show that line, the running process is on old or locally modified code — pull the branch and restart (see below).

**Updating a machine with local modifications.**
If your working tree has local edits (for example hand-added debug logging like `[telegram] CHAT ID …` — these lines do not exist in the repository), the fixes on the branch are not what is running. Update with:

```bash
git stash                 # or commit your local logging changes
git pull origin arena/01a0fd71-telegram-blockchain-transactio
# resolve any conflicts by keeping the chatAppKeyboard/installGroupButtonGuard code
npm run dev --workspace=@red-envelope/backend   # or rebuild + restart for production
```

Then run `/start` in the group again and confirm the reply arrives with the wallet button.

**Funding the treasury without the CLI.**
The admin console's **Send envelope** page shows the treasury balance and, in test mode with `ALLOW_DEV_CREDIT=true`, an inline **Add test USDT to treasury** form — the same audited ledger operation as `npm run db:dev-credit -- <treasury-telegram-id> <amount>`, without leaving the panel.

The `User.depositAddress` field is the safe mapping point for a production deposit-address allocator. In `FUNDS_MODE=real` with `DEPOSIT_MODE=unique`, the deposit worker scans each provisioned address, records transaction hash, token contract, source, destination, amount and actual confirmation count, and credits the ledger only after the configured depth. `/api/deposit/address` returns only that user's assigned address; it fails closed when an address is unavailable and never substitutes the shared hot-wallet address. Address/key provisioning and sweeping must be integrated with reviewed custody or KMS/HSM infrastructure before accepting funds.

Withdrawals reserve the requested amount and fee in the ledger before queueing. Amounts below `WITHDRAWAL_AUTO_APPROVAL_LIMIT` are queued automatically; larger requests remain queued until a finance/super admin approves them. A failed request is never silently re-credited: the original debit remains the auditable liability settlement and finance can retry only after checking the chain.

### Simulated test withdrawals (why the button can be disabled)

In `FUNDS_MODE=test` the withdrawal button is disabled unless you set `TEST_WITHDRAWAL_ADDRESS` — a single required test TRC20 address. When set:

- Withdrawals are **simulated**: amount + fee are reserved and settled in one transaction, the record is marked `COMPLETED` with a `WITHDRAWAL_TEST_COMPLETED` audit entry, and **no TRC20 transaction is ever broadcast**.
- The Mini App locks the destination field to that address and the API rejects any other address with `403 TEST_WITHDRAWAL_ADDRESS_REQUIRED`.
- Every surface (Mini App banner, withdraw form, `/withdraw` bot reply, post-claim message) repeats the warning: *This is test currency only — no real USDT is sent or received.*
- Setting `TEST_WITHDRAWAL_ADDRESS` while `FUNDS_MODE=real` is a startup error.

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

- `GET /api/me` (includes `fundsMode`, `withdrawalMode` — `real` / `test` / `disabled` — plus `withdrawalMinMinor`, `withdrawalFeeMinor`, `testWithdrawalAddress`, `testCurrencyWarning` in test mode, and the stored `locale`), `/api/wallet`, `/api/ledger`, `/api/deposit/address`, `/api/deposits`, `POST /api/locale` (persist the 🇬🇧/🇨🇳 flag choice; the bot reads it for localized messages)
- `POST /api/envelopes`, `GET /api/envelopes/:id`, `POST /api/envelopes/:id/claim`
- `POST /api/withdrawals`, `GET /api/withdrawals`, `GET /api/withdrawals/:id`

Admin routes use `Authorization: Bearer <JWT>`:

- `POST /api/admin/auth/login`
- `GET /api/admin/dashboard`, `/users`, `/deposits`, `/withdrawals`, `/audit-logs`
- `POST /api/admin/withdrawals/:id/approve`, `/retry`, `/reject`
- `GET /api/admin/envelopes/setup`, `POST /api/admin/envelopes/send`
- `POST /api/admin/emergency/disable-withdrawals`, `/disable-envelopes`
- `GET /api/admin/settings`, `PUT /api/admin/settings/:chatId`

All JSON responses serialize PostgreSQL `BigInt` values as decimal strings. Never parse financial values through JavaScript floating point in a client that performs a mutation.

## Verification

```bash
npm run lint
npm run build
```

Before a funds-bearing launch, add a staging Tron integration test with a funded test wallet, concurrency tests for the claim and withdrawal transactions, webhook replay tests, a restore drill, dependency scanning, and an independent security review.
