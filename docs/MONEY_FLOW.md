# Money flow — how a WeChat-style red envelope works on top of USDT

This document answers one question: **when someone creates a red envelope and members claim it, whose money moves, and where does the blockchain actually get touched?**

Short answer: **the blockchain is touched only twice in a user's whole life — once when they deposit, once when they withdraw.** Everything in between, including every red envelope and every claim, is an internal database transfer. That is exactly how WeChat red packets work; the only difference is that the asset backing the ledger is TRC20 USDT instead of CNY.

---

## 1. The mental model

```
        ON-CHAIN (Tron)                    OFF-CHAIN (your Postgres ledger)
  ┌──────────────────────────┐      ┌────────────────────────────────────────────┐
  │                          │      │                                            │
  │  user's own TRC20 wallet │      │   WalletAccount rows, one per Telegram user│
  │             │            │      │                                            │
  │             │ deposit    │      │   Alice  available 50.00   locked 0.00     │
  │             ▼            │      │   Bob    available  3.25   locked 0.00     │
  │  unique deposit address ─┼─────▶│   Treasury available 900.00 locked 0.00    │
  │                          │      │                                            │
  │       hot wallet   ◀─────┼──────┤   withdrawal: reserve → broadcast → settle │
  │             │            │      │                                            │
  │             ▼ withdrawal │      │   ALL red envelope activity happens here   │
  │  user's own TRC20 wallet │      │   with ZERO Tron transactions              │
  └──────────────────────────┘      └────────────────────────────────────────────┘
```

Two rules make this safe:

1. **Money is an integer.** `1 USDT = 1_000_000` minor units (`BigInt`). There is no floating point anywhere in the financial path.
2. **Every balance change writes a `LedgerEntry`.** A balance is never edited on its own. Each entry records `amountMinor`, `direction` (`CREDIT`/`DEBIT`), `type`, `balanceAfterMinor`, and a `referenceType` + `referenceId` pointing at what caused it. For an envelope, the sender's `DEBIT` and every claimer's `CREDIT` all carry `referenceType='RED_ENVELOPE'` and the same `referenceId`, so the whole envelope reconciles by querying one index.

---

## 2. How money gets *into* the system

There are exactly three ways a `WalletAccount.availableMinor` can go up from outside:

| Source | Ledger type | When it is allowed | Code |
| --- | --- | --- | --- |
| Real TRC20 USDT deposit | `DEPOSIT` | `FUNDS_MODE=real` **and** `DEPOSIT_MODE=unique`, credited only after `TRON_CONFIRMATIONS` (default 19) confirmations | `depositService.recordIncomingTransfer` |
| Test credit (fake money) | `TRANSFER` w/ `referenceType='DEV_CREDIT'` | Test mode only — hard-blocked when `NODE_ENV=production` or `FUNDS_MODE=real` | `devCreditService.grantAutomaticTestCredit`, `prisma/devCredit.ts` |
| Claiming someone's envelope | `CLAIM` | Always | `envelopeService.claimEnvelope` |

The third one is **not new money** — it is someone else's money moving to you. Only the first two increase the total amount of USDT the system owes its users.

> **Solvency rule:** the Tron hot wallet must always hold at least the sum of every user's `availableMinor + lockedMinor`. Test credits deliberately break that rule, which is why `config.allowDevCredit` refuses to turn on in production or in real-funds mode.

---

## 3. Creating an envelope — who pays

This is the part that confuses people, so here it is precisely.

**The full amount leaves the creator's wallet immediately, at creation time, before anybody claims.** It does not sit in the creator's balance waiting to be handed out.

`envelopeService.createEnvelope` runs this inside a **single Postgres transaction**:

```
1. reject if the emergency kill switch is on
2. reject if the group is not registered / not enabled
3. reject if totalMinor < count        (every slot needs ≥ 0.000001 USDT)
4. INSERT RedEnvelope { totalMinor, remainingMinor = totalMinor,
                        totalSlots, remainingSlots, mode, expiresAt, ACTIVE }
5. debitWallet(sender, totalMinor, TRANSFER, 'RED_ENVELOPE', envelope.id)
      └─ SELECT ... FOR UPDATE on the sender's WalletAccount
      └─ throws INSUFFICIENT_BALANCE if they cannot cover it
6. audit log RED_ENVELOPE_CREATED
```

So the pending money lives in **`RedEnvelope.remainingMinor`**. That column *is* the escrow. While the envelope is open, that USDT belongs to nobody's wallet.

```
BEFORE                         AFTER createEnvelope(10 USDT, 5 slots)

Alice  available 50.00         Alice  available 40.00
                               Envelope#7  remainingMinor 10.00  remainingSlots 5
```

### Then, and only then, the bot posts the message

`envelopePublishingService.createAndPublishEnvelope` calls `publishEnvelopeMessage`, which sends the group message with the `🧧 Claim red envelope` inline button.

If Telegram **refuses** to post (bot removed, no send permission, group deleted), the service runs a compensating transaction: `refundUnpublishedEnvelope` credits the money straight back as a `REFUND` entry and marks the envelope `REFUNDED`. You never end up with debited money behind an envelope nobody can see.

---

## 4. "Should the admin create it, or any person?" — both, and both really pay

There are **two entry points**, and they differ *only* in whose wallet is charged.

### Path A — a normal user creates one

| Trigger | `senderId` |
| --- | --- |
| Mini App → **DeFi** tab → *Post envelope to group* (`POST /api/envelopes`) | the logged-in Telegram user |
| `/redpacket <amount> <count>` typed in the group | whoever typed the command |

Their own wallet is debited. They must have deposited (or been test-credited) first. The route also calls `assertTelegramGroupMembership`, so you cannot post an envelope into a group you are not in.

### Path B — an operator sends one from the admin console

`POST /admin/envelopes/send`, restricted to `SUPER_ADMIN` or `FINANCE`.

**The admin account is not charged, and nothing is minted.** The route resolves the env var `RED_ENVELOPE_TREASURY_TELEGRAM_ID` to a real `User` row and passes *that* user as the sender:

```ts
const treasury = await prisma.user.findUnique({
  where: { telegramId: BigInt(config.redEnvelope.treasuryTelegramId) }, ...
});
const envelope = await createAndPublishEnvelope(treasury.id, { ...payload, actorId: req.adminUser!.id });
```

The treasury is just an ordinary Telegram account with an ordinary funded wallet. For this to work it must:

- have run `/start` on the bot at least once (otherwise there is no `WalletAccount` → `TREASURY_NOT_FOUND`);
- be `ACTIVE`, not banned;
- actually **hold enough balance** — deposited real USDT in real mode, or test-credited in test mode.

`GET /admin/envelopes/setup` reports exactly which of those is missing.

This design is deliberate: **there is no code path anywhere that lets an admin conjure balance into an envelope.** An admin-sent envelope is a treasury-funded giveaway. The `actorId` on the audit log records *which admin pressed the button*, while `senderId` records *which wallet paid* — those are intentionally two different fields.

---

## 5. Claiming — the WeChat algorithm, made atomic

A member taps the inline button in the group. The bot's callback handler (or the Mini App's `POST /api/envelopes/:id/claim`) runs `claimEnvelope`.

**Before the transaction** — `assertClaimEligibility` + `assertTelegramGroupMembership`:

- emergency kill switch off?
- group enabled?
- account older than `minAccountAgeDays`?
- has the user sent at least `minMessages` in this group? (a Redis counter incremented by the bot middleware, 30-day TTL)
- under `maxClaimsPerDay` for this group?
- are they genuinely a member right now? (`getChatMember`, so leavers and kicked users are refused)

**Inside the transaction** — this is where correctness under a stampede of simultaneous taps comes from:

```
SELECT id FROM "RedEnvelope" WHERE id = $1 FOR UPDATE   ← serializes all claimers

if not ACTIVE / no slots / no money      → "closed"
if past expiresAt                        → mark EXPIRED, refund remainder to sender
if a claim row already exists for user   → "already_claimed"

amount = EQUAL  ? ceil(remainingMinor / remainingSlots)   (last slot takes the exact remainder)
       : RANDOM ? randomClaimAmount(remainingMinor, remainingSlots)

INSERT RedEnvelopeClaim { envelopeId, userId, amountMinor }   ← UNIQUE(envelopeId, userId)
UPDATE RedEnvelope SET remainingMinor -= amount,
                       remainingSlots -= 1,
                       status = (remainingSlots == 0 ? COMPLETED : ACTIVE)
creditWallet(user, amount, CLAIM, 'RED_ENVELOPE', envelope.id)
```

Two independent defences stop a double claim: the row lock, and the `@@unique([envelopeId, userId])` constraint (a unique-violation is caught and turned into a friendly `ALREADY_CLAIMED`).

### The random split (`utils/envelopeAllocation.ts`)

This is the classic WeChat "double mean" algorithm, rewritten to be integer-only and to use `crypto.randomBytes` instead of `Math.random`:

```
maximum = min( 2 × remaining / slots ,  remaining − (slots − 1) )
amount  = uniform_random(1 .. maximum)
```

- the `2 × mean` term produces the lively, unequal spread people expect;
- the `remaining − (slots − 1)` term guarantees every later claimer still gets **at least 1 minor unit** — nobody can ever open an empty envelope;
- the last remaining slot takes the whole remainder, so the split is exact.

### Conservation

For every envelope:

```
totalMinor  ==  Σ (all claim amounts)  +  refund to sender
```

Nothing is created, nothing is lost, and every line of that equation exists as a `LedgerEntry`.

---

## 6. Expiry

A BullMQ repeatable job runs `expireEnvelopes()` every 60 seconds. Any `ACTIVE` envelope past `expiresAt` is set to `EXPIRED`, and `remainingMinor` is credited back to the **sender** as a `REFUND` entry. A claim attempt that arrives on an already-expired envelope does the same refund inline, so the refund cannot be missed or applied twice.

---

## 7. How money leaves the system

`withdrawalService.createWithdrawal`:

1. `reserveWallet` moves `amount` **and** `fee` from `availableMinor` into `lockedMinor` — the user can no longer spend it, but it has not left yet.
2. The withdrawal row gets an `idempotencyKey` (unique) so a double-tap cannot produce two payouts.
3. Under the auto-approval limit it goes straight onto the BullMQ queue; over it, an admin must approve.
4. The worker broadcasts the TRC20 transfer from the hot wallet, then polls TronGrid for confirmations.
5. Success → `settleReservedWallet` burns the lock (the money is genuinely gone on-chain). Failure → `releaseReservedWallet` returns it to `availableMinor` as a `REFUND`.

---

## 8. Complete worked example

`FUNDS_MODE=real`. Treasury = Telegram account `111`. Group has 3 members: Alice, Bob, Carol.

| # | Event | On-chain? | Ledger effect |
| --- | --- | --- | --- |
| 1 | Treasury deposits 100 USDT to its unique address | ✅ 1 Tron tx | after 19 confs: `DEPOSIT` +100.00 → treasury available **100.00** |
| 2 | Admin sends a 10 USDT / 3-slot RANDOM envelope from the console | ❌ | `TRANSFER` −10.00 from **treasury** → available **90.00**; `RedEnvelope.remainingMinor = 10.00` |
| 3 | Bot posts the claim button in the group | ❌ | — |
| 4 | Alice taps | ❌ | bounded by `min(2×10/3, 10−2) = 6.666666` → say 4.10. `CLAIM` +4.10 → Alice **4.10**; envelope 5.90 / 2 slots |
| 5 | Bob taps | ❌ | bounded by `min(2×5.90/2, 5.899999) = 5.899999` → say 2.30. `CLAIM` +2.30 → Bob **2.30**; envelope 3.60 / 1 slot |
| 6 | Carol taps | ❌ | last slot takes the remainder 3.60. `CLAIM` +3.60 → Carol **3.60**; envelope **COMPLETED** |
| 7 | Alice tries to withdraw her 4.10 | ❌ | rejected — below the 20 USDT `WITHDRAWAL_MIN_USDT` default. Nothing moves |
| 8 | Alice claims more envelopes, reaches 21.00, withdraws 20.00 (fee 1.00) | ✅ 1 Tron tx | `reserveWallet` locks 21.00 → hot wallet broadcasts → `settleReservedWallet` burns the lock |

**Three people received money, and the chain saw zero transactions for it.** `4.10 + 2.30 + 3.60 = 10.00` exactly.

That is the whole point of the design: 500 claims cost you 500 database rows instead of 500 Tron transfers, 500 energy/bandwidth fees, and 500 confirmation waits.

---

## 9. Quick answers

**Who pays for an admin-sent envelope?** The treasury Telegram account configured in `RED_ENVELOPE_TREASURY_TELEGRAM_ID`. Never the admin's login, never thin air.

**Can a normal user send one?** Yes — Mini App DeFi tab, or `/redpacket 10 5` in the group. Their own balance pays.

**Is the money deducted when the envelope is created or when it is claimed?** At **creation**. Claims only move it out of escrow into claimers' wallets.

**What if nobody claims?** After `expiresAt` the remainder goes back to the sender as a `REFUND`.

**Is each claim a blockchain transaction?** No. Zero. Only deposits and withdrawals touch Tron.

**Where is the real USDT during all of this?** In the Tron hot wallet. The ledger is the record of who owns which slice of it.

---

## 10. Code map

| Concern | File |
| --- | --- |
| Balance primitives, ledger entries, audit | `apps/backend/src/services/ledgerService.ts` |
| Create / claim / expire / refund | `apps/backend/src/services/envelopeService.ts` |
| Create + post + compensate on failure | `apps/backend/src/services/envelopePublishingService.ts` |
| Random split algorithm | `apps/backend/src/utils/envelopeAllocation.ts` |
| Claim eligibility rules | `apps/backend/src/services/eligibilityService.ts` |
| Treasury resolution for admin sends | `apps/backend/src/routes/adminRoutes.ts` (`POST /envelopes/send`) |
| User-initiated sends | `apps/backend/src/routes/userRoutes.ts` (`POST /envelopes`), `apps/backend/src/bot/bot.ts` (`/redpacket`) |
| Deposits | `apps/backend/src/services/depositService.ts` |
| Withdrawals | `apps/backend/src/services/withdrawalService.ts` |
| Test-only credit | `apps/backend/src/services/devCreditService.ts` |
