# Supabase database, authentication and security

Phase 1 adds the database schema, RLS, transactional functions and seed data.
Phase 3 adds append-only administrator auditing and server-side admin authorisation.
Phase 4 connects registration/login/password reset to Supabase Auth and keeps the
encrypted journal local.
Phase 5 adds the credit-ledger invariants, uncertain-outcome reconciliation, audited
administrator adjustments, spend-rejection tracking and a guarded legacy-wallet importer.
Phase 6 adds the Supabase admin overview, usage analytics and audited credit management
(settings, wallet search, user ledger and add/remove adjustments).

## Migrations

Apply in filename order:

1. `migrations/20261103000100_schema.sql`
2. `migrations/20261103000200_seed.sql`
3. `migrations/20261103000300_functions.sql`
4. `migrations/20261103000400_rls.sql`
5. `migrations/20261104000100_phase3_admin_security.sql`
6. `migrations/20261104000200_phase5_credits.sql`
7. `migrations/20261104000300_phase6_admin_overview.sql`
8. `migrations/20261104000400_phase6_usage_analytics.sql`
9. `migrations/20261104000500_phase6_credit_management.sql`

With the Supabase CLI linked to a project (the CLI may prompt for the database password):

```bash
npx supabase link --project-ref PROJECT_REF
npx supabase db push --remote
```

For a disposable local/CI database:

```bash
npx supabase db reset
```

Do not run these against production until the existing JSON backup has been verified and
the rollout has been approved.

## Auth environment

Server-only:

```bash
SUPABASE_URL="https://PROJECT_REF.supabase.co"
SUPABASE_ANON_KEY="..."
SUPABASE_SERVICE_ROLE_KEY="..."
APP_ORIGIN="https://your-app.example"
SUPABASE_AUTH_ENABLED="false"  # set true only when switching live auth
```

The service-role key bypasses RLS and must never appear in `VITE_` variables or the browser.
The browser calls only this app's `/api/auth/*` routes; it does not receive Supabase tokens.
`SUPABASE_AUTH_ENABLED=false` keeps the legacy account path while the connection is
verified; set it to `true` only for the controlled auth cut-over.

## Staged connection check

With the three server credentials present, verify the hosted project without changing
live auth or data:

```bash
npm run supabase:connection
```

The probe uses `@supabase/supabase-js` on the server, prints only variable names, the
project ref and schema readiness, and exits non-zero until the migration tables and Free
plan seed are present. It does not print a key or row data. `SUPABASE_AUTH_ENABLED=false`
keeps registration/login on the legacy path during this stage.

## Required Auth dashboard configuration

1. Authentication → URL Configuration: set the Site URL and add
   `<APP_ORIGIN>/api/auth/callback` to the redirect allow list. Add localhost/preview
   callbacks for those environments.
2. Keep email confirmation enabled.
3. Configure custom SMTP for production. The default sender is testing-only and rate-limited.
4. Replace the Confirm signup email link with:

   ```html
   <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup">Verify my email</a>
   ```

5. Replace the Reset password email link with:

   ```html
   <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Reset my password</a>
   ```

The callback exchanges the token hash server-side; it does not rely on the default
`{{ .ConfirmationURL }}` fragment session. See `docs/authentication.md` for the full flow.

## What registration creates

The `on_auth_user_created` trigger calls `create_profile_and_wallet`, which is idempotent.
Every new user gets one profile, one Free wallet using the 100-credit seeded allocation and
one Free/SANDBOX subscription with no RevenueCat purchase reference. The server calls the
same RPC after registration, login and verification as a safety net. The browser cannot
choose a plan, balance, period or administrator role.

## Local tests

The foundation and RLS suites use embedded PostgreSQL/PGlite and bootstrap a minimal
Supabase `auth` schema. The Supabase HTTP adapter suite mocks Supabase Auth/PostgREST at the
HTTP boundary. No hosted project is contacted.

```bash
npm run supabase:test
npm run security:test
npm run auth:supabase:test
```

`security:test` runs the admin middleware suite and the RLS/database-permission suite.
The two-connection concurrency test needs a real Postgres/Supabase database:

```bash
npm run supabase:concurrency:local
# or
SUPABASE_TEST_DB_URL="postgresql://..." npm run supabase:concurrency:test
```

The test creates and removes its own `auth.users` row. Use a disposable database, never
production, and never commit the URL.

## Security rules

- Authenticated users can read their own profile, wallet, credit history, usage,
  subscription and encrypted vault rows.
- Financial and billing writes happen only through `SECURITY DEFINER` functions called by
  the server's service-role client.
- `vault_records.ciphertext` is the existing encrypted payload. The server never sees
  plaintext journal content.
- `admin_users`, `admin_audit_log`, `ai_settings`, billing aliases, RevenueCat events,
  spend counters/reservations and safety tables have no ordinary-user policies.
- `admin_audit_log` is append-only and written through `record_admin_audit`, executable
  only by `service_role`.

## Administrator setup

After creating an administrator in Supabase Auth, add exactly that user id:

```sql
insert into public.admin_users (user_id)
values ('00000000-0000-0000-0000-000000000000')
on conflict (user_id) do nothing;
```

Do this with the service role or Supabase SQL editor, never from the browser.
`AI_ADMIN_TOKEN` is a temporary break-glass path; remove it once every operator has an
`admin_users` row.

## Data protection

The original JSON files remain untouched under `data/`. Phase 1 made a checksummed backup
under `backups/` (gitignored). The encrypted journal stays in the browser. Phase 4 creates
Supabase profiles, wallets and Free subscriptions for Supabase identities; it does not
import or reassign legacy browser wallets automatically.

## Phase 5 credit migration and rollback

Phase 5 is additive. Applying the migration does **not** import, grant, reset or delete a
legacy balance, and the running app continues to use `data/ai-credits.json` until an
explicit cut-over is implemented and approved.

What the Phase 5 migration adds:

- `credit_transactions.balance_before`, enforced by a trigger so every new row reconciles
  `balance_before + credits_delta = balance_after`;
- `uncertain` credit-request and spend-reservation states, plus explicit administrator
  reconciliation functions. An unclear provider outcome is never auto-refunded;
- `legacy_credit_imports`, `import_legacy_wallet(...)`, and an idempotent per-source import;
- `admin_adjust_credits(...)`, which requires a reason and writes one append-only audit row;
- `ai_spend_rejections` and `admin_financial_overview()` for the dashboard aggregates.

### Safe legacy import

Do not run this until the hosted schema is applied and a verified
`profiles.legacy_user_id` mapping exists.

```bash
npm run supabase:connection
npm run supabase:migrate-credits              # dry run
npm run supabase:migrate-credits -- --apply   # writes the JSON backup first
```

The importer reads `data/ai-credits.json` by default and never deletes or edits it. It
accepts ownership only from `public.profiles.legacy_user_id`; it never uses a token hash,
device id, email or browser-supplied id. A wallet with legacy requests/history is refused
for manual review, and a wallet that already has credit activity is never overwritten.

A redacted report is written to `reports/phase5-credit-migration-<timestamp>.json`. It
excludes token hashes. Unmatched wallets remain in the JSON file. The known wallet
`7d84bc015a65bb83c6ce25040cf6b1e969d5d619` (100 credits) is currently unmatched; do not
assign it to a person without verified ownership.

### Cut-over rule

Do not run two independently writable credit systems. The intended cut-over is:

1. apply and verify the nine migrations on staging;
2. import eligible wallets and compare balances/transaction totals to the backup;
3. switch the server credit and spend path to Supabase behind a reviewed deployment;
4. keep the JSON files read-only as a temporary backup;
5. roll back by restoring the JSON deployment and leaving Supabase data untouched.

The backend cut-over is not part of this migration. Until it is explicitly implemented,
tested against staging and approved, Supabase credit tables are a prepared destination,
not the live source of truth.

### Phase 5 tests

```bash
npm run supabase:phase5:test
npm run credits:migration:test
```

### Phase 6 tests

```bash
npm run ai:admin:supabase:test
npm run ai:admin:analytics:test
npm run ai:admin:credit:test
```

The credit-management suite exercises the real migration chain in PGlite, including
add/remove balances, before/after records, duplicate-request idempotency, negative-balance
rejection, administrator audit rows, break-glass handling, ordinary-user denial, settings
changes that leave existing wallets and historical transactions untouched, and the HTTP
admin routes.

These use embedded PostgreSQL and pure planners. They do not contact a hosted project and
do not touch the live JSON ledger.
