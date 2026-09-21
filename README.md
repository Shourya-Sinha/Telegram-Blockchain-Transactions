# ⛓️ Telegram Blockchain Transactions (TBT Chain)

A complete **MERN + Telegram bot + Admin dashboard** blockchain-transaction platform with a
**fair mempool** — every user gets a fair chance to land in the next block, no matter how big the whales are.

Live by default: **WebSocket feeds, per-hit API pulse, instant notifications, Sepolia testnet
anchoring, and one-click CSV exports** — all included.

---

## ✨ Features

### 👤 User side
- **Register / Login (JWT)** — first user auto-becomes admin; every account gets a free custodial wallet
- **Up to 5 wallets** + external watch-only addresses, AES-256 encrypted keys
- **Send with live fee estimate** — see fee, total debit, and whether admin approval is needed
- **🚰 Faucet** — free test tokens with cooldown (rate-limited, anti-abuse)
- **Cancel pending txs** — funds unlock instantly, daily quota rolls back
- **Notifications inbox** + **Telegram alerts** + **instant WebSocket toasts** for confirms/incoming funds
- **⬇ CSV export** of your transaction history (respects active filter)
- **Public explorer** — blocks, transactions, addresses, search — **streaming live**

### ⚡ Realtime (Socket.IO)
No refresh button needed anywhere:

| Channel | Who | Events |
|---|---|---|
| `public` | everyone (even logged out) | `block:mined`, `tx:confirmed`, `mempool:update`, `chain:tick`, `anchor:confirmed`, `announcement` |
| `user:{id}` | one user | `tx:submitted`, `tx:confirmed`, `tx:failed`, `tx:cancelled`, `notification:new` |
| `admin` | all admins | `pulse:hit` (every API call), `tx:approval_needed`, `presence` (online count) |

- **Live feed** on Dashboard + Explorer — blocks and transfers appear the moment they're mined
- **Live pulse** — Admin → *Live Pulse* streams every API hit (method, path, status, ms, user, IP),
  with req/min chart, top-routes table, pause + filter
- **Event toasts** — confirms, failures, approvals, broadcasts pop up instantly in-app
- Balances, mempool, and approval queues **auto-refresh on socket events** (polling is only a fallback)

### 🛠 Admin dashboard (`/admin`)
- **Overview** — users, txs, blocks, supply, online-now count, status breakdown, 14-day chart, mempool snapshot
- **Live Pulse** — streaming API-hit console (see above)
- **⛏ Mine now** — force a block; **🪙 Mint** tokens; **📢 Broadcast** to Telegram-linked users **and** everyone online
- **Users** — search, freeze / ban / activate, promote to admin, per-user daily limits, **CSV export**
- **Transactions** — filter, **approve / reject** large transfers, **retry** failed ones, **CSV export**
- **Mempool** — live queue, spam-watch (top senders), drop txs (auto-refund)
- **Settings** — fees, block capacity, **fairness cap**, faucet, daily limits, approval threshold, pause chain, close signups, **Sepolia anchor mode**
- **Audit log** — every admin action recorded with actor + IP, **CSV export**
- **🔗 Sepolia panel** — anchor status, signer balance, recent anchors with Etherscan links, retry worker

### 🔗 Sepolia testnet anchoring
Every TBT block can be anchored to **Ethereum Sepolia** as a 0-value tx whose calldata embeds
`block number | block hash | tx-root | timestamp` — public Proof-of-Existence verifiable on Etherscan.

- `off` (default): zero-config, embedded chain only
- `post`: anchor every block; **mining never waits** — async worker + receipt tracking + retries
- Explorer shows a **🔗 Sepolia** badge per block linking to the anchor tx
- Setup: get a free RPC URL (Alchemy/Infura) + funded Sepolia key → set `EVM_RPC_URL` /
  `EVM_SETTLEMENT_KEY` → Admin → Settings → `evmAnchorMode = post`

### ⚖️ Fairness engine (the heart of this project)
Naive fee-sorted mempools let one spammer fill every block. TBT instead:

1. Groups pending txs **by sender**
2. Orders senders by **who waited longest** (FIFO across users)
3. Takes at most **N txs per sender per block** (default 2), **round-robin**, until the block is full (default 10)
4. **Caps fee advantage** (50× min-fee) and adds a **waiting-time boost**

Result: with 5 or fewer racing senders, *everyone* lands in the next block. Beyond that it degrades
to round-robin — never starvation. See `server/src/utils/fairness.js`.

### 🔒 Real-world transaction handling
- States: `pending → queued → processing → confirming → confirmed`, plus `failed / cancelled / rejected / requires_approval`
- **Balance locking** at submit, released on cancel/reject/fail-drop (no double-spend)
- **Idempotency keys** (safe retries), **per-wallet nonces**, **FIFO per sender**
- **Daily send limits** (per-user, auto-reset), **large-tx admin approval**
- **Failure receipts** with reasons, **retry** path, **confirmations counter**
- Rate limits on auth / send / faucet, Helmet, input validation, audit trail

### ✈️ Telegram bot
Link from Dashboard → *Link Telegram*, then in chat:

| Command | What it does |
|---|---|
| `/link <CODE>` | Link your account |
| `/balance` | All wallet balances |
| `/address` | Your deposit address |
| `/history` | Recent transactions |
| `/send <0x…> <amount>` | Send from chat |
| `/faucet` | Claim test tokens |
| `/unlink` | Unlink Telegram |

Plus automatic **✅ confirmed / 💰 received / 📢 announcement** pushes.

---

## 🏗 Architecture

```
Telegram-Blockchain-Transactions/
├── server/                 # Express + Mongoose + miner + Telegram bot + Socket.IO
│   └── src/
│       ├── config/         # env, db
│       ├── models/         # User, Wallet, Transaction, Block(+anchor), Setting, AuditLog, Notification
│       ├── routes/         # auth, wallets, transactions, blocks(explorer), admin, health
│       ├── services/       # chain(miner), mempool, txService, stats, telegram, evmAnchor
│       ├── realtime/       # socket.io rooms + emitters
│       ├── middleware/     # auth, admin, rateLimit, pulse(api-hit stream), errorHandler
│       ├── bot/            # Telegraf bot
│       └── utils/          # fairness engine, jwt, crypto, paginate, csv
├── client/                 # React 18 + Vite + Tailwind + Recharts + socket.io-client
│   └── src/
│       ├── realtime/       # socket singleton + useSocketEvent hook
│       ├── pages/          # Landing, Login, Register, Dashboard, Explorer
│       └── pages/admin/    # AdminDashboard (7 tabs incl. Live Pulse)
└── docker-compose.yml      # mongo + server + client
```

**How a transfer flows:** `POST /transactions/send` → validate → lock balance → mempool (`pending`)
→ socket `tx:submitted` → miner ticks every `BLOCK_TIME_MS` → fair-pick batch → settle debits/credits
→ append **Block** → socket `block:mined` + `tx:confirmed` → notify sender + receiver (in-app toast +
Telegram) → async **Sepolia anchor** → `anchor:confirmed`.

---

## 🚀 Quick start

### 1) Prereqs
- Node.js 18+ · MongoDB running locally (or Docker)

### 2) Install
```bash
npm run install:all
cp server/.env.example server/.env
# edit server/.env (at least JWT_SECRET + WALLET_ENCRYPTION_KEY for production)
```

Generate a wallet encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3) Seed admin + genesis block
```bash
npm run seed --prefix server
# → admin@tbt.local / Admin123!  (+ 1,000,000 TBT treasury)
```

### 4) Run (two terminals, or `npm run dev` from root)
```bash
npm run dev --prefix server   # API :5000 (+ socket.io)
npm run dev --prefix client   # Web :5173
```

Open **http://localhost:5173** → Register → Faucet → Send → watch it confirm live (~10s, no refresh) →
link Telegram → explore `/admin` → open **Live Pulse** and click around to see every hit stream in.

### 5) Telegram bot (optional, 2 min)
1. Chat with [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token
2. Put `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` in `server/.env`, restart server
3. Dashboard → *Link Telegram* → open the deep link → `/balance` 🎉

### 6) Sepolia anchoring (optional)
1. Free RPC URL from Alchemy/Infura (Sepolia) → `EVM_RPC_URL`
2. Export a Sepolia-funded private key (testnet only!) → `EVM_SETTLEMENT_KEY`
3. Restart server → Admin → Settings → `evmAnchorMode = post` → Save
4. Mine/send a tx → Overview shows the anchor → Explorer block gets a 🔗 Sepolia badge

### 7) Docker
```bash
docker compose up --build
# client :5173 · server :5000 · mongo :27017
```

---

## 🔌 API reference (essentials)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | – | Signup (creates wallet) |
| `POST /api/auth/login` | – | Login |
| `GET /api/auth/me` | user | Profile + wallets |
| `POST /api/auth/link-code` | user | Telegram link code + deep link |
| `GET /api/wallets` | user | My wallets |
| `POST /api/wallets` / `/watch` | user | New wallet / watch address |
| `POST /api/wallets/faucet` | user | Claim test tokens |
| `GET /api/transactions/estimate?amount=` | user | Fee preview |
| `POST /api/transactions/send` | user | Submit transfer (`Idempotency-Key` header supported) |
| `GET /api/transactions/mine` | user | My history (`?status=&type=`) |
| `GET /api/transactions/export` | user | **My history as CSV** |
| `POST /api/transactions/:hash/cancel` | user | Cancel + unlock |
| `GET /api/blocks` · `/api/blocks/:n` · `/api/blocks/search?q=` · `/api/blocks/explorer/stats` | – | Public explorer |
| `GET /api/admin/overview` | admin | Stats + chart data + online count |
| `GET /api/admin/pulse` | admin | **API-hit buffer + route stats + rpm** (live via socket) |
| `GET|PATCH /api/admin/users…` | admin | Manage users |
| `GET /api/admin/transactions…` | admin | All txs |
| `POST /api/admin/transactions/:hash/{approve,reject,retry}` | admin | Moderate txs |
| `GET /api/admin/mempool` · `DELETE /api/admin/mempool/:hash` | admin | Queue control |
| `POST /api/admin/mine` · `POST /api/admin/mint` | admin | Mining + supply |
| `GET|PUT /api/admin/settings` | admin | Chain policy (+ anchor mode) |
| `GET /api/admin/audit` | admin | Audit log |
| `GET /api/admin/evm` · `POST /api/admin/evm/retry` | admin | **Sepolia status + retry worker** |
| `GET /api/admin/export/:dataset` | admin | **CSV: users\|transactions\|blocks\|audit** (`?from=&to=&status=&search=`) |
| `POST /api/admin/broadcast` | admin | Telegram + realtime announcement |
| `GET /api/health` | – | Health check |

**WebSocket** (`/socket.io`, optional `auth.token`): see the Realtime table above.

---

## ⚙️ Configuration (`server/.env`)

| Key | Default | Meaning |
|---|---|---|
| `TOKEN_SYMBOL` / `TOKEN_NAME` | TBT | Chain branding |
| `BLOCK_TIME_MS` | 10000 | Miner tick |
| `MAX_TX_PER_BLOCK` | 10 | Block capacity |
| `MAX_TX_PER_USER_PER_BLOCK` | 2 | **Fairness cap** |
| `TX_FEE_PERCENT` / `TX_FEE_MIN` | 0.1 / 0.01 | Fee policy |
| `FAUCET_AMOUNT` / `FAUCET_COOLDOWN_MS` | 100 / 1h | Faucet policy |
| `DAILY_SEND_LIMIT` | 10000 | Default per-user daily cap |
| `LARGE_TX_APPROVAL_THRESHOLD` | 5000 | 0 = disable approvals |
| `TELEGRAM_BOT_TOKEN` | – | Enables bot + alerts |
| `WALLET_ENCRYPTION_KEY` | derived | 64-hex AES key (set in prod!) |
| `EVM_RPC_URL` / `EVM_SETTLEMENT_KEY` | – | Sepolia RPC + funded testnet key |
| `EVM_ANCHOR_MODE` | off | `off` \| `post` (also live in Settings) |
| `EVM_CHAIN_ID` | 11155111 | Expected EVM chain id |
| `EVM_ANCHOR_ADDRESS` | – | Anchor destination (blank = self) |
| `SEED_ADMIN_*` | admin@tbt.local | Seed credentials |

Chain-policy keys are also **live-editable from Admin → Settings** (DB overrides env after first boot).

---

## 🧪 Try the fairness yourself
1. Register two users (normal + incognito window), claim faucet on both
2. User A submits 10 transfers; user B submits 1 right after
3. Watch the next block stream into the Explorer **live**: B's tx confirms **alongside** A's first 2 — B is never pushed out
4. Admin → Mempool shows the queue; Admin → Live Pulse shows every API hit as it happens

## 🗺 Roadmap ideas
- WebSocket-gated rate-limit dashboard · CSV export of pulse data · 2FA/TOTP · Telegram Login Widget SSO
- Mainnet-ready anchor contract (batch roots) · automated test suite (miner + fairness property tests)

## ⚠️ Disclaimer
Testnet demo software — tokens have no value. Custodial keys are AES-encrypted but this is **not**
audited production custody code. Use strong secrets and HTTPS in any deployment.
