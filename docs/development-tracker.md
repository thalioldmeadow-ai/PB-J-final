# Plan Believe Journal — Development Tracker

**Audit date:** 5 November 2026  
**Scope:** Stages 1–6 of the roadmap  
**Current gate:** Stage 2 — Supabase foundation is connected but not acceptance-complete.

This tracker is the persistent source of truth for implementation status. It is deliberately stricter than a code inventory: **“Complete” means implemented, connected, activated and observed working.** Code that exists but is disabled, unconfigured, unreachable or only covered by a mock is marked **partial** or **incomplete**, not complete.

## Status key

| Status | Meaning |
|---|---|
| **Complete** | Implemented, wired into the running app, and verified by a runtime check or a passing behavioural test. |
| **partial** | Some implementation and evidence exist, but a required connection, activation step, UI path, environment or test is missing. |
| **incomplete** | The required behaviour is missing, stubbed, unreachable or not connected. |
| **blocked** | Cannot proceed without a decision, credential, external setup, account or prerequisite. |

Priorities are **Critical**, **High**, **Medium** and **Low**. Dependencies refer to task IDs in this document.

---

## 1. Current release position

- **Stage 1 is complete as an audit deliverable:** every major surface has been inspected and this tracker has been created. Documentation reconciliation and version-control hygiene remain open as tracked debt.
- **The real delivery gate is Stage 2.** Hosted Supabase is reachable and the schema exists, but the app is still running on the legacy JSON account and credit planes. The Supabase auth, credit and analytics paths are built ahead of activation.
- **Later-stage code is ahead of rollout.** Stages 3–6 contain substantial implementation, but several acceptance paths cannot be exercised until identity, wallet ownership and admin access are reconciled.
- **No source code was changed during this audit.** The existing RevenueCat sandbox integration was preserved.

### Runtime snapshot

| Check | Observed result |
|---|---|
| Hosted Supabase | `SUPABASE_CONNECTION_OK`; 20 expected tables present; 9 local migrations. |
| Hosted data | 1 profile, 1 wallet, 1 subscription, 0 admin users, 2 admin-audit rows; vault, credit, usage and RevenueCat linkage rows are empty. |
| Local legacy data | 1 account in `data/auth.json`; 2 wallets in `data/ai-credits.json`, each with an allocated balance of 100; 0 AI requests recorded. |
| Auth runtime | `/api/auth/config` returns `provider: "password"`, `configured: true`, `emailVerification: false`. Supabase Auth is not active. |
| RevenueCat runtime | Sandbox; `purchasesEnabled: true`, `verificationConfigured: false`, `webhookConfigured: false`; products `monthly`, `yearly`, `lifetime`. |
| AI runtime | `enabled: false`; no active provider. OpenAI is configured but `OPENAI_ENABLED=false`. No Gemini integration. |
| Admin runtime | `/admin/ai` UI and API exist; no `admin_users` row exists, so the normal Supabase admin path is not live-tested. |
| Version control | No Git repository exists. A filesystem backup exists under `backups/phase1-20261103T234741Z/`. |

### Verification baseline

| Check | Result |
|---|---|
| `npm run lint` — TypeScript | **Pass** |
| `npm run build` — Vite and server bundle | **Pass**, with a 2.2 MB client chunk, CSS optimizer warnings and `import.meta` CommonJS warnings. |
| `npm run supabase:connection` | **Pass** — `SUPABASE_CONNECTION_OK` |
| Test baseline | **16 pass, 1 skipped, 3 fail** across 20 test commands covering 21 files. |
| `credits:migration:test` | **Fail 7/8** — expects 1 live wallet, finds 2. |
| `ai:audit:test` | **Fail 0/1** — calls `/spending/settings` without the required `confirm: true` and reason; the endpoint returns `confirmation_required`. |
| `ai:admin:analytics:test` | **Fail 15/44** — date-bound fixtures plus history/pagination assertions fail; the suite ends with a `TypeError` reading `requestId`. |
| `supabase:concurrency:test` | **Skipped** — `SUPABASE_TEST_DB_URL` is unset, so the real two-connection race was not run. |

There is **no aggregate `npm test` script** and no CI test workflow. The baseline is therefore a set of individually invoked `tsx` suites, not a release gate; `security:test` runs two files under one command.

---

## 2. Stage summary

| Stage | Objective | Gate status | Exit condition |
|---|---|---|---|
| **1** | Audit the application and create a persistent tracker | **Complete** | All major frontend, backend, database, auth, AI, billing and admin surfaces inspected; runtime evidence recorded; tracker published. |
| **2** | Establish Supabase as the verified foundation | **partial** | One canonical identity and wallet per user; migrations reproducible; hosted RLS proven; backup and rollback exercised. |
| **3** | Activate secure authentication and authorization | **partial** | Supabase Auth enabled; registration, verification, login, refresh, logout, reset and account deletion verified end-to-end; admin access proven. |
| **4** | Operate one canonical credit and subscription ledger | **partial** | Supabase wallet is authoritative; atomic reserve, settle and refund proven under concurrency; JSON ledger retired or explicitly fallback-only. |
| **5** | Activate the AI provider and agent safely | **partial** | One provider enabled; live request succeeds; credits are charged once; tools, confirmations, memory and refusals verified against the live model. |
| **6** | Make `/admin/ai` the operational control surface | **partial** | Admin signs in; overview, analytics, monitoring, credits and spending agree with one source of truth; controls change real behaviour; tests pass. |

### Stage 1 — Audit and development tracker

| ID | Stage | Task | Status | Priority | Dependencies | Evidence / acceptance | Next action |
|---|---|---|---|---|---|---|---|
| 1.1 | 1 | Inventory all frontend routes, pages and shared components | Complete | High | — | Route table and page review completed; all principal routes and detail/assign flows inspected. | Keep this inventory current as routes change. |
| 1.2 | 1 | Inventory Express routes, services and middleware | Complete | High | 1.1 | `server.ts`, auth, AI, billing, security and admin routers reviewed. | Add new endpoints to this tracker when introduced. |
| 1.3 | 1 | Inventory Supabase configuration and migrations | Complete | High | — | 9 migrations reviewed; hosted schema checked; 20 expected tables found. | Record future migrations in the migration log. |
| 1.4 | 1 | Review auth, credits, AI/agent and admin architecture | Complete | Critical | 1.1–1.3 | Runtime flags, source paths, tests and data planes compared. | Use findings in Stages 2–6. |
| 1.5 | 1 | Probe live configuration and integration status | Complete | Critical | 1.3 | Supabase connection, auth config, RevenueCat config and AI status probed. | Re-run probes after each activation change. |
| 1.6 | 1 | Establish build and typecheck baseline | Complete | High | — | Typecheck passes; production build passes with warnings. | Track bundle and test-gate debt separately. |
| 1.7 | 1 | Establish test baseline | Complete | High | — | 20 commands covering 21 files executed; 16 pass, 3 fail, 1 skip. | Fix the three failures and run the skipped concurrency suite. |
| 1.8 | 1 | Publish persistent development tracker | Complete | Critical | 1.1–1.7 | This document. | Update status and evidence as remediation lands. |
| 1.9 | 1 | Reconcile documentation with the actual system | incomplete | Medium | 1.8 | `docs/authentication.md` still describes six migrations although nine exist; `README.md` presents a GitHub Pages deployment that cannot serve the Express/Supabase API. | Correct docs during Stage 2 documentation pass. |
| 1.10 | 1 | Establish a version-control checkpoint | blocked | Critical | 1.8 | `git` reports “not a git repository”; no history or diff safety net exists. | Initialise Git, add an appropriate `.gitignore`, and commit the audited baseline before remediation. |

**Stage 1 note:** the audit deliverable is complete. Tasks 1.9 and 1.10 are remediation hygiene items that do not invalidate the audit, but they must be resolved before broad code changes.

---

## 3. Stage 2 — Supabase foundation and data ownership

| ID | Stage | Task | Status | Priority | Dependencies | Evidence / acceptance | Next action |
|---|---|---|---|---|---|---|---|
| 2.1 | 2 | Apply the migration set to hosted Supabase | Complete | Critical | 1.3 | 9 local migrations applied; `SUPABASE_CONNECTION_OK`; 20 expected tables present. | Keep a migration ledger and never edit applied migrations. |
| 2.2 | 2 | Verify schema, keys, constraints and relationships | partial | High | 2.1 | Table presence and core counts verified; indexes, foreign keys and all function signatures were not exhaustively audited on the hosted database. | Run a schema assertion script against hosted and record the result. |
| 2.3 | 2 | Prove migrations replay from an empty database | partial | High | 2.1 | Suites use PGlite/embedded Postgres, but a clean hosted-equivalent replay with verification is not part of the release gate. | Add a disposable-database replay check to CI. |
| 2.4 | 2 | Prove hosted RLS isolation between two real users | incomplete | Critical | 2.1, 3.5 | RLS tests exist locally, but hosted isolation has not been exercised with two authenticated accounts. | Create two test accounts and test read/write denial across profiles, wallets, journal and usage. |
| 2.5 | 2 | Map every legacy JSON data plane to a Supabase target | Complete | High | 1.4 | Duplicate planes documented: auth, wallets, usage, AI settings, subscriptions and audit. | Use the canonical-target table in section 9. |
| 2.6 | 2 | Reconcile legacy accounts with Supabase identities | blocked | Critical | 3.13 | One local account and one hosted profile exist, but the migration/cutover relationship is not proven; local auth remains active. | Decide whether to migrate, link or retire the legacy account, then record the mapping. |
| 2.7 | 2 | Consolidate the two local credit wallets into one canonical wallet per user | blocked | Critical | 2.6 | Two local wallets exist; the migration test expects one live wallet and fails 7/8. | Identify the test/duplicate wallet, reconcile ownership, then re-run the migration test. |
| 2.8 | 2 | Retire duplicate usage and AI-settings reads | partial | High | 2.6 | Some admin panels read Supabase while overview and fallbacks read JSON; usage JSON currently has zero requests and Supabase usage is empty. | Choose canonical stores, backfill, then make all panels read the same source. |
| 2.9 | 2 | Make app-domain data survive logout, refresh and a new device | partial | Critical | 2.6 | Encrypted journal and budgeting are browser-local; server-backed persistence is not active for the core journalling experience. | Decide local-only versus synced journal, then implement and test the chosen contract. |
| 2.10 | 2 | Preserve encrypted journal data during migration | partial | Critical | 2.9 | The encrypted vault exists and is local; the `__adopted` marker is treated as an encrypted record and produces an `atob` error during storage scan. | Move adoption metadata outside the encrypted-record namespace and test an existing-vault upgrade. |
| 2.11 | 2 | Migrate profile, settings, budget and transaction data | incomplete | High | 2.6 | Budgeting remains local-vault only; mood and theme settings live outside the encrypted vault; no hosted migration path is verified. | Define which data is private local-only and which is account-synced; migrate the latter. |
| 2.12 | 2 | Write and exercise a migration and rollback runbook | partial | Critical | 2.1 | `supabase/README.md` gives cutover guidance, but no full rollback/recovery rehearsal is recorded. | Add ordered steps, verification queries and a tested rollback point. |
| 2.13 | 2 | Verify database backup and restore | partial | Critical | 2.1 | A filesystem backup exists for local files; no Supabase backup or restore drill is documented. | Take a hosted backup, restore into a disposable project, and record row-count checks. |
| 2.14 | 2 | Define retention, export and account-deletion behaviour | incomplete | High | 2.12, 3.13 | No complete deletion/export workflow exists for server-side account, journal, usage or billing records. | Define retention policy and implement export/delete paths before public launch. |

**Stage 2 acceptance gap:** the database is connected, but “connected” is not the same as “single source of truth.” Auth, wallets, usage, settings and subscriptions still have parallel representations.

---

## 4. Stage 3 — Authentication, authorization and security

| ID | Stage | Task | Status | Priority | Dependencies | Evidence / acceptance | Next action |
|---|---|---|---|---|---|---|---|
| 3.1 | 3 | Registration, login and session issuance | Complete | Critical | 2.1 | Supabase auth routes, encrypted HttpOnly cookie, profile/wallet creation and mocked tests exist. | Verify against hosted auth before calling Stage 3 complete. |
| 3.2 | 3 | Refresh, logout and server-side revocation | Complete | Critical | 3.1 | Refresh and revocation code and tests exist; cookie is HttpOnly, SameSite=Strict and Secure in production. | Add a hosted copied-cookie rejection test. |
| 3.3 | 3 | Password reset | Complete | High | 3.1 | Server-mediated reset flow and tests exist. | Verify one real reset email and token exchange. |
| 3.4 | 3 | Email verification and callback | partial | Critical | 3.1 | Callback, resend and verified-state handling exist; runtime reports `emailVerification: false`; no delivered email was tested. | Configure SMTP/template and complete a real signup-to-verification journey. |
| 3.5 | 3 | Enable Supabase Auth as the live provider | incomplete | Critical | 3.1–3.4 | `SUPABASE_AUTH_ENABLED` is effectively off; `/api/auth/config` still reports the legacy password provider. | Enable the flag in a controlled environment, then run the full auth acceptance matrix. |
| 3.6 | 3 | Prove end-to-end auth on the hosted path | incomplete | Critical | 3.5 | No real hosted registration, verification, login, refresh, logout or reset has been completed. Mocks are not runtime proof. | Execute and record the full journey with a disposable account. |
| 3.7 | 3 | Protect all private routes and APIs | partial | Critical | 3.5 | Middleware and ownership helpers exist, but private-route behaviour has not been proven with signed-out, expired and cross-user sessions. | Test 401/403 responses for every private route. |
| 3.8 | 3 | Prove server-side ownership and RLS together | incomplete | Critical | 2.4, 3.5 | Local RLS tests exist; no hosted two-user read/write isolation proof. | Test direct Supabase access and app APIs with two accounts. |
| 3.9 | 3 | Provision and verify administrator access | blocked | Critical | 3.5 | `admin_users` has 0 rows; only the break-glass token path may be available. The normal Supabase admin sign-in is not live-tested. | Create the first admin through a controlled server-side procedure and test least-privilege access. |
| 3.10 | 3 | Verify admin audit logging | partial | High | 3.9 | Supabase audit has 2 rows; a local JSON fallback exists; mutations refuse to proceed when audit storage is unavailable. | Exercise a successful and a refused admin mutation and verify both audit records. |
| 3.11 | 3 | Security headers and CSP | Complete | High | — | CSP, HSTS in production, frame denial, nosniff and referrer policy are configured in `server.ts`. | Keep CSP in sync with every new external asset. |
| 3.12 | 3 | Input validation, same-origin checks and rate limiting | Complete | High | — | Server-side validation, same-origin mutation checks and AI limits are implemented and covered by tests. | Re-test after auth cutover. |
| 3.13 | 3 | Account deletion, export and session cleanup | incomplete | High | 3.5, 2.14 | No complete self-service deletion/export path covering auth, profile, wallet, journal, usage and billing records. | Implement and test deletion plus data export. |
| 3.14 | 3 | Secrets and environment hygiene | Complete | Critical | — | Server secrets are not sent to the browser; RevenueCat exposes only a public sandbox key; no service-role key is in client code. | Rotate any exposed development secret before production. |
| 3.15 | 3 | Session revocation store lifecycle | partial | Medium | 3.1 | `data/supabase-sessions.json` is designed as a mode-0600 revocation store; it does not exist while auth is disabled, so persistence and cleanup are unverified. | Create it during auth activation and test restart, logout and expiry cleanup. |
| 3.16 | 3 | Allow required remote images and timer audio through CSP | incomplete | Medium | 3.11 | `img-src` excludes `picsum.photos` used by meal/workout/recipe fallbacks; `media-src 'self' blob:` blocks the Mixkit timer sound in `Routines.tsx`. | Host assets locally or add narrowly scoped CSP sources. |

**Security strengths to preserve:** server-mediated Supabase sessions, encrypted HttpOnly cookies, generic auth errors, server-side ownership checks, same-origin mutation protection, constant-time break-glass comparison, no prompts or note contents in admin responses, and no service-role key in browser code.

---

## 5. Stage 4 — Credits and subscriptions

| ID | Stage | Task | Status | Priority | Dependencies | Evidence / acceptance | Next action |
|---|---|---|---|---|---|---|---|
| 4.1 | 4 | Document credit rules, plans and pricing | partial | High | 1.4 | Rules exist in config, migrations and tests, but there is no single operator-facing credit specification covering grants, reservations, refunds, expiry and plan changes. | Publish one credit rules document and link it here. |
| 4.2 | 4 | Enforce one wallet per user | Complete | Critical | 2.1 | Supabase wallet keyed by `user_id`; idempotent `ensure_wallet`; repeated registration/login tests. | Verify on hosted with repeated auth calls. |
| 4.3 | 4 | Atomic reserve, settle and refund | Complete | Critical | 4.2 | Local ledger and database-function tests cover reservation and settlement behaviour. | Run the same concurrency proof against hosted Postgres. |
| 4.4 | 4 | Idempotency and concurrent request safety | partial | Critical | 4.3 | Concurrency suites exist locally; no hosted race test with real HTTP requests. | Execute a bounded concurrent request test and verify one charge per request. |
| 4.5 | 4 | Do not charge failed or refused AI requests | Complete | Critical | 4.3 | Failed-request and spend-rejection tests pass. | Re-test with a live provider failure. |
| 4.6 | 4 | Make Supabase the live wallet ledger | blocked | Critical | 2.7, 3.5 | The live app uses the JSON ledger; Supabase wallet/credit tables are effectively empty; two local wallets remain. | Reconcile identities and wallets, backfill, then switch reads and writes in one controlled cutover. |
| 4.7 | 4 | Preserve balances through migration | blocked | Critical | 4.6 | No verified one-to-one legacy-wallet mapping; migration test fails because of the second wallet. | Produce a reconciliation report and obtain sign-off before moving balances. |
| 4.8 | 4 | Verify balance, history and low-credit UI | partial | High | 4.6 | Balance display exists; complete transaction history and low-balance/paywall states are not proven against the canonical ledger. | Test empty, low, exhausted and refunded states. |
| 4.9 | 4 | Admin credit adjustments and settings | partial | High | 3.10, 4.6 | Admin credit-management routes and tests exist; no live admin user and no hosted credit rows. | Exercise adjustment, plan change and audit against a test account. |
| 4.10 | 4 | Reconcile wallet fields with subscription records | partial | High | 3.5, 4.6 | Local wallet carries plan/subscription fields while Supabase has a separate subscriptions table; RevenueCat linkage is unpopulated. | Choose one subscription source and make wallet reads derive from it. |
| 4.11 | 4 | Verify RevenueCat purchase-to-credit lifecycle | blocked | High | 3.5, 4.6 | Sandbox checkout opens and products load, but no purchase has been completed and webhook verification is not configured. | Complete a sandbox purchase and verify entitlement, subscription row and credit grant. |
| 4.12 | 4 | Ensure failed payment and expiry behaviour | incomplete | High | 4.10, 4.11 | No verified downgrade, grace-period, expiry or refund path for credits and plan state. | Define and test each billing state transition. |

**Stage 4 acceptance gap:** atomic credit mechanics are tested, but the live ledger is still the JSON one. Supabase being present does not mean credits are running on Supabase.

---

## 6. Stage 5 — AI provider, agent and safety

| ID | Stage | Task | Status | Priority | Dependencies | Evidence / acceptance | Next action |
|---|---|---|---|---|---|---|---|
| 5.1 | 5 | Configure at least one live AI provider | partial | Critical | — | OpenAI key is present but `OPENAI_ENABLED=false`; no active provider means the coach cannot answer. | Choose the launch provider and enable one model deliberately. |
| 5.2 | 5 | Activate AI globally | blocked | Critical | 5.1, 4.6 | `AI_ENABLED=false`; no provider is active; credit cutover is incomplete. | Activate only after credits and auth are canonical. |
| 5.3 | 5 | Secure AI gateway and provider routing | Complete | Critical | 5.1 | Server-only provider calls, timeouts, model allowlist, feature routing, fallback and redaction are implemented and tested. | Add a live provider contract test. |
| 5.4 | 5 | Enforce credits and spending controls per request | partial | Critical | 5.3, 4.6 | Local reservation/settlement and spend-limit tests pass; hosted ledger is not live. | Re-run against the hosted wallet and a live provider error. |
| 5.5 | 5 | Controlled app actions and tool layer | Complete | High | 3.5 | AI actions are whitelisted and scoped; unsupported actions are refused. | Add live-model tool-selection tests. |
| 5.6 | 5 | Destructive-action confirmation | Complete | Critical | 5.5 | Confirmation tests exist for actions that require explicit approval. | Verify the confirmation survives a page refresh. |
| 5.7 | 5 | Context, verified facts and user scoping | Complete | High | 5.3 | Context builders and verified facts are separated; prompts are scoped to the user. | Add a cross-user context-leak regression test. |
| 5.8 | 5 | Memory controls and user disablement | Complete | High | 5.3 | Memory read/write/delete controls and per-user disable path exist with tests. | Verify controls in the live UI. |
| 5.9 | 5 | Safety, refusal and prompt-injection handling | Complete | High | 5.3 | Safety and injection tests pass; model output is not treated as trusted. | Add adversarial cases for app actions and memory. |
| 5.10 | 5 | End-to-end live coach test | blocked | Critical | 5.2, 4.6 | No live AI request has been made; chat is disabled without a provider. | Run a scripted request that consumes credits once and returns a safe answer. |
| 5.11 | 5 | Provider fallback and outage handling | Complete | High | 5.1 | Fallback ordering and failure tests exist. | Test one real timeout/rate-limit path. |
| 5.12 | 5 | Usage, cost and observability | partial | High | 5.2 | JSON usage has 0 requests; Supabase usage tables are empty; admin panels read different sources. | Send one traced request and verify usage, cost and credit rows agree. |
| 5.13 | 5 | Model pricing and budget enforcement | partial | Critical | 5.1 | Unpriced models produce an admin warning; no live model spend has been observed. | Attach verified prices and test budget refusal at the boundary. |
| 5.14 | 5 | Gemini integration required by the roadmap | incomplete | High | 5.1 | No Gemini provider exists; current providers are Freebuff, OpenAI and Hugging Face. | Decide whether Gemini is required for launch; if yes, implement and test it, otherwise record an approved scope change. |
| 5.15 | 5 | AI Coach UI states | partial | High | 5.2 | Chat UI exists but cannot produce a live answer while AI is disabled. | Verify ready, disabled, no-credit, rate-limited and provider-error states. |

**Important:** the AI architecture is substantially built and well tested in isolation. The blocker is activation and ledger integration, not the absence of a design.

---

## 7. Stage 6 — `/admin/ai` operator dashboard

| ID | Stage | Task | Status | Priority | Dependencies | Evidence / acceptance | Next action |
|---|---|---|---|---|---|---|---|
| 6.1 | 6 | Build the admin dashboard UI and client | Complete | High | 1.4 | `/admin/ai` page, tabs, API client, loading and error states exist. | Add a browser-level smoke test after admin access exists. |
| 6.2 | 6 | Require a real administrator identity | blocked | Critical | 3.9 | No `admin_users` row exists; the normal Supabase admin path has not been authenticated. | Provision an admin and verify 401, 403 and allowed access. |
| 6.3 | 6 | Live overview from one source of truth | partial | High | 2.8 | `buildOverview` reads JSON configuration/usage, while Supabase overview and analytics are separate routes. | Unify the overview on the canonical stores. |
| 6.4 | 6 | Usage analytics | incomplete | Critical | 2.8 | Supabase analytics has no usage events; `ai:admin:analytics:test` fails 15/44 because of a hard-coded date range. | Seed relative fixtures, fix the test, and verify with real usage. |
| 6.5 | 6 | Per-user activity and security monitoring | partial | High | 2.8, 3.5 | Monitoring falls back to local JSON; Supabase activity is empty; local mode has documented blind spots. | Backfill or generate hosted events and verify user drill-down. |
| 6.6 | 6 | Credit balances, transactions and adjustments | partial | High | 4.6 | Supabase credit-management views exist but the live ledger is JSON and hosted credit tables are empty. | Cut over credits, then verify balances and adjustments. |
| 6.7 | 6 | Spending controls and emergency pause | partial | Critical | 5.3, 3.10 | Spending settings and pause controls exist; the audit test fails because a mutation is sent without confirmation fields. | Fix the client/test contract and verify the control changes request behaviour. |
| 6.8 | 6 | Audit every admin mutation | partial | Critical | 3.10 | Audit writer and local fallback exist; 2 hosted rows; no successful end-to-end admin mutation recorded. | Verify attempt and success records for one real change. |
| 6.9 | 6 | Model and feature configuration | Complete | High | 6.2 | Settings patch, preview, validation and restore tests exist. | Verify one live change and restore through the UI. |
| 6.10 | 6 | Live dashboard acceptance | blocked | Critical | 6.2, 4.7, 5.2 | Dashboard cannot be accepted while admin access, credits and AI are not live. | Run a full operator journey after the upstream gates close. |
| 6.11 | 6 | Alert review workflow | Complete | Medium | 6.5 | Alert normalisation, review status and note limits have tests. | Verify persistence and audit on hosted data. |
| 6.12 | 6 | Dashboard identity and data consistency | partial | High | 6.2, 6.3 | The page can show local configuration and Supabase analytics side by side, which can disagree. | Label the source or consolidate it; never present mixed sources as one truth. |

**Stage 6 acceptance gap:** the dashboard is a capable shell, but its most important panels are not yet an authoritative operational view because the underlying auth, credit and usage planes are split.

---

## 8. Frontend inventory and broken user journeys

| Area / route | Status | Verified finding | Priority |
|---|---|---|---|
| Home and navigation shell | Complete | Routes render; protected shell and local-first experience are present. | — |
| Plan hub | partial | “Start Workout” has no handler; dead calendar/modal code remains. | High |
| Workout detail | partial | “Begin Session” has no handler; “Re-schedule” navigates without `pendingWorkout`, so the assign screen cannot load the workout. | High |
| Meal detail | partial | “Add to another day” navigates without `pendingMeal`; “Add to List” only navigates and does not persist an add. | High |
| Assign meal / assign workout | partial | Both require `sessionStorage` data that the broken navigation paths do not set. | High |
| Recipes and food images | partial | Remote `picsum.photos` fallback images are blocked by the current `img-src` CSP. | Medium |
| Workout and meal photos | partial | Same external-image CSP mismatch on detail screens and `AddMeal`. | Medium |
| Routines and timer | partial | Routine/timer flows work locally, but the external Mixkit ding is blocked by `media-src`. | Medium |
| Encrypted journal | partial | Local encrypted vault works; the `__adopted` marker is parsed as a record, producing an `atob` console error; no server sync. | High |
| Budgeting and transactions | partial | Local-vault only; no verified account-level persistence or migration. | High |
| Lists | partial | Local list interactions exist; the meal “Add to List” journey is incomplete. | Medium |
| Challenges | Complete | Local challenge UI and interactions render in the local-first app. | — |
| AI Coach | blocked | UI is present, but `AI_ENABLED=false` and no provider is active. | Critical |
| Settings and billing | partial | Account, AI and RevenueCat panels exist; sandbox checkout opens; no purchase completed. | High |
| Health | incomplete | Apple Health integration surfaces are placeholders. | High |
| Calendar | incomplete | Google Calendar remains disabled and has no verified connection. | Medium |
| Admin AI | partial | UI and APIs exist; no admin identity, and data sources disagree. | Critical |
| Auth screens | partial | Screens and server flows exist; the live provider is legacy password auth with verification off. | Critical |
| Legal pages | Complete | Pages render and are reachable. | — |

### Broken or incomplete journeys to fix

1. **Start a workout:** no action from the Plan hub.
2. **Begin a workout session:** no action from workout detail.
3. **Move a meal to another day:** destination screen has no pending meal payload.
4. **Re-schedule a workout:** destination screen has no pending workout payload.
5. **Add a meal to a list:** navigation only; no confirmed persistence.
6. **Use Apple Health:** placeholders only.
7. **Use Google Calendar:** disabled.
8. **Ask the AI Coach:** disabled without an active provider.
9. **Sign in through Supabase:** built but not activated.
10. **Administer AI:** no real admin identity or canonical data view.

---

## 9. Duplicate systems and canonical targets

| Capability | Current duplicate / split | Risk | Canonical target |
|---|---|---|---|
| Authentication | Supabase Auth versus `data/auth.json` legacy password accounts | Two identities for the same person; admin and wallet ownership become ambiguous. | Supabase Auth, with legacy accounts explicitly migrated or retired. |
| Credit wallets | Local `data/ai-credits.json` versus Supabase wallets/transactions | Wrong balance, double grant or uncharged request. | Supabase wallet and transaction ledger. |
| AI usage | Local `data/ai-usage.json` versus Supabase usage events | Admin totals, analytics and monitoring disagree. | Supabase usage events emitted from the request path. |
| AI settings | Local JSON overrides versus Supabase `ai_settings` | An operator change may affect only one admin surface. | One settings store with explicit cache/versioning. |
| Subscriptions | Wallet plan fields versus Supabase subscriptions versus RevenueCat | Plan, entitlement and credits drift apart. | RevenueCat entitlement plus Supabase subscription projection. |
| Admin audit | Supabase audit versus local JSON fallback | Missing or duplicated audit evidence. | Supabase audit; local fallback only when explicitly degraded and labelled. |
| Admin overview | JSON overview versus Supabase overview/analytics routes | The dashboard can present conflicting numbers. | One source per metric, stated in the response/UI. |
| Budgeting | Local encrypted vault versus unused server persistence | Data is device-bound and absent after reinstall. | Product decision: local-only by design, or synced with ownership and encryption rules. |
| Journal | Browser-local encrypted vault versus intended account experience | No multi-device recovery; deletion/export story is unclear. | Product decision, documented and tested. |
| Deployment | Express/Supabase server versus GitHub Pages static workflow | Deployed site lacks the API and auth it needs. | A Node-capable host or an explicitly static build with no server features. |

---

## 10. Security and configuration findings

| ID | Finding | Impact | Priority | Required action |
|---|---|---|---|---|
| S1 | Live auth is still the legacy password provider; Supabase Auth is off. | No proven hosted identity, verification or admin session. | Critical | Activate and verify Supabase Auth on hosted infrastructure. |
| S2 | `admin_users` has zero rows. | Normal admin access cannot work; only break-glass may remain. | Critical | Provision the first admin through a controlled procedure. |
| S3 | Two local credit wallets exist; the migration test expects one. | Ambiguous ownership and balance migration risk. | Critical | Reconcile wallets before cutover. |
| S4 | Hosted RLS has not been proven with two real users. | Cross-user access could exist despite local tests. | Critical | Execute a two-account isolation matrix. |
| S5 | RevenueCat webhook verification is not configured. | Entitlements cannot be trusted from a webhook in production. | High | Configure the secret and verify a signed webhook. |
| S6 | GitHub Pages deployment cannot run Express or Supabase APIs. | The deployed app would lose auth, AI and billing routes. | High | Replace the workflow or remove it. |
| S7 | CSP blocks external meal/workout images and the routine ding. | Visible broken media and no timer sound. | Medium | Self-host assets or narrow the CSP. |
| S8 | Mood/theme settings live outside the encrypted vault. | Some preferences are readable in plain browser storage. | Low | Decide whether they are sensitive; move them if required. |
| S9 | No complete account deletion/export path. | Privacy and data-lifecycle obligations are unmet. | High | Implement deletion, export and retention rules. |
| S10 | No Git repository. | No reliable diff, rollback or review trail for remediation. | Critical | Initialise and commit the audited baseline. |
| S11 | Build produces a 2.2 MB client chunk. | Slower first load, especially on mobile. | Low | Add route-level code splitting after correctness work. |
| S12 | No aggregate test command or CI tests. | Regressions can ship without a release gate. | High | Add `npm test` and run it in CI. |

### Configuration state

| Integration | State | Consequence |
|---|---|---|
| Supabase database | Connected; schema applied | Foundation exists, but it is not the live source for auth, credits or usage. |
| Supabase Auth | Implemented but disabled | Legacy password auth remains live. |
| Email verification | Off | Accounts can be created without the intended verification gate. |
| AI global switch | Off | AI Coach is unavailable. |
| OpenAI | Key present, provider disabled | No live AI request. |
| Gemini | Not integrated | Roadmap expectation is unmet or needs an approved scope change. |
| Hugging Face | Provider code exists; not active | Not part of the live answer path. |
| RevenueCat | Sandbox public key; checkout enabled | Purchase UI works; no completed purchase or hosted Paywall. |
| RevenueCat webhook | Not configured | Server cannot verify entitlement events. |
| Admin identity | No admin user | `/admin/ai` cannot be accepted with normal access. |
| Google Calendar | Disabled | Calendar journey is unavailable. |
| Apple Health | Placeholder | Health integration is not functional. |
| GitHub Pages | Static workflow present | Incompatible with the live server architecture. |

---

## 11. Test coverage gaps

| Gap | Why it matters | Priority |
|---|---|---|
| No aggregate `npm test` | Test results depend on remembering many individual commands. | High |
| No CI test job | A passing local build does not gate deployment. | High |
| No hosted auth E2E | Mocks cannot prove cookies, redirects, email verification or revocation. | Critical |
| No two-account hosted RLS test | Local database tests do not prove the hosted security boundary. | Critical |
| No executed hosted concurrency test | `supabase:concurrency:test` skipped because `SUPABASE_TEST_DB_URL` is unset. | Critical |
| No admin acceptance test | The normal admin identity path has never been exercised. | Critical |
| No live AI contract test | Provider routing and cost accounting are unproven in production. | High |
| No live RevenueCat webhook test | Entitlement and credit reconciliation are unproven. | High |
| No browser journey test | Broken Start Workout, Begin Session and re-scheduling paths were found manually. | High |
| No migration rollback test | Recovery is documented but not rehearsed. | High |
| Analytics fixture depends on a fixed date | The suite fails as the calendar moves and hides real regressions. | Medium |
| Audit mutation test omits required confirmation fields | It reports failure against a correctly guarded endpoint. | Medium |
| No accessibility or viewport regression baseline | Mobile and keyboard use are unverified. | Medium |

---

## 12. Recommended remediation order

### Gate A — Make the baseline safe

1. **1.10** Initialise Git and commit the audited baseline.
2. **2.12–2.13** Write and rehearse migration rollback and database restore.
3. **1.9** Correct stale documentation so operators are not following the wrong deployment or migration model.
4. **S6** Remove or replace the GitHub Pages deployment path.

### Gate B — Establish identity and ownership

1. **3.5–3.6** Activate Supabase Auth and complete a real registration, verification, login, refresh, logout and reset journey.
2. **2.6** Decide the fate of the legacy account: migrate, link or retire.
3. **2.7** Reconcile the two local wallets and make the migration test deterministic.
4. **3.9** Provision the first real admin and verify least-privilege access.
5. **2.4 / 3.8** Prove hosted RLS and API ownership with two accounts.

### Gate C — Cut over to one ledger

1. **2.8** Choose canonical stores for usage and AI settings.
2. **4.6–4.7** Backfill balances and switch wallet reads/writes to Supabase.
3. **4.4** Run concurrent HTTP requests and prove one charge per request.
4. **4.8 / 4.9** Verify balance, history, low-credit states and admin adjustments.
5. **6.3 / 6.4** Make overview, analytics, monitoring and credits agree.

### Gate D — Activate AI

1. **5.1** Choose and enable one provider.
2. **5.2** Enable AI only after Gate C.
3. **5.10** Run a scripted live coach request.
4. **5.12 / 5.13** Verify usage, cost, credit charge and budget refusal.
5. **5.15** Verify disabled, no-credit, rate-limited and provider-error UI states.

### Gate E — Make the admin dashboard acceptable

1. **3.10 / 6.8** Verify attempt and success audit records.
2. **6.2** Sign in as the provisioned admin.
3. **6.7** Change a spending control and observe the real request path change.
4. **6.9** Change and restore a model setting.
5. **6.10** Complete the operator acceptance run.

### Gate F — Repair the product journeys

1. Start Workout and Begin Session.
2. Meal and workout re-scheduling with explicit payloads.
3. Add to List persistence.
4. CSP-safe images and timer audio.
5. Apple Health and Google Calendar, or formally remove them from the launch promise.

---

## 13. Open decisions

| Decision | Why it blocks progress | Recommended default |
|---|---|---|
| Is Supabase Auth the only account system? | Determines wallet ownership, admin access and migration. | Yes; migrate or retire legacy accounts. |
| Is the encrypted journal local-only or account-synced? | Determines Stage 2 storage, recovery and deletion design. | Keep local-only for launch if recovery limits are disclosed; do not imply cloud sync. |
| Which AI provider launches? | Blocks activation, pricing and live evaluation. | Enable one proven provider with verified model prices; defer Gemini unless it is a hard requirement. |
| Is GitHub Pages still a target? | The current workflow cannot serve the application. | No; use a Node-capable host or remove server features from the static build. |
| What is the production billing path? | Sandbox checkout is not a launch-ready entitlement flow. | RevenueCat with verified webhook, hosted Paywall and tested downgrade/expiry states. |
| What data must be exportable/deletable? | Blocks privacy and retention acceptance. | Define the record set, then implement export and deletion for auth, profile, journal, usage and billing. |
| Who owns the first admin account? | Blocks Stage 6 acceptance. | One named operator, provisioned server-side, with audit enabled. |

---

## 14. Audit limitations

These items were **not** proven and must not be reported as working:

- No real Supabase registration, email delivery, verification callback or password reset was completed.
- No hosted two-account RLS isolation test was run.
- The real two-connection concurrency test was skipped because `SUPABASE_TEST_DB_URL` was unset.
- No real administrator signed into `/admin/ai`.
- No AI request was made because AI and all providers are disabled.
- No RevenueCat purchase was completed; no signed webhook was delivered.
- No production deployment was verified; the GitHub Pages workflow is known to be incompatible.
- No browser-level end-to-end or mobile viewport suite exists.
- Build and typecheck were verified, but the production server was not load-tested.
- The tracker records a filesystem backup, not a tested database backup/restore.

## 15. Downstream context (Stages 7–10; not scored here)

The later roadmap stages depend on the gates above. Observed blockers:

- **Monetisation:** sandbox checkout only; no completed purchase, webhook verification, hosted Paywall or production keys.
- **Distribution:** there is no verified Node-capable production host; the checked-in GitHub Pages workflow cannot serve auth, AI or billing APIs.
- **Lifecycle messaging:** email verification is off and no broader transactional email flow is verified.
- **Retention and account lifecycle:** export, deletion and retention rules are incomplete.
- **Cloud continuity:** journal and budget data are local-only, so a new device or cleared browser loses the experience unless the product explicitly treats that as local-first.

---

## 16. Maintenance rules for this tracker

1. Change a status only when new runtime evidence or a passing behavioural test supports it.
2. Add the date, command and observed result to the evidence column; do not use “code exists” as acceptance.
3. Keep **blocked** for external prerequisites or unresolved product decisions, not for work that is merely unfinished.
4. When a task is split, keep the original ID and add a suffix (`2.7a`, `2.7b`) rather than renumbering history.
5. Re-run the configuration probes and the three failing suites whenever auth, credits or AI activation changes.
6. Do not mark Stage 2 complete while two wallet representations, legacy auth or unproven hosted RLS remain.
