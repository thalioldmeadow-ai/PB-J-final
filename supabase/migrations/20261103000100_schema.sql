-- Phase 1: Supabase database foundation.
-- This migration only creates the new schema. It does not change the running
-- application, its JSON ledgers, authentication, or the encrypted journal.

-- ---------------------------------------------------------------- identity

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(display_name) between 1 and 80),
  -- The old 40-hex wallet id. Kept only until the legacy wallet is claimed.
  legacy_user_id text unique
    check (legacy_user_id is null or legacy_user_id ~ '^[a-f0-9]{16,64}$'),
  age_band text
    check (age_band is null or age_band in ('adult', 'teen', 'child')),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  target_user_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------- credit rules

create table if not exists public.credit_actions (
  key text primary key
    check (key in ('simple_message', 'daily_plan', 'detailed_analysis', 'complex_task')),
  label text not null check (char_length(label) between 1 and 80),
  description text not null check (char_length(description) between 1 and 160),
  cost numeric(14, 4) not null check (cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_plans (
  id text primary key check (id in ('free', 'plus')),
  label text not null check (char_length(label) between 1 and 80),
  credits_per_period numeric(14, 4) not null check (credits_per_period >= 0),
  period_days integer not null check (period_days between 1 and 3650),
  requests_per_day integer not null check (requests_per_day between 1 and 100000),
  tokens_per_day bigint not null check (tokens_per_day between 1000 and 100000000),
  memory_limit integer not null check (memory_limit between 0 and 50),
  history_limit integer not null check (history_limit between 0 and 40),
  history_char_limit integer not null check (history_char_limit between 500 and 40000),
  max_attachments integer not null check (max_attachments between 0 and 4),
  advanced_features boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- wallets

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan text not null references public.credit_plans (id)
    on update cascade on delete restrict,
  balance numeric(14, 4) not null check (balance >= 0),
  allocated numeric(14, 4) not null check (allocated >= 0),
  period_credits_used numeric(14, 4) not null default 0
    check (period_credits_used >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  subscription_status text not null default 'active'
    check (subscription_status in ('active', 'past_due', 'canceled', 'expired', 'refunded')),
  subscription_started_at timestamptz not null default now(),
  renewal_at timestamptz not null,
  expires_at timestamptz not null,
  cancel_at_period_end boolean not null default false,
  grace_period_ends_at timestamptz,
  management_url text check (management_url is null or char_length(management_url) <= 500),
  payment_provider_ref text
    check (payment_provider_ref is null or char_length(payment_provider_ref) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  check (period_end > period_start),
  check (balance <= allocated)
);

create table if not exists public.credit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id text not null
    check (request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  action text not null references public.credit_actions (key)
    on update cascade on delete restrict,
  credits numeric(14, 4) not null check (credits >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  plan text not null references public.credit_plans (id)
    on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reservation_expires_at timestamptz not null
    default (now() + interval '10 minutes'),
  constraint credit_requests_user_request_key unique (user_id, request_id),
  check (
    (status = 'pending' and completed_at is null)
    or (status <> 'pending' and completed_at is not null)
  )
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id text,
  kind text not null
    check (kind in ('reserve', 'settle', 'refund', 'admin_adjustment', 'subscription_grant', 'legacy_import')),
  credits_delta numeric(14, 4) not null,
  balance_after numeric(14, 4) not null check (balance_after >= 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

-- ------------------------------------------------------ subscription state

create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan text not null references public.credit_plans (id)
    on update cascade on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'canceled', 'expired', 'refunded')),
  environment text not null default 'SANDBOX'
    check (environment in ('SANDBOX', 'PRODUCTION')),
  revenuecat_customer_id text
    check (revenuecat_customer_id is null or char_length(revenuecat_customer_id) <= 200),
  revenuecat_product_id text
    check (revenuecat_product_id is null or char_length(revenuecat_product_id) <= 120),
  revenuecat_entitlement_id text
    check (revenuecat_entitlement_id is null or char_length(revenuecat_entitlement_id) <= 120),
  purchased_at timestamptz,
  expires_at timestamptz,
  grace_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  management_url text check (management_url is null or char_length(management_url) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, revenuecat_customer_id)
);

create table if not exists public.billing_customer_aliases (
  alias text primary key check (char_length(alias) between 1 and 200),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null default 'revenuecat'
    check (source in ('revenuecat', 'legacy', 'manual')),
  created_at timestamptz not null default now()
);

create table if not exists public.revenuecat_events (
  event_id text primary key check (char_length(event_id) between 1 and 200),
  type text not null check (char_length(type) between 1 and 80),
  environment text not null default 'SANDBOX'
    check (environment in ('SANDBOX', 'PRODUCTION')),
  customer_id text check (customer_id is null or char_length(customer_id) <= 200),
  matched_user_id uuid references public.profiles (id) on delete set null,
  matched boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object')
);

-- ---------------------------------------------------------- usage and spend

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  provider text not null check (char_length(provider) between 1 and 80),
  model text not null check (char_length(model) between 1 and 120),
  action text not null check (char_length(action) between 1 and 80),
  plan text not null references public.credit_plans (id)
    on update cascade on delete restrict,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  credits numeric(14, 4) not null default 0 check (credits >= 0),
  cost_billing numeric(14, 6) not null default 0 check (cost_billing >= 0),
  billing_currency text not null default 'USD'
    check (billing_currency in ('USD', 'AUD')),
  cost_usd numeric(14, 6) not null default 0 check (cost_usd >= 0),
  cost_aud numeric(14, 6) not null default 0 check (cost_aud >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  status text not null default 'success' check (status in ('success', 'failed')),
  estimated_usage boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table if not exists public.ai_usage_daily (
  day date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  model text not null,
  action text not null,
  plan text not null references public.credit_plans (id)
    on update cascade on delete restrict,
  requests bigint not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  credits numeric(14, 4) not null default 0 check (credits >= 0),
  cost_usd numeric(14, 6) not null default 0 check (cost_usd >= 0),
  cost_aud numeric(14, 6) not null default 0 check (cost_aud >= 0),
  failures bigint not null default 0 check (failures >= 0),
  rate_limited bigint not null default 0 check (rate_limited >= 0),
  fallbacks bigint not null default 0 check (fallbacks >= 0),
  latency_total_ms bigint not null default 0 check (latency_total_ms >= 0),
  latency_samples bigint not null default 0 check (latency_samples >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, user_id, provider, model, action, plan)
);

create table if not exists public.ai_spend_counters (
  period_type text not null check (period_type in ('day', 'month')),
  period_key text not null check (char_length(period_key) between 7 and 10),
  scope text not null check (scope in ('global', 'user')),
  scope_id text not null check (char_length(scope_id) between 1 and 64),
  actual_aud numeric(14, 6) not null default 0 check (actual_aud >= 0),
  reserved_aud numeric(14, 6) not null default 0 check (reserved_aud >= 0),
  updated_at timestamptz not null default now(),
  primary key (period_type, period_key, scope, scope_id)
);

create table if not exists public.ai_spend_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  day_key text not null check (char_length(day_key) = 10),
  month_key text not null check (char_length(month_key) = 7),
  reserved_aud numeric(14, 6) not null default 0 check (reserved_aud >= 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'consumed', 'released', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  unique (user_id, request_id)
);

create table if not exists public.ai_safety_daily (
  day date not null,
  scope text not null check (scope in ('global', 'user')),
  scope_id text not null check (char_length(scope_id) between 1 and 64),
  moderation_events bigint not null default 0 check (moderation_events >= 0),
  blocked_requests bigint not null default 0 check (blocked_requests >= 0),
  reported_responses bigint not null default 0 check (reported_responses >= 0),
  errors bigint not null default 0 check (errors >= 0),
  by_flag jsonb not null default '{}'::jsonb
    check (jsonb_typeof(by_flag) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (day, scope, scope_id)
);

-- --------------------------------------------------------- admin settings

create table if not exists public.ai_settings (
  id smallint primary key default 1 check (id = 1),
  overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(overrides) = 'object'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------- encrypted application data

create table if not exists public.vault_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  collection text not null check (char_length(collection) between 1 and 120),
  record_id text not null check (char_length(record_id) between 1 and 200),
  ciphertext text not null check (char_length(ciphertext) > 0),
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, collection, record_id)
);

-- -------------------------------------------------------------- indexes

create index if not exists profiles_legacy_user_id_idx
  on public.profiles (legacy_user_id);

create index if not exists admin_audit_log_admin_created_idx
  on public.admin_audit_log (admin_user_id, created_at desc);

create index if not exists admin_audit_log_target_created_idx
  on public.admin_audit_log (target_user_id, created_at desc);

create index if not exists wallets_plan_idx
  on public.wallets (plan);

create index if not exists credit_requests_user_created_idx
  on public.credit_requests (user_id, created_at desc);

create index if not exists credit_requests_pending_expiry_idx
  on public.credit_requests (reservation_expires_at)
  where status = 'pending';

create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);

create index if not exists credit_transactions_request_idx
  on public.credit_transactions (request_id);

create index if not exists subscriptions_customer_idx
  on public.subscriptions (environment, revenuecat_customer_id);

create index if not exists billing_customer_aliases_user_idx
  on public.billing_customer_aliases (user_id);

create index if not exists revenuecat_events_customer_received_idx
  on public.revenuecat_events (customer_id, received_at desc);

create index if not exists ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);

create index if not exists ai_usage_events_created_idx
  on public.ai_usage_events (created_at desc);

create index if not exists ai_usage_daily_user_day_idx
  on public.ai_usage_daily (user_id, day desc);

create index if not exists ai_spend_reservations_expiry_idx
  on public.ai_spend_reservations (expires_at)
  where status = 'reserved';

create index if not exists vault_records_user_collection_idx
  on public.vault_records (user_id, collection, updated_at desc);

create index if not exists vault_records_client_updated_idx
  on public.vault_records (user_id, client_updated_at desc);
