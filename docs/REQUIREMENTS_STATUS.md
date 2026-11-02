# Requirements status and Telegram identity model

This matrix compares the implementation with the supplied **Telegram USDT Lucky Money / Red Envelope System** requirements. “Implemented” means the repository contains the flow; it does not replace an independent security, legal, load, or production-readiness review.

## Why Telegram ID, name, and username are stored

| Field | Purpose | Financial identity? |
|---|---|---|
| `telegramId` | Immutable external key supplied in signed Telegram updates and Mini App init data. It restores the same local account, enforces one claim per user, associates group membership, and lets admins locate the correct account. It has a unique database constraint. | **Yes — primary external identity** |
| `firstName` | Friendly display label in the Mini App, bot messages, and admin tables. Telegram users can change it. | **No** |
| `username` | Optional `@username` shown for operator convenience. It can be changed, removed, or reassigned. | **No** |
| Internal UUID `User.id` | Stable database key used by wallets, ledger entries, claims, deposits, and withdrawals. | **Yes — internal relational identity** |

The backend always upserts by `telegramId`, never by name or username. Mini App identity is accepted only after validating Telegram's signed init data. Bot identity comes from the authenticated Telegram update. The application never asks for a seed phrase or user private key.

## Implemented core requirements

- Telegram `/start`, `/balance`, `/deposit`, `/withdraw`, `/history`, `/help`, `/redpacket`, `/registergroup`, and an inline start menu.
- Telegram ID as the unique external user key; mutable profile fields are metadata only.
- PostgreSQL transactional ledger (the requirements explicitly permit PostgreSQL for stricter accounting), Redis, BullMQ, Express, React Mini App/admin UI, grammY, and TronWeb.
- Equal and cryptographically randomized integer-only standard envelope allocation.
- Mine/sweep testing mode with exactly 5/6/9 cent-granular portions, 0–9 displayed-cent target, one claim per Telegram user, sender-selected expiry and refund of unclaimed value. The implemented interpretation is explicit: every hit reserves and pays the sender the full envelope total `X`; sender receives `X × hits`; misses create no extra payment and keep the original portion. A claimant needs `X` available, reserved before result reveal and released on a miss.
- Atomic row-locked claims, unique `(envelopeId, userId)`, exact remaining amount/slot updates, one claim per user, expiry, and refund.
- Available and locked wallet balances. New withdrawals atomically move amount plus fee from available to locked; completion settles locked funds; an authorized rejection releases them with refund ledger entries. Failed payouts remain locked for review/retry.
- Withdrawal idempotency key, persisted broadcast intent, transaction-hash recovery check, configurable fee/minimum/approval threshold, retry, reject, and emergency switch.
- Unique per-user production deposit address requirement, transaction-hash uniqueness, token/destination/amount storage, real confirmation counting, confirmed-deposit crediting, user deposit history, and admin reconciliation screen.
- Test and real-funds modes that fail closed; test balances cannot use blockchain deposits. Test-mode withdrawals can be enabled per deployment with a single required test TRC20 address (`TEST_WITHDRAWAL_ADDRESS`): they settle entirely in the ledger as `simulated` audit-marked records and never broadcast. Development can grant a row-locked, ledger-idempotent one-time welcome balance with `DEV_AUTO_CREDIT_USDT`, and admins can issue additional audited test credits.
- Admin roles, password authentication, actual TOTP verification when an MFA secret is configured, user inspection, transaction history, withdrawal/deposit views, group policy, audit logs, and emergency controls.
- Group membership checks, per-user API rate limits, group message/account-age rules, daily group claim limit, user blocking, and claim concurrency protection. Admin-originated envelopes require selected recipients; regular-user envelopes are available to group members without pre-registration.
- Mini App wallet, standard/mine envelope creation with sender-selected expiry, bilingual English/Chinese rules and payout-result disclosure, claim animation/result, withdrawal form, ledger activity, Telegram back button, compact Telegram viewport, and safe-area handling.
- Admin envelope page has an optional bilingual how-to-play/payout guide, per-claim mine outcome details for the latest 25 overall envelopes, all-time gross mine payouts credited to the configured treasury, net realized P&L for settled mine envelopes, active unclaimed value shown separately, and a database-backed shared developer-request inbox with message preview. Requests are saved for authorized admins to review; no external notification is sent. Schema, API, and UI are implemented; apply the pending Prisma migrations before using these additions in a deployed database.
- English 🇬🇧 / Chinese 🇨🇳 flag selectors in both the Mini App and the admin console (`en`/`zh` codes); the Mini App choice is persisted per user (`User.locale`, migration `0004_user_locale`) and the bot localizes `/wallet`, `/balance`, `/history`, `/withdraw`, and the post-claim wallet message accordingly (`/lang en|zh` also works from chat). Group-visible buttons are bilingual.
- Independent repeatable expiry worker, deposit worker, withdrawal worker, audit events, and Docker deployment files.

## Mine/sweep stakeholder decisions captured in this branch

This is a concise summary of the stakeholder requirements and corrections captured for this implementation, not a verbatim transcript. The user confirmed that this recorded summary covers the prior boss answers.

| Decision / question | Recorded answer | Status |
|---|---|---|
| What is a matching digit? | The final digit of the displayed cents; e.g. 1.26 matches target 6. Shares are cent-granular. | Implemented in allocation, UI rules, and claim results. |
| How many portions and claims? | Exactly 5, 6, or 9 portions; at most one claim per Telegram user per envelope. | Implemented and tested. |
| Are reference screenshots the canonical payout rule? | No. They are visual references only; payout behavior is explicitly stated in the product rules and review notes. | Implemented and disclosed in English/Chinese. |
| What does a match pay? | Each matching claimant pays the sender the full envelope total X; sender receives X per match. A miss adds no payment and the original portion is credited. | Implemented, shown to users/admins, and recorded in the ledger. |
| Is balance collateral required? | Yes. Reserve X from available balance before revealing; release on a miss and settle to the sender on a hit. | Implemented. |
| What happens at expiry? | Sender chooses expiry; remaining unclaimed value returns to the sender. | Implemented through the existing expiry/refund lifecycle. |
| Who may claim? | Admin-created envelopes use admin-selected recipients; regular-user envelopes are open to group members. | Implemented. Numeric IDs and profile selection remain; unknown usernames can bind once to the first authenticated Telegram ID. |
| Must every recipient register in the app? | No. The claim path verifies Telegram group membership; individual app pre-registration/full-roster enumeration is not required. | Implemented; numeric IDs are checked with Telegram and username reservations bind on the first authenticated claim. |
| How may admins select recipients? | Keep profile picker and manual numeric Telegram-ID entry; allow known and unknown usernames without removing those methods. | Implemented in the admin picker. |
| What if a group is removed while envelopes are active? | Warn and defer group cleanup until active envelopes have expired or settled. | Implemented. |
| What feedback should claimants receive? | Explain clearly when a claimant is unauthorized or has not met claim requirements. | Implemented with localized error messages and separate audience/requirements states. |
| Which payment rails are used? | USDT on TRON; deposits/withdrawals use TRC20; claims and mine settlement use the internal ledger. | Implemented/documented. |
| Can real-value mine play go live silently? | No. Real-funds mine play is disabled by default and requires separate legal/compliance approval. | Implemented with `MINE_GAME_REAL_FUNDS_ENABLED=false` by default. |
| Who is the admin/investor sender? | Admin-created envelopes are sent by the configured treasury wallet. Gross payout is distinct from net profit. | Admin panel reports all-time gross payouts, net realized P&L for settled mine envelopes (`settled payouts + refunds − funded totals`), and active unclaimed value separately. |
| How are developer requests handled? | Requests are centrally shared among authorized admins and previewed before saving; they are not sent externally. | Shared, audited admin inbox is implemented; its Prisma migration must be applied before use. Saving only writes the message to the inbox and does not send or notify anyone externally. |

## Partial requirements

| Area | Current status | Still needed for production acceptance |
|---|---|---|
| Double-entry accounting | Every user balance mutation creates an immutable ledger entry and updates cached balances atomically. | Add explicit system-side journal accounts so every journal transaction balances debits and credits; add scheduled liability-to-chain reconciliation. |
| Deposit address provisioning | Real mode only accepts unique `User.depositAddress` values and scans each assigned address. | Integrate a reviewed custody provider or KMS/HSM-backed self-custody allocator and sweeping/energy strategy. Admins cannot safely generate private keys in the web panel. |
| Notifications | Envelope creation and claim results are sent in Telegram; claim-button counts are updated. | Add deposit-confirmed and withdrawal lifecycle notifications, completion notices, and retryable notification jobs. |
| Envelope lifecycle | Active/completed/expired/refunded are persisted; partial state is represented by remaining slots. | Optional explicit DRAFT/PARTIALLY_CLAIMED states and admin envelope search/filter UI. |
| Risk controls | Rate limits, account age, message participation, membership, daily group claim cap, user ban, manual approval, and hot-wallet cap exist. | Add configurable daily withdrawal/sender value limits, claim cooldown, IP/device heuristics, suspicious-event review, and address screening. |
| Observability | Health endpoints, logs, audit records, queue failures, and a hot-wallet-cap Redis alert exist. | Add structured metrics, alert delivery, error tracking, provider-lag monitoring, and operations runbooks. |
| Tests | Property-style random allocation tests and MFA tests exist; TypeScript/build validation runs. | Add database-backed concurrent 50/100/500 claimant tests, RPC failure injection, webhook replay, deposit deduplication, RBAC, backup/restore, and reconciliation tests in CI. |

## Not complete / external launch requirements

These cannot be truthfully marked complete by application code alone:

1. Production KMS/HSM or approved custody-provider integration and key rotation.
2. Cold-storage sweep policy and reserve operations.
3. KYC/AML, sanctions/address screening, supported jurisdictions, custody terms, privacy policy, and legal review.
4. Independent penetration test and financial/security code review.
5. Managed backups with a tested restore drill and defined RPO/RTO.
6. Provider redundancy and blockchain reorganization handling.
7. Load-tested horizontal deployment and 100/500-user claim acceptance evidence.
8. Formal accounting/reconciliation policy and operator sign-off.
9. Support/dispute process, data-retention policy, and localization decisions.

## Safe operating conclusion

The repository implements the main **test/MVP envelope operations**. It must remain in `FUNDS_MODE=test` until every production item above—especially custody provisioning, reconciliation, concurrency/failure testing, monitoring, and legal/security review—is completed and signed off. Real-funds mine play also requires the explicit `MINE_GAME_REAL_FUNDS_ENABLED=true` setting after separate legal/compliance approval; its default is `false`. `FUNDS_MODE=real` is a technical guardrail, not a declaration that a deployment is legally or operationally production-ready.
