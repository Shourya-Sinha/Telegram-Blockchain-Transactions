# Red-envelope guide: group setup, sending, and claiming

This guide describes what a red envelope means in this repository and the exact Telegram flow.

## 1. What a red envelope is

A red envelope is a prepaid distribution of the app's **internal USDT balance**:

1. A sender chooses a total amount, a number of claims, a Telegram group, and a distribution mode.
2. The server immediately debits the entire total from the sender's internal wallet.
3. The bot posts a message and **Claim red envelope** button in that group.
4. Each eligible Telegram member can tap once.
5. The server credits that member's internal wallet in one database transaction.
6. When all claims are used, the envelope is complete. When it expires, every unclaimed minor unit is refunded to the sender.

Claims are off-chain ledger transfers. The app does **not** send a TRC20 transaction for every claim. Tron is used only for deposits into and withdrawals out of the custodial system.

### Random and equal modes

- **RANDOM:** every claimant receives a cryptographically random share while at least one USDT minor unit remains reserved for each later claim.
- **EQUAL:** the remaining amount is divided across the remaining claims as evenly as integer minor units permit.

## 2. The three different roles

These roles are easy to confuse:

- **Control-room admin:** signs into the web admin console. A `SUPER_ADMIN` or `FINANCE` admin can send an envelope funded by the configured treasury wallet.
- **Treasury Telegram user:** a normal Telegram user with an internal wallet and balance. Admin envelopes are debited from this wallet; admin login accounts do not mint money and do not own a wallet themselves.
- **Telegram group member:** sees the bot's message and taps the claim button. A member does not need to be a control-room admin.

A regular funded user can also send from the Mini App's **DeFi** tab or run `/redpacket` in a group. That envelope is paid from that user's own balance.

### Telegram ID versus name

The numeric Telegram user ID is the immutable external account key and is unique in the database. Signed Telegram updates and validated Mini App init data supply that ID. The display name and optional `@username` are stored only to make bot messages and admin screens understandable; users can change them, so neither is used to own a wallet, authorize a claim, or locate financial records. Internally, wallet and ledger rows reference the application's UUID user ID.

## 3. Configure the bot and webhook

Set at least these values in `.env`:

```dotenv
BOT_TOKEN=123456:replace_me
TELEGRAM_WEBHOOK_SECRET=replace-with-a-long-random-value
TELEGRAM_WEBHOOK_URL=https://api.example.com/telegram/webhook
PUBLIC_APP_URL=https://wallet.example.com
RED_ENVELOPE_TREASURY_TELEGRAM_ID=123456789
```

Important details:

- `TELEGRAM_WEBHOOK_URL` is the **complete backend endpoint**, including `/telegram/webhook`.
- `PUBLIC_APP_URL` is the HTTPS Mini App frontend URL, not the admin URL.
- Telegram must be able to reach the backend URL over valid HTTPS.
- Check `GET https://api.example.com/health` first.
- Restart the backend after changing `.env`; startup registers the webhook.

Useful Telegram commands are:

```text
/start
/myid
/registergroup
/balance
/redpacket <amount> <count>
```

Run `/myid` from the Telegram account that should pay for admin envelopes, copy the numeric ID to `RED_ENVELOPE_TREASURY_TELEGRAM_ID`, and restart the backend.

## 4. Add and register a Telegram group

For every destination group:

1. Open the group in Telegram.
2. Add the bot as a member.
3. Promote the bot to group administrator. It needs permission to send and edit messages. Admin status also makes membership verification reliable.
4. In that group, run:

   ```text
   /registergroup
   ```

5. The bot replies with the group title and numeric ID.
6. Open **Admin → Group settings** or **Admin → Send envelope**. The named group should now appear; no manual opaque ID is required.

The bot also refreshes the group title and `lastSeenAt` whenever it receives group activity.

### Message-count rules

If `Minimum group messages` is greater than zero, disable the bot's privacy mode through BotFather (`/setprivacy`) so it receives ordinary group messages. With privacy mode enabled Telegram generally sends only commands and bot-directed updates, so the counter cannot represent all messages.

Counters are retained in Redis for 30 days. Account age means time since the user's first verified interaction with this wallet, not the age of their Telegram account.

## 5. Prepare and fund the treasury

1. From the treasury Telegram account, send `/start` to the bot. This creates its `User` and `WalletAccount` records.
2. Send `/myid` and make sure it matches `RED_ENVELOPE_TREASURY_TELEGRAM_ID`.
3. Fund that internal wallet.
4. In **Admin → Send envelope**, verify that the displayed treasury balance is non-zero.

### Local-only test credit

This repository includes an explicitly guarded development helper so the full interaction can be tested without real funds. In a local `.env` only:

```dotenv
NODE_ENV=development
FUNDS_MODE=test
DEPOSIT_MODE=disabled
ALLOW_DEV_CREDIT=true
```

Then, after the treasury user has sent `/start`, use either method:

- In **Admin → Users**, find the Telegram user, open **Transactions**, enter an amount and reason under **Add test USDT**, then confirm.
- Or use the command line:

  ```bash
  npm run db:dev-credit -- 123456789 100
  ```

The admin control is restricted to `SUPER_ADMIN` and `FINANCE` roles, accepts at most 10,000 USDT per action, and is hard-disabled whenever `NODE_ENV=production`. Every credit atomically increases the available internal balance, creates a `TRANSFER / CREDIT` ledger entry with reference type `DEV_CREDIT`, and writes `DEV_WALLET_CREDITED` to the admin audit log with the operator, reason, IP address, previous balance, and new balance.

This is **not a blockchain transaction** and adds no real USDT to the hot wallet. In `FUNDS_MODE=test`, blockchain deposit scanners, withdrawal workers, user deposits, and user withdrawals are disabled, so test liabilities cannot drain a real wallet.

### Switching to real funds

Funds mode is deliberately controlled by the deployment environment—not by an admin-panel switch. Allowing a logged-in operator to turn test balances into withdrawable real liabilities would create a critical wallet-drain risk. The admin panel clearly displays **TEST MODE** or **REAL FUNDS**, but changing modes requires an reviewed configuration change and backend restart.

A real deployment requires:

```dotenv
NODE_ENV=production
FUNDS_MODE=real
DEPOSIT_MODE=unique
ALLOW_DEV_CREDIT=false
```

It also requires all production secrets and TRON wallet settings. Startup fails closed if real mode is incomplete, if test credit is enabled in production, or if deposits are not configured for unique addresses. `DEPOSIT_MODE=unique` uses each user's `User.depositAddress`; addresses must first be provisioned by reviewed self-custody/key-management infrastructure or a custody provider. The shared hot-wallet address is never returned as a production user deposit address.

### Production deposit warning

The current demo deposit endpoint returns one shared hot-wallet address. The deposit worker credits transfers only when the receiving address is mapped to exactly one `User.depositAddress`. Therefore, a shared-address transfer is **not a safe way to identify or credit a user**, including the treasury.

Before real funds are accepted, implement unique deposit-address provisioning (or another reviewed attribution mechanism), assign `User.depositAddress`, test confirmations on Tron staging, and complete the operational/security review described in the main README.

## 6. Send from the admin console

1. Sign in to the admin frontend with the seeded admin credentials.
2. Open **Send envelope**.
3. Select a registered group by name.
4. Enter total USDT, number of claims, random/equal mode, and expiry.
5. Confirm that the treasury balance covers the total.
6. Click **Send to Telegram group**.

The backend then:

1. checks the admin role;
2. checks that the group is registered and enabled;
3. finds the configured treasury user;
4. debits the treasury and creates the envelope atomically;
5. asks Telegram to post the claim message;
6. stores Telegram's message ID.

If Telegram publication fails, the code marks the envelope `REFUNDED` and credits the full amount back to the treasury. The failed creation and refund remain audit logged.

## 7. Send as a regular user

There are two supported paths.

### In the Telegram group

A funded member runs:

```text
/redpacket 10 5
```

This posts a random envelope totaling 10 USDT with five claims in the current group. The 10 USDT is paid by the member who ran the command.

### In the Mini App

1. Open the wallet inside Telegram.
2. Open **DeFi**.
3. Select a registered group.
4. Choose amount, claim count, and random/equal mode.
5. Tap **Post envelope to group**.

The server verifies that the sender is a member of the chosen group before debiting the sender and publishing the message.

## 8. What happens when a user claims

1. A group member taps **Claim red envelope**.
2. Telegram sends a signed callback update containing only the envelope UUID and the real Telegram user identity.
3. The backend creates that user's wallet automatically if this is their first interaction.
4. Eligibility rules are checked:
   - envelopes are not globally disabled;
   - the group is enabled;
   - minimum wallet-account age is met;
   - minimum group-message count is met;
   - per-group 24-hour claim limit is not exceeded.
5. PostgreSQL locks the envelope row so simultaneous taps cannot overspend it.
6. The server checks that this user has not already claimed this envelope.
7. One amount is calculated, a unique claim is created, and the user's wallet is credited in the same transaction.
8. Telegram shows the claimed amount in an alert. The member can open the wallet or run `/balance` to see the new balance.

The database unique constraint on `(envelopeId, userId)` and the row lock are the final concurrency protections.

The Mini App also supports `?envelope=<uuid>` claims. That endpoint verifies Telegram Mini App authentication and group membership before crediting a claim.

## 9. Group policy controls

In **Admin → Group settings**, enter or select the group's numeric ID and configure:

- **Allow red envelopes:** disables both creation and claiming when off.
- **Minimum account age:** minimum age of the app wallet account.
- **Minimum group messages:** rolling Redis counter described above.
- **Claims per user / 24h:** counted only for envelopes in this group.

All policy changes are written to `AuditLog`.

## 10. Troubleshooting

### Group does not appear in the admin list

- Confirm the bot was added to the same group.
- Run `/registergroup` in that group.
- Confirm the webhook URL points to the running backend and `/health` works.
- Check backend logs for `[telegram] webhook configured` and incoming `POST /telegram/webhook` requests.

### “Telegram could not post in that group”

- The bot may have been removed, muted, or denied permission to send messages.
- Promote it to administrator and retry.
- The failed envelope amount should already be refunded; verify the recent envelope status and audit log.

### “Treasury user not found”

- Send `/start` from the treasury account.
- Run `/myid` and compare it with `RED_ENVELOPE_TREASURY_TELEGRAM_ID`.
- Restart the backend after editing `.env`.

### “Insufficient available balance”

The selected sender/treasury does not have enough internal balance. Locked balance cannot fund an envelope. Fund the account through a correctly attributed confirmed deposit, or use the local-only development credit helper.

### User cannot claim

Check the alert shown by Telegram. Common causes are already claimed, envelope complete/expired, group disabled, account too new, too few messages, daily group limit reached, or global emergency disable.

### Message-count requirement never increases

- Disable bot privacy mode with BotFather.
- Confirm Redis is running.
- Send new messages after the bot is present; historical Telegram messages are not imported.

## 11. Mini App compact behavior

The frontend intentionally leaves the Mini App in Telegram's native compact sheet so the surrounding Telegram page remains visible. It does not call `expand()` or `requestFullscreen()` after loading. If Telegram restores the WebView in fullscreen, the frontend requests `exitFullscreen()` and re-enables vertical swipes. It still listens for Telegram viewport and safe-area changes so the layout follows the actual sheet height and avoids notches and gesture bars.

Telegram controls the exact compact-sheet height for each client and screen size; a web app cannot force an exact percentage such as 70%. The app therefore keeps Telegram's initial native size rather than setting a hard-coded browser height. Make sure it is opened with the bot's **Open Red Envelope Wallet** Web App button rather than by pasting the frontend URL into Telegram's ordinary in-app browser.

## 12. Does the transaction design fit the requirement?

It fits when the intended product is a **custodial Telegram wallet** where red-envelope claims are fast internal ledger transfers and Tron is used only for deposits and withdrawals. This is the practical model for many simultaneous low-value claims because it avoids a network fee and confirmation wait for every button tap.

It does not fit if the requirement is that every claim must be a directly visible TRC20 transaction to a user's self-custody address. That would require wallet connection/address ownership, gas/energy handling, asynchronous claim states, and a very different contract or payout architecture.

Before using real money, the current repository still needs refinement in these areas:

1. unique deposit addresses or another reviewed user-attribution mechanism;
2. real per-transaction confirmation/reorg tracking rather than demo assumptions;
3. KMS/HSM or Vault signing instead of an environment private key;
4. real TOTP/WebAuthn validation for admin MFA (the current field is only a placeholder gate);
5. automated reconciliation of hot-wallet reserves against internal liabilities;
6. concurrency, webhook replay, queue recovery, chain integration, and restore tests;
7. monitoring and an incident runbook for failed deposits, withdrawals, and envelope refunds.

Therefore the envelope ledger transaction is a sound **requirement-level foundation**, but the deposit, custody, authentication, monitoring, and testing layers must be refined before production.

## 13. Relevant code

- Bot commands and callback: `apps/backend/src/bot/bot.ts`
- Creation/claim/refund transaction: `apps/backend/src/services/envelopeService.ts`
- Telegram publication compensation: `apps/backend/src/services/envelopePublishingService.ts`
- Group discovery: `apps/backend/src/services/groupService.ts`
- Eligibility rules: `apps/backend/src/services/eligibilityService.ts`
- Admin routes: `apps/backend/src/routes/adminRoutes.ts`
- Mini App routes: `apps/backend/src/routes/userRoutes.ts`
- Admin send UI: `apps/admin/src/App.tsx`
- User DeFi UI: `apps/frontend/src/screens/DeFiScreen.tsx`
