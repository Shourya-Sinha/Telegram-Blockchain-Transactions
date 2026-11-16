# Poster-based test games and agents

This guide describes the test-only sweep-round and agent features added from the two supplied posters. It does **not** authorize real-money play.

## Safety boundary

- Every new game, agent, commission, and payout-report API fails closed unless `FUNDS_MODE=test`.
- A test bet debits the user's internal test-wallet balance and writes a `GAME_STAKE` ledger entry. It is not a blockchain transaction.
- Settlement stores wins/losses and **both** candidate payout totals. Winning stakes are never automatically credited or sent.
- A manual payout can be reported only after one interpretation has been approved for that round. The admin must enter a boss-decision reference; the recorded transfer reference is an audit note only. The application does not send, broadcast, or credit that payout.
- Agent commission is calculated from turnover using the rate snapshotted when each bet was placed. Commission is report-only and is not automatically transferred.
- Keep sweep play disabled in `FUNDS_MODE=real`. Real-money play requires separate legal, compliance, custody, security, and operational review.

Apply the new migration and regenerate the Prisma client before building/running the updated backend:

```bash
npm run db:migrate
npm run db:generate
```

The first authorized GET of `/api/admin/test-games/profiles` creates the two default profiles if they do not already exist. Existing profiles are never overwritten by that initialization, so admin edits persist.

## Poster presets

Both profiles remain separate and editable in **Admin → Games & agents**. Each profile has its own stake range and odds table:

| Profile | Stake range | Notable poster odds |
|---|---:|---|
| Poster 1 · 大小姐 | 30–1000 test USDT | 5-pack single 1–5 hits: 2, 3.2, 5, 10, 15×; 6-pack single: 1.5, 3, 4.5, 8, 12, 20×; 5/6 chain odds and 9-pack single/multi rows are preserved in the editable table. |
| Poster 2 · 荣耀 | 20–500 test USDT | 5-pack single: 2, 3.2, 6, 10, 15×; 6-pack single: 1.5, 2.8, 5, 8, 12, 20×; 5/6 chain odds and 9-pack multi rows are preserved in the editable table. |

The 9-pack multi-mine rows preserve the poster's separate base rates and reward rows. The provisional calculation uses the displayed reward multiplier; the base rate is shown separately. Values inferred from “以此类推” (“and so on”) are marked as inferred in both the profile editor and player view. These are editable test assumptions, not boss-confirmed rules.

## Assumed test round flow

The posters provide 5/6/9 packet formats and odds, but do not define an application result feed or full bet workflow. The following test assumptions are explicit:

1. A finance/super-admin chooses a profile, variant, packet count, and target digit, then opens a round.
2. The round snapshots its profile name, limits, and full odds table. Later profile edits do not affect the open round.
3. Players pick an outcome and stake test credits within the displayed range. A player may place one bet per outcome in the same round; a repeated pick is rejected. The stake is debited atomically from their test wallet.
4. An admin manually records the observed outcome key to settle the round. No actual Telegram red-envelope packets, screenshots, or hit-count result are fetched or verified by the app.
5. The system reports each winner's two possible payout totals:
   - **Multiplier includes stake:** `stake × multiplier`.
   - **Multiplier is profit:** `stake × multiplier + stake returned`.
6. Both calculations remain visible until the boss decides which interpretation applies. To record a payable basis, finance/super-admin must select exactly one interpretation and enter the boss-decision reference. The selected basis cannot be changed after it is locked. Each winning bet accepts at most one manual-transfer record.

The poster's 20-minute screenshot/claim condition is not automated: the application has no screenshot verification or dispute workflow. Do not use the test report as a live payout instruction until those rules are clarified.

## Agent setup and reporting

1. The player must first open the bot or Mini App so their Telegram account exists in the user table.
2. In **Admin → Games & agents**, an authorized finance/super-admin enters the player's Telegram ID and creates an agent. The rate defaults to **0%** and is editable from 0% to 100%.
3. Share the displayed invite code/link. Set `TELEGRAM_BOT_USERNAME` for a `t.me/<bot>?start=agent_CODE` link; if a Mini App short name is also configured, the link opens that Mini App directly. Without a bot username, a shareable `PUBLIC_APP_URL?ref=CODE` link is returned.
4. A new player is attributed on first use of the invite code. Attribution is first-touch and cannot be overwritten by another agent code. Telegram `/start` and Mini App `startapp`/`ref` links are supported in test mode.
5. Agents can see their direct referrals, turnover, settled wins/losses, the two provisional net P/L readings, and report-only commission in the Mini App **Games** tab. Admins see the same per-agent and per-player report in the admin console.

A rate change applies to future bets only. Each bet stores the active agent and commission rate at the time it was placed so historical commission reports remain stable. Commission uses the full bet stake as turnover, regardless of the eventual win/loss result.

## Existing mine-envelope feature

These new prediction/round records are separate from the existing red-envelope mine/sweep feature. The existing feature's recipient safety, claim lifecycle, expiry/refund, X-reserve, and sender-payment behavior are unchanged. The new poster-based test flow does not open a red envelope or use the existing mine claim settlement.
