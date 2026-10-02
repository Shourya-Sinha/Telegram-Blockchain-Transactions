# User guide — opening the Mini App, history, withdrawals, and test mode

This guide answers the four most common user questions:

1. How does a user open their Telegram Mini App (their wallet)?
2. How do they see their history and withdrawals?
3. Why is the Withdraw button disabled?
4. How do test withdrawals work with the required test TRON (tether) address?

## 1. How a user opens their Mini App

There are now **five ways in**, so a user never has to hunt for the wallet:

| Entry point | Where the user sees it |
|---|---|
| **Chat menu button** — the bot registers a persistent `🧧 Wallet` button | Left of the message-input `📎` button in every chat with the bot. Set automatically at backend startup (needs `PUBLIC_APP_URL` to be HTTPS, or `localhost` while developing). |
| **`/start`** | Replies with the `🧧 Open Red Envelope Wallet` button. |
| **`/wallet`** (new command) | Replies with balance, locked amount and an `🧧 Open Mini App` button. |
| **The red envelope message itself** | Every envelope posted in a group now carries a second button — `💰 Open My Wallet` — directly under `🧧 Claim red envelope`. |
| **The private message after every claim** | Right after claiming, the bot sends the user a private message with their claimed amount, available balance, locked balance, and an `🧧 Open My Wallet` button. |

The bot also registers its full command list (`/start`, `/wallet`, `/balance`, `/history`, `/deposit`, `/withdraw`, `/redpacket`, `/registergroup`, `/myid`, `/help`) with Telegram, so all commands autocomplete when the user types `/`.

### After a claim in a group — seeing wallet details

When a group is registered (`/registergroup`) and a member taps **Claim red envelope**:

1. A Telegram alert immediately shows the claimed amount and the new available balance.
2. The bot sends a **private message** (never posted in the group) with:
   - Claimed amount (`+X USDT`)
   - Available balance
   - Locked/pending-withdrawal balance
   - A `🧧 Open My Wallet` button into the Mini App
3. In test mode the message also carries the warning: *This is test currency only — no real USDT is sent or received.*

> If the user never pressed Start on the bot, Telegram forbids the private message; the claim alert still shows their balance, and the `💰 Open My Wallet` button on the envelope message still works.

## 2. How a user sees their history and withdrawals

**Inside the Mini App (recommended):**

- The **Wallet tab → History** button (next to Deposit / Withdraw) opens the full history panel.
- **Wallet tab → See all** (next to *Recent activity*) opens the same panel.
- The panel has two sections:
  - **Withdrawals** — every withdrawal request with amount, fee, destination address, transaction hash (real mode), and a status chip: `Queued → Processing → Broadcast → Confirming → Completed` (or `Failed` / `Rejected`). Test-mode withdrawals are tagged `Completed · simulated`.
  - **All activity** — the complete ledger: deposits, claims, envelopes sent, withdrawals, fees and refunds.
- Telegram's **← Back button** closes the panel.

**From the bot chat (quick check):**

- `/history` — last 10 ledger entries plus an `🕘 Full history in Mini App` button.
- `/balance` or `/wallet` — available and locked balances.

## 3. Why the Withdraw button is disabled

Withdrawals are controlled by the deployment's funds mode:

| Mode | Cause | Withdraw button |
|---|---|---|
| `FUNDS_MODE=test` **without** `TEST_WITHDRAWAL_ADDRESS` | Default development mode. Blockchain operations are switched off entirely so test balances can never touch the real chain. | **Disabled.** The app explains: *Test mode: withdrawals are disabled until a required test TRC20 address (`TEST_WITHDRAWAL_ADDRESS`) is configured.* |
| `FUNDS_MODE=test` **with** `TEST_WITHDRAWAL_ADDRESS` | Test withdrawals enabled. | **Enabled, labelled “Withdraw (test)”**, restricted to the one required test address. |
| `FUNDS_MODE=real` | Production mode with the full Tron hot-wallet setup (`TRON_HOT_WALLET_ADDRESS`, `HOT_WALLET_PRIVATE_KEY`, TronGrid, etc.). | **Enabled** — real TRC20 payouts to any valid address. |

Two more switches can also disable withdrawals at runtime, in **both** modes:

- The emergency switch `POST /api/admin/emergency/disable-withdrawals` (sets `emergency:withdrawals-disabled` in Redis).
- A non-HTTPS/localhost `PUBLIC_APP_URL` hides the bot's wallet buttons (Telegram rejects non-HTTPS web-app buttons).

## 4. Test withdrawals with the required test TRON address

For testing the withdrawal flow **without real money**, set exactly one required test address in `.env`:

```bash
FUNDS_MODE=test
# Any TRC20-format address you control on testnet or use for testing only.
TEST_WITHDRAWAL_ADDRESS=TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj
```

What users then experience:

- The Wallet tab shows the amber banner **TEST MODE — Test USDT only · withdrawals are simulated to the required test address**, and the Withdraw button becomes **Withdraw (test)**.
- The Withdraw form shows a permanent warning box: *This is test currency only — no real USDT is sent or received. Balances, claims and withdrawals are simulated for testing.*
- The destination field is **pre-filled and locked** to the required test address; the backend rejects any other address with `403 TEST_WITHDRAWAL_ADDRESS_REQUIRED`.
- On confirmation the request is **settled immediately inside one database transaction**: amount + fee are reserved (debit ledger entries `WITHDRAWAL` and `FEE`), the reservation is settled, and the withdrawal record is marked `COMPLETED` with the audit trail `WITHDRAWAL_TEST_COMPLETED` (`simulated: true`, *"No TRC20 transaction was broadcast. Test currency only."*). Nothing is ever sent to the blockchain and the BullMQ/Tron worker is never involved.
- The withdrawal appears in **History → Withdrawals** as `Completed · simulated`, and in the ledger as debit entries.
- `/withdraw` in the bot explains the same rules, shows the required address, minimum and fee, and repeats the test-currency warning.

Safety rules enforced by the backend:

- `TEST_WITHDRAWAL_ADDRESS` must be a valid TRON address or the backend refuses to start.
- Setting `TEST_WITHDRAWAL_ADDRESS` while `FUNDS_MODE=real` is a startup error — simulated payouts and real payouts can never coexist.
- The minimum (`WITHDRAWAL_MIN_USDT`), fee (`WITHDRAWAL_FEE_USDT`), idempotency-key and emergency-disable rules all apply to test withdrawals exactly as they do to real ones.

## Quick reference — what changed for each ask

| Ask | Where it lives now |
|---|---|
| See the Mini App | Chat menu button, `/start`, `/wallet`, wallet button on envelope messages, post-claim private message |
| See history | Wallet tab → History / See all → full panel (ledger + withdrawals) |
| See withdrawals + status | History panel → Withdrawals section with status chips |
| Why withdrawal disabled | Explained in-app on the disabled button tooltip, in the banner, by `/withdraw`, and in the `403 TEST_MODE` API error |
| Test withdrawal to a required tether address | `TEST_WITHDRAWAL_ADDRESS` env + simulated settlement, locked address field, `403` for any other address |
| “This is test currency only” warning | Mini App banner, withdraw modal, `/withdraw` bot reply, post-claim message, audit log |
