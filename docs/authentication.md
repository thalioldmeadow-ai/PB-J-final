# Authentication and account creation

## Current model

Supabase Auth is the account provider only when `SUPABASE_AUTH_ENABLED=true` and
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are configured. With
the credentials present but the flag false, the app stays on the legacy account path for
the staged connection. The live encrypted journal is unchanged and still uses the
browser-local vault password.

The browser never receives a Supabase access token or refresh token. It sends email and
password only to this app's own `/api/auth/*` routes. The server calls Supabase Auth and
sets an encrypted, `HttpOnly`, `SameSite=Strict` `serene_session` cookie. In production
the cookie is also `Secure`.

The server-side session contains the Supabase user id plus the access and refresh tokens,
encrypted with AES-256-GCM using a key derived from the server-only service-role key. A
small `data/supabase-sessions.json` file records logout revocations and per-user cut-off
times; it never contains passwords or journal data and is mode `0600`.

## Registration

`POST /api/auth/register` accepts only:

- display name
- email
- password
- `acceptedTerms: true`

It ignores any `userId`, `plan`, `balance`, `credits`, `subscriptionStatus` or admin field.
The server validates the email, an 8-character minimum password and the terms flag, then
calls Supabase Auth signup with `data.display_name`.

The existing `auth.users` trigger calls `create_profile_and_wallet`. The server also calls
that idempotent RPC after signup, login and verification as a safety net. A new user gets:

- one `public.profiles` row;
- one `public.wallets` row on the Free plan with the seeded 100-credit daily allocation;
- one `public.subscriptions` row with plan `free`, status `active`, environment `SANDBOX`,
  and no RevenueCat customer/product reference.

The wallet primary key is `user_id`; `ensure_wallet` uses `insert ... on conflict do
nothing`. Repeated registration, login, refresh or page loads cannot mint another wallet
or another credit allocation.

Unverified accounts cannot log in and therefore cannot obtain a session cookie. The server
checks Supabase's `email_confirmed_at` on login, verification and refresh, not a browser
flag or user-editable metadata.

## Email verification

Supabase's confirmation email must point at the server callback with the token hash, not
at the default `{{ .ConfirmationURL }}` (whose session arrives in a URL fragment).

In Supabase Dashboard → Authentication → Email Templates → Confirm signup, use a link like:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup">
  Verify my email
</a>
```

The server receives `GET /api/auth/callback?token_hash=...&type=signup`, exchanges the
token on the server, sets the session cookie, and redirects to
`/#/auth/verified?status=success`.

Invalid, expired, replayed or already-used links redirect to the failure state with a
generic reason. That page can resend the verification email. Opening the link on another
device verifies the Supabase account on that device; the encrypted journal still has to be
unlocked on the original device because it never leaves that browser.

`POST /api/auth/resend-verification` returns the same generic response whether or not an
account exists.

## Login and sessions

`POST /api/auth/login` validates credentials through Supabase Auth. A session is issued
only when the email is confirmed. Invalid credentials, unknown email and wrong password
share one generic response.

The encrypted cookie is refreshed automatically when its access token is within two
minutes of expiry. Refresh failure, logout or a revoked session clears the cookie. A page
reload keeps the browser session; closing the tab still locks the local vault because the
unlocked AES key lives in `sessionStorage`.

Logout calls Supabase and records a server-side revocation, so a copied old cookie is
rejected rather than merely being cleared in the current browser.

## Password reset

`POST /api/auth/forgot-password` calls Supabase recover and always returns the same message,
so it does not reveal whether an email has an account.

In Supabase Dashboard → Authentication → Email Templates → Reset password, use:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">
  Reset my account password
</a>
```

The server callback exchanges the recovery token and sets a separate short-lived,
encrypted, HttpOnly `serene_reset` cookie, then redirects to `/#/auth/reset?status=ready`.
`POST /api/auth/reset-password` updates the Supabase password and revokes existing
sessions. It does not receive, derive or change the local journal key.

**Journal password warning:** the Supabase account password and the local journal password
are separate locks. If a person resets the account password, entries already encrypted on
this device are still encrypted with the old journal password. The sign-in flow detects
that mismatch and asks for the previous journal password instead of replacing or deleting
the vault. Resetting the account password cannot recover a forgotten journal password.

## Existing local users

Existing browser-local vaults are preserved. The local account id, salt, encrypted check
value and every `serene.vault.v1.*` record are untouched, and the completed onboarding
marker is copied to the Supabase user id after the first successful account login.

A local-only account has no Supabase identity, so it cannot sign in until the person
creates a Supabase account with the same email (preferably using the same password as the
local journal). The Supabase account is not linked automatically to a legacy wallet or
journal without proof of ownership. Legacy wallet claiming remains a separate, explicit
endpoint and is not triggered by registration.

## Manual Supabase configuration

1. Apply the six migrations with `npx supabase db push`.
2. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`
   and `SUPABASE_AUTH_ENABLED=true` on the server. Never expose the service-role key to
   the browser. Leave the flag false while only testing the connection.
3. In Authentication → URL Configuration:
   - set the Site URL to the app origin;
   - add `<APP_ORIGIN>/api/auth/callback` to the redirect allow list;
   - add the localhost and preview callback URLs if those environments are used.
4. Keep “Confirm email” enabled. Configure custom SMTP for production; Supabase's default
   email service is rate-limited and intended for testing.
5. Replace the Confirm signup and Reset password templates with the token-hash links above.
6. Keep the server's `NODE_ENV=production` in production so cookies receive `Secure`.

## Development fallback

If the three Supabase server values are absent, `/api/auth/config` reports
`provider: "password"` and the pre-migration JSON account store in `data/auth.json` is
used. That path exists only so the old app can still run during migration. It does not send
verification email. Once Supabase is configured, the legacy session cookie is not accepted
by the app's account or AI routes.

## Verification status

The Supabase HTTP adapter is tested against a mocked Supabase boundary in
`npm run auth:supabase:test`; the database trigger, wallet, subscription and RLS behaviour
is tested against embedded PostgreSQL in `npm run supabase:test` and
`npm run security:test`. No hosted Supabase project has been contacted yet, so real email
delivery, real Supabase redirect validation and hosted role differences remain to be
verified during staging.
