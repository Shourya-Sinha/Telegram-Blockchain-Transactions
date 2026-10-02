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
- Equal and cryptographically randomized integer-only envelope allocation.
- Atomic row-locked claims, unique `(envelopeId, userId)`, exact remaining amount/slot updates, one claim per user, expiry, and refund.
- Available and locked wallet balances. New withdrawals atomically move amount plus fee from available to locked; completion settles locked funds; an authorized rejection releases them with refund ledger entries. Failed payouts remain locked for review/retry.
- Withdrawal idempotency key, persisted broadcast intent, transaction-hash recovery check, configurable fee/minimum/approval threshold, retry, reject, and emergency switch.
- Unique per-user production deposit address requirement, transaction-hash uniqueness, token/destination/amount storage, real confirmation counting, confirmed-deposit crediting, user deposit history, and admin reconciliation screen.
- Test and real-funds modes that fail closed; test balances cannot use blockchain deposits. Test-mode withdrawals can be enabled per deployment with a single required test TRC20 address (`TEST_WITHDRAWAL_ADDRESS`): they settle entirely in the ledger as `simulated` audit-marked records and never broadcast. Development can grant a row-locked, ledger-idempotent one-time welcome balance with `DEV_AUTO_CREDIT_USDT`, and admins can issue additional audited test credits.
- Admin roles, password authentication, actual TOTP verification when an MFA secret is configured, user inspection, transaction history, withdrawal/deposit views, group policy, audit logs, and emergency controls.
- Group membership checks, per-user API rate limits, group message/account-age rules, daily group claim limit, user blocking, and claim concurrency protection.
- Mini App wallet, create-envelope form, claim animation/result, withdrawal form, ledger activity, Telegram back button, compact Telegram viewport, and safe-area handling.
- Independent repeatable expiry worker, deposit worker, withdrawal worker, audit events, and Docker deployment files.

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

The repository implements the main **test/MVP envelope operations**. It must remain in `FUNDS_MODE=test` until every production item above—especially custody provisioning, reconciliation, concurrency/failure testing, monitoring, and legal/security review—is completed and signed off. `FUNDS_MODE=real` is a technical guardrail, not a declaration that an deployment is legally or operationally production-ready.
