-- Phase 1 database functions.
--
-- Security model:
--   * Financial functions are server-only. They are SECURITY DEFINER so the
--     service-role server can perform the write, but execute is revoked from
--     anon/authenticated. The browser never calls these directly.
--   * Wallet rows are locked FOR UPDATE before a balance changes.
--   * Idempotency is enforced by unique keys as well as by the functions.
--   * No function stores prompts, replies, journal text, or provider keys.

-- ------------------------------------------------------------ generic helpers

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- User-callable check: only answers for the caller's own identity. This avoids
-- leaking whether another account is an administrator.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    exists (select 1 from public.admin_users where user_id = auth.uid()),
    false
  );
$$;

-- Server-only check for an explicit user. The service role uses this after it
-- has authenticated the request; it is not executable by normal users.
create or replace function public.is_admin_for(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    exists (select 1 from public.admin_users where user_id = p_user_id),
    false
  );
$$;

-- --------------------------------------------------------- wallet lifecycle

/**
 * Apply the same period and subscription reconciliation the JSON ledger does:
 * an expired Plus subscription falls back to Free, and an elapsed period resets
 * to the current plan's allocation. The wallet row is the lock for the whole
 * operation.
 */
create or replace function public.refresh_wallet_period(p_user_id uuid)
returns public.wallets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_plan public.credit_plans%rowtype;
  v_free public.credit_plans%rowtype;
  v_now timestamptz := now();
  v_period_open boolean;
  v_grace_open boolean;
  v_should_expire boolean;
  v_free_status text;
begin
  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet_not_found' using errcode = 'P0001';
  end if;

  if v_wallet.plan = 'plus' then
    v_period_open := v_wallet.expires_at > v_now;
    v_grace_open := v_wallet.grace_period_ends_at is not null
      and v_wallet.grace_period_ends_at > v_now;
    v_should_expire :=
      v_wallet.subscription_status in ('expired', 'refunded')
      or (v_wallet.subscription_status = 'active' and not v_period_open)
      or (v_wallet.subscription_status = 'past_due' and not v_period_open and not v_grace_open)
      or (
        v_wallet.subscription_status = 'canceled'
        and (
          not v_wallet.cancel_at_period_end
          or (not v_period_open and not v_grace_open)
        )
      );

    if v_should_expire then
      select * into v_free from public.credit_plans where id = 'free';
      if not found then
        raise exception 'free_plan_not_configured' using errcode = 'P0001';
      end if;
      v_free_status := case
        when v_wallet.subscription_status = 'refunded' then 'refunded'
        else 'expired'
      end;

      update public.wallets
      set plan = 'free',
          balance = v_free.credits_per_period,
          allocated = v_free.credits_per_period,
          period_credits_used = 0,
          period_start = v_now,
          period_end = v_now + make_interval(days => v_free.period_days),
          subscription_status = v_free_status,
          renewal_at = v_now + make_interval(days => v_free.period_days),
          expires_at = v_now + make_interval(days => v_free.period_days),
          cancel_at_period_end = false,
          grace_period_ends_at = null,
          updated_at = v_now
      where user_id = p_user_id
      returning * into v_wallet;
    end if;
  end if;

  if v_wallet.period_end <= v_now then
    select * into v_plan from public.credit_plans where id = v_wallet.plan;
    if not found then
      raise exception 'credit_plan_not_configured' using errcode = 'P0001';
    end if;

    update public.wallets
    set balance = v_plan.credits_per_period,
        allocated = v_plan.credits_per_period,
        period_credits_used = 0,
        period_start = v_now,
        period_end = v_now + make_interval(days => v_plan.period_days),
        renewal_at = v_now + make_interval(days => v_plan.period_days),
        expires_at = v_now + make_interval(days => v_plan.period_days),
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_wallet;
  end if;

  return v_wallet;
end;
$$;

/**
 * Idempotent wallet creation. The profile must already exist (the auth trigger
 * creates it), and the Free plan must be seeded.
 */
create or replace function public.ensure_wallet(p_user_id uuid)
returns public.wallets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_free public.credit_plans%rowtype;
  v_wallet public.wallets%rowtype;
begin
  select id into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;

  select * into v_free from public.credit_plans where id = 'free';
  if not found then
    raise exception 'free_plan_not_configured' using errcode = 'P0001';
  end if;

  insert into public.wallets (
    user_id, plan, balance, allocated, period_credits_used,
    period_start, period_end, subscription_status, subscription_started_at,
    renewal_at, expires_at
  )
  values (
    p_user_id, 'free', v_free.credits_per_period, v_free.credits_per_period, 0,
    now(), now() + make_interval(days => v_free.period_days), 'active', now(),
    now() + make_interval(days => v_free.period_days),
    now() + make_interval(days => v_free.period_days)
  )
  on conflict (user_id) do nothing;

  insert into public.subscriptions (
    user_id, plan, status, environment, purchased_at, expires_at
  )
  values (
    p_user_id, 'free', 'active', 'SANDBOX', now(),
    now() + make_interval(days => v_free.period_days)
  )
  on conflict (user_id) do nothing;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet_creation_failed' using errcode = 'P0001';
  end if;

  return public.refresh_wallet_period(p_user_id);
end;
$$;

create or replace function public.create_profile_and_wallet(
  p_user_id uuid,
  p_display_name text,
  p_age_band text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_age text;
begin
  v_name := left(
    coalesce(nullif(btrim(p_display_name), ''), 'Member'),
    80
  );
  if char_length(v_name) = 0 then
    v_name := 'Member';
  end if;

  v_age := case
    when p_age_band in ('adult', 'teen', 'child') then p_age_band
    else null
  end;

  insert into public.profiles (id, display_name, age_band)
  values (p_user_id, v_name, v_age)
  on conflict (id) do nothing;

  perform public.ensure_wallet(p_user_id);
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_age text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Member'
  );
  v_age := new.raw_user_meta_data ->> 'age_band';

  perform public.create_profile_and_wallet(new.id, v_name, v_age);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing Supabase Auth users get a profile and wallet too. This is safe to
-- rerun: both inserts are idempotent.
do $$
declare
  r record;
  v_name text;
  v_age text;
begin
  for r in select id, email, raw_user_meta_data from auth.users loop
    v_name := coalesce(
      nullif(btrim(r.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(r.email, ''), '@', 1), ''),
      'Member'
    );
    v_age := r.raw_user_meta_data ->> 'age_band';
    perform public.create_profile_and_wallet(r.id, v_name, v_age);
  end loop;
end;
$$;

-- --------------------------------------------------------------- credit ops

create or replace function public.reserve_credits(
  p_user_id uuid,
  p_request_id text,
  p_action text
)
returns table (
  request_id text,
  credits numeric,
  status text,
  balance numeric,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_wallet public.wallets%rowtype;
  v_existing public.credit_requests%rowtype;
  v_action public.credit_actions%rowtype;
  v_request_pk uuid;
  v_now timestamptz := now();
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'bad_request_id' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.credit_requests
  where user_id = p_user_id and credit_requests.request_id = p_request_id
  for update;

  if found then
    return query
      select v_existing.request_id, v_existing.credits, v_existing.status,
             (select w.balance from public.wallets w where w.user_id = p_user_id),
             true;
    return;
  end if;

  select * into v_action from public.credit_actions where key = p_action;
  if not found then
    raise exception 'unknown_credit_action' using errcode = 'P0001';
  end if;

  select * into v_wallet from public.refresh_wallet_period(p_user_id);

  if v_wallet.balance < v_action.cost then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into public.credit_requests (
    user_id, request_id, action, credits, status, plan, created_at,
    reservation_expires_at
  )
  values (
    p_user_id, p_request_id, p_action, v_action.cost, 'pending', v_wallet.plan,
    v_now, v_now + interval '10 minutes'
  )
  on conflict on constraint credit_requests_user_request_key do nothing
  returning id into v_request_pk;

  if v_request_pk is null then
    select * into v_existing
    from public.credit_requests
    where user_id = p_user_id and credit_requests.request_id = p_request_id
    for update;
    return query
      select v_existing.request_id, v_existing.credits, v_existing.status,
             v_wallet.balance, true;
    return;
  end if;

  update public.wallets
  set balance = balance - v_action.cost,
      period_credits_used = period_credits_used + v_action.cost,
      last_used_at = v_now,
      updated_at = v_now
  where user_id = p_user_id
  returning * into v_wallet;

  insert into public.credit_transactions (
    user_id, request_id, kind, credits_delta, balance_after, idempotency_key
  )
  values (
    p_user_id, p_request_id, 'reserve', -v_action.cost, v_wallet.balance,
    p_request_id || ':reserve'
  )
  on conflict (user_id, idempotency_key) do nothing;

  return query
    select p_request_id, v_action.cost, 'pending'::text, v_wallet.balance, false;
end;
$$;

create or replace function public.settle_credits(
  p_user_id uuid,
  p_request_id text
)
returns table (
  request_id text,
  status text,
  balance numeric,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_request public.credit_requests%rowtype;
  v_wallet public.wallets%rowtype;
  v_now timestamptz := now();
begin
  select * into v_request
  from public.credit_requests
  where user_id = p_user_id and credit_requests.request_id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if v_request.status = 'failed' then
    raise exception 'request_failed' using errcode = 'P0001';
  end if;

  if v_request.status = 'succeeded' then
    return query select p_request_id, 'succeeded'::text, v_wallet.balance, true;
    return;
  end if;

  update public.credit_requests
  set status = 'succeeded', completed_at = v_now
  where id = v_request.id
  returning * into v_request;

  update public.wallets
  set updated_at = v_now, last_used_at = v_now
  where user_id = p_user_id
  returning * into v_wallet;

  insert into public.credit_transactions (
    user_id, request_id, kind, credits_delta, balance_after, idempotency_key
  )
  values (
    p_user_id, p_request_id, 'settle', 0, v_wallet.balance,
    p_request_id || ':settle'
  )
  on conflict (user_id, idempotency_key) do nothing;

  return query select p_request_id, 'succeeded'::text, v_wallet.balance, false;
end;
$$;

create or replace function public.refund_credits(
  p_user_id uuid,
  p_request_id text
)
returns table (
  request_id text,
  status text,
  balance numeric,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_request public.credit_requests%rowtype;
  v_wallet public.wallets%rowtype;
  v_now timestamptz := now();
begin
  select * into v_request
  from public.credit_requests
  where user_id = p_user_id and credit_requests.request_id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if v_request.status = 'succeeded' then
    raise exception 'request_already_settled' using errcode = 'P0001';
  end if;

  if v_request.status = 'failed' then
    return query select p_request_id, 'failed'::text, v_wallet.balance, true;
    return;
  end if;

  update public.wallets
  set balance = least(allocated, balance + v_request.credits),
      period_credits_used = greatest(0, period_credits_used - v_request.credits),
      updated_at = v_now
  where user_id = p_user_id
  returning * into v_wallet;

  update public.credit_requests
  set status = 'failed', completed_at = v_now
  where id = v_request.id
  returning * into v_request;

  insert into public.credit_transactions (
    user_id, request_id, kind, credits_delta, balance_after, idempotency_key
  )
  values (
    p_user_id, p_request_id, 'refund', v_request.credits, v_wallet.balance,
    p_request_id || ':refund'
  )
  on conflict (user_id, idempotency_key) do nothing;

  return query select p_request_id, 'failed'::text, v_wallet.balance, false;
end;
$$;

-- ---------------------------------------------------------- AI spend budget

create or replace function public.ensure_spend_counter(
  p_period_type text,
  p_period_key text,
  p_scope text,
  p_scope_id text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.ai_spend_counters (
    period_type, period_key, scope, scope_id
  )
  values (p_period_type, p_period_key, p_scope, p_scope_id)
  on conflict (period_type, period_key, scope, scope_id) do nothing;
$$;

/**
 * Reserve a maximum provider cost before the call. Limits are passed by the
 * server from the same configuration the AI layer already uses. A null or
 * non-positive limit means "not configured" for that dimension, matching the
 * existing UI where 0 means no budget ceiling.
 */
create or replace function public.reserve_ai_spend(
  p_user_id uuid,
  p_request_id text,
  p_max_cost_aud numeric,
  p_daily_limit_aud numeric default null,
  p_monthly_limit_aud numeric default null,
  p_global_daily_limit_aud numeric default null,
  p_global_monthly_limit_aud numeric default null
)
returns table (
  reserved_aud numeric,
  status text,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_existing public.ai_spend_reservations%rowtype;
  v_day text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_user_day_actual numeric;
  v_user_day_reserved numeric;
  v_user_month_actual numeric;
  v_user_month_reserved numeric;
  v_global_day_actual numeric;
  v_global_day_reserved numeric;
  v_global_month_actual numeric;
  v_global_month_reserved numeric;
  v_reservation_id uuid;
  v_cost numeric := coalesce(p_max_cost_aud, 0);
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'bad_request_id' using errcode = 'P0001';
  end if;
  if v_cost < 0 then
    raise exception 'bad_spend_amount' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.ai_spend_reservations
  where user_id = p_user_id and ai_spend_reservations.request_id = p_request_id
  for update;

  if found then
    return query select v_existing.reserved_aud, v_existing.status, true;
    return;
  end if;

  perform public.ensure_spend_counter('day', v_day, 'global', 'global');
  perform public.ensure_spend_counter('month', v_month, 'global', 'global');
  perform public.ensure_spend_counter('day', v_day, 'user', p_user_id::text);
  perform public.ensure_spend_counter('month', v_month, 'user', p_user_id::text);

  select actual_aud, reserved_aud into v_global_day_actual, v_global_day_reserved
  from public.ai_spend_counters
  where period_type = 'day' and period_key = v_day
    and scope = 'global' and scope_id = 'global'
  for update;

  select actual_aud, reserved_aud into v_global_month_actual, v_global_month_reserved
  from public.ai_spend_counters
  where period_type = 'month' and period_key = v_month
    and scope = 'global' and scope_id = 'global'
  for update;

  select actual_aud, reserved_aud into v_user_day_actual, v_user_day_reserved
  from public.ai_spend_counters
  where period_type = 'day' and period_key = v_day
    and scope = 'user' and scope_id = p_user_id::text
  for update;

  select actual_aud, reserved_aud into v_user_month_actual, v_user_month_reserved
  from public.ai_spend_counters
  where period_type = 'month' and period_key = v_month
    and scope = 'user' and scope_id = p_user_id::text
  for update;

  if p_daily_limit_aud is not null and p_daily_limit_aud > 0
     and v_user_day_actual + v_user_day_reserved + v_cost > p_daily_limit_aud then
    raise exception 'ai_daily_budget_exceeded' using errcode = 'P0001';
  end if;
  if p_monthly_limit_aud is not null and p_monthly_limit_aud > 0
     and v_user_month_actual + v_user_month_reserved + v_cost > p_monthly_limit_aud then
    raise exception 'ai_monthly_budget_exceeded' using errcode = 'P0001';
  end if;
  if p_global_daily_limit_aud is not null and p_global_daily_limit_aud > 0
     and v_global_day_actual + v_global_day_reserved + v_cost > p_global_daily_limit_aud then
    raise exception 'ai_global_daily_budget_exceeded' using errcode = 'P0001';
  end if;
  if p_global_monthly_limit_aud is not null and p_global_monthly_limit_aud > 0
     and v_global_month_actual + v_global_month_reserved + v_cost > p_global_monthly_limit_aud then
    raise exception 'ai_global_monthly_budget_exceeded' using errcode = 'P0001';
  end if;

  insert into public.ai_spend_reservations (
    user_id, request_id, day_key, month_key, reserved_aud
  )
  values (p_user_id, p_request_id, v_day, v_month, v_cost)
  on conflict (user_id, request_id) do nothing
  returning id into v_reservation_id;

  if v_reservation_id is null then
    select * into v_existing
    from public.ai_spend_reservations
    where user_id = p_user_id and ai_spend_reservations.request_id = p_request_id
    for update;
    return query select v_existing.reserved_aud, v_existing.status, true;
    return;
  end if;

  update public.ai_spend_counters
  set reserved_aud = reserved_aud + v_cost, updated_at = now()
  where period_type = 'day' and period_key = v_day
    and scope = 'global' and scope_id = 'global';

  update public.ai_spend_counters
  set reserved_aud = reserved_aud + v_cost, updated_at = now()
  where period_type = 'month' and period_key = v_month
    and scope = 'global' and scope_id = 'global';

  update public.ai_spend_counters
  set reserved_aud = reserved_aud + v_cost, updated_at = now()
  where period_type = 'day' and period_key = v_day
    and scope = 'user' and scope_id = p_user_id::text;

  update public.ai_spend_counters
  set reserved_aud = reserved_aud + v_cost, updated_at = now()
  where period_type = 'month' and period_key = v_month
    and scope = 'user' and scope_id = p_user_id::text;

  return query select v_cost, 'reserved'::text, false;
end;
$$;

create or replace function public.release_ai_spend(
  p_user_id uuid,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res public.ai_spend_reservations%rowtype;
begin
  select * into v_res
  from public.ai_spend_reservations
  where user_id = p_user_id and ai_spend_reservations.request_id = p_request_id
  for update;

  if not found or v_res.status <> 'reserved' then
    return false;
  end if;

  update public.ai_spend_counters
  set reserved_aud = greatest(0, reserved_aud - v_res.reserved_aud), updated_at = now()
  where period_type = 'day' and period_key = v_res.day_key
    and scope = 'global' and scope_id = 'global';

  update public.ai_spend_counters
  set reserved_aud = greatest(0, reserved_aud - v_res.reserved_aud), updated_at = now()
  where period_type = 'month' and period_key = v_res.month_key
    and scope = 'global' and scope_id = 'global';

  update public.ai_spend_counters
  set reserved_aud = greatest(0, reserved_aud - v_res.reserved_aud), updated_at = now()
  where period_type = 'day' and period_key = v_res.day_key
    and scope = 'user' and scope_id = p_user_id::text;

  update public.ai_spend_counters
  set reserved_aud = greatest(0, reserved_aud - v_res.reserved_aud), updated_at = now()
  where period_type = 'month' and period_key = v_res.month_key
    and scope = 'user' and scope_id = p_user_id::text;

  update public.ai_spend_reservations
  set status = 'released'
  where id = v_res.id;

  return true;
end;
$$;

-- --------------------------------------------------------- usage recording

create or replace function public.record_ai_usage(
  p_user_id uuid,
  p_request_id text,
  p_provider text,
  p_model text,
  p_action text,
  p_plan text,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0,
  p_credits numeric default 0,
  p_cost_billing numeric default 0,
  p_billing_currency text default 'USD',
  p_cost_usd numeric default 0,
  p_cost_aud numeric default 0,
  p_duration_ms integer default 0,
  p_status text default 'success',
  p_estimated_usage boolean default false,
  p_created_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_existing uuid;
  v_res public.ai_spend_reservations%rowtype;
  v_day date := (coalesce(p_created_at, now()) at time zone 'utc')::date;
  v_day_key text := to_char(coalesce(p_created_at, now()) at time zone 'utc', 'YYYY-MM-DD');
  v_month_key text := to_char(coalesce(p_created_at, now()) at time zone 'utc', 'YYYY-MM');
begin
  if p_status not in ('success', 'failed') then
    raise exception 'bad_usage_status' using errcode = 'P0001';
  end if;

  select id into v_existing
  from public.ai_usage_events
  where user_id = p_user_id and ai_usage_events.request_id = p_request_id;

  if found then
    return v_existing;
  end if;

  insert into public.ai_usage_events (
    user_id, request_id, provider, model, action, plan,
    input_tokens, output_tokens, credits, cost_billing, billing_currency,
    cost_usd, cost_aud, duration_ms, status, estimated_usage, created_at
  )
  values (
    p_user_id, p_request_id, p_provider, p_model, p_action, p_plan,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_credits, 0), coalesce(p_cost_billing, 0),
    coalesce(p_billing_currency, 'USD'), coalesce(p_cost_usd, 0),
    coalesce(p_cost_aud, 0), coalesce(p_duration_ms, 0), p_status,
    coalesce(p_estimated_usage, false), coalesce(p_created_at, now())
  )
  on conflict (user_id, request_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_existing
    from public.ai_usage_events
    where user_id = p_user_id and ai_usage_events.request_id = p_request_id;
    return v_existing;
  end if;

  insert into public.ai_usage_daily (
    day, user_id, provider, model, action, plan, requests,
    input_tokens, output_tokens, credits, cost_usd, cost_aud,
    failures, latency_total_ms, latency_samples
  )
  values (
    v_day, p_user_id, p_provider, p_model, p_action, p_plan, 1,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_credits, 0), coalesce(p_cost_usd, 0), coalesce(p_cost_aud, 0),
    case when p_status = 'failed' then 1 else 0 end,
    coalesce(p_duration_ms, 0), 1
  )
  on conflict (day, user_id, provider, model, action, plan) do update
  set requests = public.ai_usage_daily.requests + 1,
      input_tokens = public.ai_usage_daily.input_tokens + excluded.input_tokens,
      output_tokens = public.ai_usage_daily.output_tokens + excluded.output_tokens,
      credits = public.ai_usage_daily.credits + excluded.credits,
      cost_usd = public.ai_usage_daily.cost_usd + excluded.cost_usd,
      cost_aud = public.ai_usage_daily.cost_aud + excluded.cost_aud,
      failures = public.ai_usage_daily.failures + excluded.failures,
      latency_total_ms = public.ai_usage_daily.latency_total_ms + excluded.latency_total_ms,
      latency_samples = public.ai_usage_daily.latency_samples + 1,
      updated_at = now();

  perform public.ensure_spend_counter('day', v_day_key, 'global', 'global');
  perform public.ensure_spend_counter('month', v_month_key, 'global', 'global');
  perform public.ensure_spend_counter('day', v_day_key, 'user', p_user_id::text);
  perform public.ensure_spend_counter('month', v_month_key, 'user', p_user_id::text);

  select * into v_res
  from public.ai_spend_reservations
  where user_id = p_user_id and ai_spend_reservations.request_id = p_request_id
  for update;

  if found and v_res.status = 'reserved' then
    update public.ai_spend_counters
    set reserved_aud = greatest(0, reserved_aud - v_res.reserved_aud), updated_at = now()
    where period_type = 'day' and period_key = v_res.day_key
      and scope = 'global' and scope_id = 'global';
    update public.ai_spend_counters
    set reserved_aud = greatest(0, reserved_aud - v_res.reserved_aud), updated_at = now()
    where period_type = 'month' and period_key = v_res.month_key
      and scope = 'global' and scope_id = 'global';
    update public.ai_spend_counters
    set reserved_aud = greatest(0, reserved_aud - v_res.reserved_aud), updated_at = now()
    where period_type = 'day' and period_key = v_res.day_key
      and scope = 'user' and scope_id = p_user_id::text;
    update public.ai_spend_counters
    set reserved_aud = greatest(0, reserved_aud - v_res.reserved_aud), updated_at = now()
    where period_type = 'month' and period_key = v_res.month_key
      and scope = 'user' and scope_id = p_user_id::text;

    update public.ai_spend_reservations
    set status = 'consumed'
    where id = v_res.id;
  end if;

  update public.ai_spend_counters
  set actual_aud = actual_aud + coalesce(p_cost_aud, 0), updated_at = now()
  where period_type = 'day' and period_key = v_day_key
    and scope = 'global' and scope_id = 'global';
  update public.ai_spend_counters
  set actual_aud = actual_aud + coalesce(p_cost_aud, 0), updated_at = now()
  where period_type = 'month' and period_key = v_month_key
    and scope = 'global' and scope_id = 'global';
  update public.ai_spend_counters
  set actual_aud = actual_aud + coalesce(p_cost_aud, 0), updated_at = now()
  where period_type = 'day' and period_key = v_day_key
    and scope = 'user' and scope_id = p_user_id::text;
  update public.ai_spend_counters
  set actual_aud = actual_aud + coalesce(p_cost_aud, 0), updated_at = now()
  where period_type = 'month' and period_key = v_month_key
    and scope = 'user' and scope_id = p_user_id::text;

  return v_event_id;
end;
$$;

-- ------------------------------------------------------ RevenueCat webhook

/**
 * Apply one already-authenticated RevenueCat event. The event id is inserted
 * first, so a retry returns the stored result instead of granting twice.
 *
 * This function deliberately does not fetch RevenueCat or validate its
 * signature; the existing Express adapter still owns that network work.
 */
create or replace function public.apply_revenuecat_event(
  p_event_id text,
  p_event_type text,
  p_customer_id text,
  p_app_user_ids text[],
  p_plan text,
  p_status text,
  p_environment text default 'SANDBOX',
  p_product_id text default null,
  p_entitlement_id text default null,
  p_purchased_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_grace_period_ends_at timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_management_url text default null,
  p_reset_credits boolean default false,
  p_received_at timestamptz default now(),
  p_payload jsonb default '{}'::jsonb
)
returns table (
  matched boolean,
  duplicate boolean,
  user_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_event public.revenuecat_events%rowtype;
  v_user_id uuid;
  v_wallet public.wallets%rowtype;
  v_plan public.credit_plans%rowtype;
  v_free public.credit_plans%rowtype;
  v_ids text[];
  v_now timestamptz := coalesce(p_received_at, now());
  v_end timestamptz;
  v_grant_plus boolean;
  v_period_open boolean;
  v_grace_open boolean;
  v_final_plan text;
  v_final_status text;
begin
  if p_event_id is null or char_length(p_event_id) = 0 then
    raise exception 'bad_event_id' using errcode = 'P0001';
  end if;
  if p_plan not in ('free', 'plus') then
    raise exception 'bad_plan' using errcode = 'P0001';
  end if;
  if p_status not in ('active', 'past_due', 'canceled', 'expired', 'refunded') then
    raise exception 'bad_subscription_status' using errcode = 'P0001';
  end if;
  if p_environment not in ('SANDBOX', 'PRODUCTION') then
    raise exception 'bad_billing_environment' using errcode = 'P0001';
  end if;

  insert into public.revenuecat_events (
    event_id, type, environment, customer_id, matched, received_at, payload
  )
  values (
    left(p_event_id, 200), left(coalesce(p_event_type, 'UNKNOWN'), 80),
    p_environment, left(p_customer_id, 200), false, v_now,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (event_id) do nothing
  returning * into v_event;

  if v_event.event_id is null then
    select * into v_event
    from public.revenuecat_events
    where event_id = left(p_event_id, 200);
    return query select v_event.matched, true, v_event.matched_user_id;
    return;
  end if;

  v_ids := array(
    select distinct btrim(value)
    from unnest(
      array_append(coalesce(p_app_user_ids, '{}'::text[]), p_customer_id)
    ) as value
    where value is not null
      and btrim(value) <> ''
      and char_length(btrim(value)) <= 200
  );

  select p.id into v_user_id
  from public.profiles p
  left join public.subscriptions s on s.user_id = p.id
  where (p.legacy_user_id = any(v_ids))
     or (s.revenuecat_customer_id = any(v_ids))
     or exists (
       select 1 from public.billing_customer_aliases b
       where b.user_id = p.id and b.alias = any(v_ids)
     )
  order by p.id
  limit 1;

  if v_user_id is null then
    update public.revenuecat_events
    set matched = false, processed_at = v_now
    where event_id = v_event.event_id;
    return query select false, false, null::uuid;
    return;
  end if;

  insert into public.billing_customer_aliases (alias, user_id, source)
  select value, v_user_id, 'revenuecat'
  from unnest(v_ids) as value
  on conflict (alias) do nothing;

  select * into v_wallet
  from public.wallets
  where user_id = v_user_id
  for update;

  if not found then
    perform public.ensure_wallet(v_user_id);
    select * into v_wallet
    from public.wallets
    where user_id = v_user_id
    for update;
  end if;

  v_period_open := p_expires_at is null or p_expires_at > v_now;
  v_grace_open := p_grace_period_ends_at is not null and p_grace_period_ends_at > v_now;
  v_grant_plus := p_plan = 'plus'
    and p_status not in ('expired', 'refunded')
    and (
      v_period_open
      or (p_status = 'past_due' and v_grace_open)
    );

  if v_grant_plus then
    select * into v_plan from public.credit_plans where id = 'plus';
    if not found then
      raise exception 'plus_plan_not_configured' using errcode = 'P0001';
    end if;
    v_end := coalesce(p_expires_at, v_now + make_interval(days => v_plan.period_days));

    update public.wallets
    set plan = 'plus',
        subscription_status = p_status,
        subscription_started_at = coalesce(p_purchased_at, subscription_started_at),
        renewal_at = v_end,
        expires_at = v_end,
        cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
        grace_period_ends_at = p_grace_period_ends_at,
        management_url = coalesce(p_management_url, management_url),
        balance = case when p_reset_credits then v_plan.credits_per_period else balance end,
        allocated = case when p_reset_credits then v_plan.credits_per_period else allocated end,
        period_credits_used = case when p_reset_credits then 0 else period_credits_used end,
        period_start = case when p_reset_credits then v_now else period_start end,
        period_end = case when p_reset_credits then v_end else period_end end,
        updated_at = v_now
    where user_id = v_user_id
    returning * into v_wallet;

    v_final_plan := 'plus';
    v_final_status := p_status;
  else
    select * into v_free from public.credit_plans where id = 'free';
    if not found then
      raise exception 'free_plan_not_configured' using errcode = 'P0001';
    end if;
    v_final_plan := 'free';
    v_final_status := case when p_status = 'active' then 'expired' else p_status end;
    v_end := v_now + make_interval(days => v_free.period_days);

    update public.wallets
    set plan = 'free',
        subscription_status = v_final_status,
        balance = v_free.credits_per_period,
        allocated = v_free.credits_per_period,
        period_credits_used = 0,
        period_start = v_now,
        period_end = v_end,
        renewal_at = v_end,
        expires_at = v_end,
        cancel_at_period_end = false,
        grace_period_ends_at = null,
        management_url = coalesce(p_management_url, management_url),
        updated_at = v_now
    where user_id = v_user_id
    returning * into v_wallet;
  end if;

  insert into public.subscriptions (
    user_id, plan, status, environment, revenuecat_customer_id,
    revenuecat_product_id, revenuecat_entitlement_id, purchased_at,
    expires_at, grace_period_ends_at, cancel_at_period_end, management_url,
    updated_at
  )
  values (
    v_user_id, v_final_plan, v_final_status, p_environment, p_customer_id,
    p_product_id, p_entitlement_id, p_purchased_at, v_end,
    p_grace_period_ends_at, coalesce(p_cancel_at_period_end, false),
    p_management_url, v_now
  )
  on conflict (user_id) do update
  set plan = excluded.plan,
      status = excluded.status,
      environment = excluded.environment,
      revenuecat_customer_id = coalesce(excluded.revenuecat_customer_id, subscriptions.revenuecat_customer_id),
      revenuecat_product_id = coalesce(excluded.revenuecat_product_id, subscriptions.revenuecat_product_id),
      revenuecat_entitlement_id = coalesce(excluded.revenuecat_entitlement_id, subscriptions.revenuecat_entitlement_id),
      purchased_at = coalesce(excluded.purchased_at, subscriptions.purchased_at),
      expires_at = excluded.expires_at,
      grace_period_ends_at = excluded.grace_period_ends_at,
      cancel_at_period_end = excluded.cancel_at_period_end,
      management_url = coalesce(excluded.management_url, subscriptions.management_url),
      updated_at = excluded.updated_at;

  update public.revenuecat_events
  set matched = true,
      matched_user_id = v_user_id,
      processed_at = v_now
  where event_id = v_event.event_id;

  return query select true, false, v_user_id;
end;
$$;

-- ------------------------------------------------------------- triggers

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists credit_actions_set_updated_at on public.credit_actions;
create trigger credit_actions_set_updated_at
  before update on public.credit_actions
  for each row execute function public.set_updated_at();

drop trigger if exists credit_plans_set_updated_at on public.credit_plans;
create trigger credit_plans_set_updated_at
  before update on public.credit_plans
  for each row execute function public.set_updated_at();

drop trigger if exists wallets_set_updated_at on public.wallets;
create trigger wallets_set_updated_at
  before update on public.wallets
  for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists ai_settings_set_updated_at on public.ai_settings;
create trigger ai_settings_set_updated_at
  before update on public.ai_settings
  for each row execute function public.set_updated_at();

drop trigger if exists vault_records_set_updated_at on public.vault_records;
create trigger vault_records_set_updated_at
  before update on public.vault_records
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- privileges

revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.create_profile_and_wallet(uuid, text, text) from public;
revoke all on function public.ensure_wallet(uuid) from public;
revoke all on function public.refresh_wallet_period(uuid) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_admin_for(uuid) from public;
revoke all on function public.reserve_credits(uuid, text, text) from public;
revoke all on function public.settle_credits(uuid, text) from public;
revoke all on function public.refund_credits(uuid, text) from public;
revoke all on function public.ensure_spend_counter(text, text, text, text) from public;
revoke all on function public.reserve_ai_spend(uuid, text, numeric, numeric, numeric, numeric, numeric) from public;
revoke all on function public.release_ai_spend(uuid, text) from public;
revoke all on function public.record_ai_usage(uuid, text, text, text, text, text, bigint, bigint, numeric, numeric, text, numeric, numeric, integer, text, boolean, timestamptz) from public;
revoke all on function public.apply_revenuecat_event(text, text, text, text[], text, text, text, text, text, timestamptz, timestamptz, timestamptz, boolean, text, boolean, timestamptz, jsonb) from public;

grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_admin_for(uuid) to service_role;
grant execute on function public.create_profile_and_wallet(uuid, text, text) to service_role;
grant execute on function public.ensure_wallet(uuid) to service_role;
grant execute on function public.refresh_wallet_period(uuid) to service_role;
grant execute on function public.reserve_credits(uuid, text, text) to service_role;
grant execute on function public.settle_credits(uuid, text) to service_role;
grant execute on function public.refund_credits(uuid, text) to service_role;
grant execute on function public.reserve_ai_spend(uuid, text, numeric, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.release_ai_spend(uuid, text) to service_role;
grant execute on function public.record_ai_usage(uuid, text, text, text, text, text, bigint, bigint, numeric, numeric, text, numeric, numeric, integer, text, boolean, timestamptz) to service_role;
grant execute on function public.apply_revenuecat_event(text, text, text, text[], text, text, text, text, text, timestamptz, timestamptz, timestamptz, boolean, text, boolean, timestamptz, jsonb) to service_role;
