-- Phase 5: Supabase credit ledger and provider-spend hardening.
--
-- This migration is additive. It does not migrate, grant, reset or delete any
-- legacy balance. The existing JSON ledgers remain authoritative until the
-- guarded importer is run for a verified account and the backend is explicitly
-- switched on.
--
-- Financial invariants added here:
--   * every credit transaction records balance_before and balance_after, and
--     the two must reconcile with credits_delta;
--   * an unclear provider outcome is recorded as uncertain and is never
--     refunded automatically;
--   * legacy imports are idempotent per source wallet and per Supabase user,
--     and cannot overwrite a wallet that already has activity;
--   * administrator adjustments require a reason and are audited.

-- ---------------------------------------------------- credit transaction math

alter table public.credit_transactions
  add column if not exists balance_before numeric(14, 4);

update public.credit_transactions
set balance_before = balance_after - credits_delta
where balance_before is null;

alter table public.credit_transactions
  alter column balance_before set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'credit_transactions_balance_before_check'
      and conrelid = 'public.credit_transactions'::regclass
  ) then
    alter table public.credit_transactions
      add constraint credit_transactions_balance_before_check
      check (balance_before >= 0);
  end if;
end;
$$;

create or replace function public.set_credit_transaction_balance_before()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.balance_before is null then
    new.balance_before := new.balance_after - new.credits_delta;
  end if;
  if new.balance_before < 0 then
    raise exception 'negative_balance_before' using errcode = 'P0001';
  end if;
  if new.balance_before + new.credits_delta <> new.balance_after then
    raise exception 'credit_transaction_balance_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists credit_transactions_set_balance_before on public.credit_transactions;
create trigger credit_transactions_set_balance_before
  before insert on public.credit_transactions
  for each row execute function public.set_credit_transaction_balance_before();

-- ------------------------------------------------------- uncertain outcomes

alter table public.credit_requests
  add column if not exists error_code text
    check (error_code is null or char_length(error_code) <= 120),
  add column if not exists uncertain_at timestamptz,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciliation_note text
    check (reconciliation_note is null or char_length(reconciliation_note) <= 500);

alter table public.credit_requests
  drop constraint if exists credit_requests_status_check;
alter table public.credit_requests
  drop constraint if exists credit_requests_check;

alter table public.credit_requests
  add constraint credit_requests_status_check
  check (status in ('pending', 'uncertain', 'succeeded', 'failed'));

alter table public.credit_requests
  add constraint credit_requests_completion_check
  check (
    (status in ('pending', 'uncertain') and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  );

create index if not exists credit_requests_uncertain_idx
  on public.credit_requests (created_at)
  where status = 'uncertain';

-- A provider timeout is not a failure. Keep the reserved credits and mark the
-- request for explicit reconciliation instead of refunding automatically.
create or replace function public.mark_credit_request_uncertain(
  p_user_id uuid,
  p_request_id text,
  p_error_code text default 'provider_outcome_unknown'
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
begin
  select * into v_request
  from public.credit_requests
  where user_id = p_user_id and credit_requests.request_id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;

  select * into v_wallet from public.wallets where user_id = p_user_id;

  if v_request.status in ('succeeded', 'failed') then
    raise exception 'request_already_completed' using errcode = 'P0001';
  end if;
  if v_request.status = 'uncertain' then
    return query select p_request_id, 'uncertain'::text, v_wallet.balance, true;
    return;
  end if;

  update public.credit_requests
  set status = 'uncertain',
      uncertain_at = now(),
      error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'provider_outcome_unknown'), 120)
  where id = v_request.id
  returning * into v_request;

  return query select p_request_id, 'uncertain'::text, v_wallet.balance, false;
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
  if v_request.status = 'uncertain' then
    raise exception 'request_outcome_uncertain' using errcode = 'P0001';
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
    user_id, request_id, kind, credits_delta, balance_before, balance_after, idempotency_key
  )
  values (
    p_user_id, p_request_id, 'settle', 0, v_wallet.balance, v_wallet.balance,
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
  v_before numeric;
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
  if v_request.status = 'uncertain' then
    raise exception 'request_outcome_uncertain' using errcode = 'P0001';
  end if;

  if v_request.status = 'failed' then
    return query select p_request_id, 'failed'::text, v_wallet.balance, true;
    return;
  end if;

  v_before := v_wallet.balance;

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
    user_id, request_id, kind, credits_delta, balance_before, balance_after, idempotency_key
  )
  values (
    p_user_id, p_request_id, 'refund', v_request.credits, v_before, v_wallet.balance,
    p_request_id || ':refund'
  )
  on conflict (user_id, idempotency_key) do nothing;

  return query select p_request_id, 'failed'::text, v_wallet.balance, false;
end;
$$;

-- Explicit administrator resolution of an uncertain credit request. This is the
-- only path that may settle or refund after an outcome was marked uncertain.
create or replace function public.admin_reconcile_credit_request(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_request_id text,
  p_outcome text,
  p_reason text
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
  v_before numeric;
  v_now timestamptz := now();
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_admin_user_id is null or not exists (
    select 1 from public.admin_users where user_id = p_admin_user_id
  ) then
    raise exception 'admin_user_not_authorized' using errcode = 'P0001';
  end if;
  if p_outcome not in ('succeeded', 'failed') then
    raise exception 'bad_reconciliation_outcome' using errcode = 'P0001';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'reconciliation_reason_required' using errcode = 'P0001';
  end if;

  select * into v_request
  from public.credit_requests
  where user_id = p_user_id and credit_requests.request_id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if v_request.status in ('succeeded', 'failed') then
    return query select p_request_id, v_request.status,
      (select w.balance from public.wallets w where w.user_id = p_user_id), true;
    return;
  end if;
  if v_request.status <> 'uncertain' then
    raise exception 'request_not_uncertain' using errcode = 'P0001';
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  v_before := v_wallet.balance;

  if p_outcome = 'succeeded' then
    update public.credit_requests
    set status = 'succeeded', completed_at = v_now, reconciled_at = v_now,
        reconciliation_note = left(v_reason, 500), error_code = null
    where id = v_request.id
    returning * into v_request;

    insert into public.credit_transactions (
      user_id, request_id, kind, credits_delta, balance_before, balance_after,
      idempotency_key, metadata
    )
    values (
      p_user_id, p_request_id, 'settle', 0, v_before, v_wallet.balance,
      p_request_id || ':settle',
      jsonb_build_object('reconciledBy', p_admin_user_id, 'reason', left(v_reason, 500))
    )
    on conflict (user_id, idempotency_key) do nothing;
  else
    update public.wallets
    set balance = least(allocated, balance + v_request.credits),
        period_credits_used = greatest(0, period_credits_used - v_request.credits),
        updated_at = v_now
    where user_id = p_user_id
    returning * into v_wallet;

    update public.credit_requests
    set status = 'failed', completed_at = v_now, reconciled_at = v_now,
        reconciliation_note = left(v_reason, 500), error_code = null
    where id = v_request.id
    returning * into v_request;

    insert into public.credit_transactions (
      user_id, request_id, kind, credits_delta, balance_before, balance_after,
      idempotency_key, metadata
    )
    values (
      p_user_id, p_request_id, 'refund', v_request.credits, v_before, v_wallet.balance,
      p_request_id || ':refund',
      jsonb_build_object('reconciledBy', p_admin_user_id, 'reason', left(v_reason, 500))
    )
    on conflict (user_id, idempotency_key) do nothing;
  end if;

  perform public.record_admin_audit(
    p_admin_user_id => p_admin_user_id,
    p_actor_type => 'admin_user',
    p_actor_id => p_admin_user_id::text,
    p_action => 'credits.request.reconcile',
    p_target_user_id => p_user_id,
    p_target_user_ref => p_user_id::text,
    p_success => true,
    p_request_id => p_request_id,
    p_metadata => jsonb_build_object(
      'outcome', p_outcome,
      'reason', left(v_reason, 500),
      'balanceBefore', v_before,
      'balanceAfter', v_wallet.balance
    )
  );

  return query select p_request_id, v_request.status, v_wallet.balance, false;
end;
$$;

-- Mark stale pending credit requests uncertain instead of refunding them. A
-- server timeout may mean the provider produced a response that was never
-- delivered; only an administrator can decide the outcome.
create or replace function public.expire_stale_credit_requests(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  with stale as (
    select id
    from public.credit_requests
    where status = 'pending'
      and reservation_expires_at <= now()
    order by reservation_expires_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update skip locked
  )
  update public.credit_requests r
  set status = 'uncertain',
      uncertain_at = now(),
      error_code = 'reservation_expired'
  from stale
  where r.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ------------------------------------------------ legacy balance import

create table if not exists public.legacy_credit_imports (
  source_key text primary key
    check (source_key ~ '^[a-f0-9]{16,64}$'),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  source_balance numeric(14, 4) not null check (source_balance >= 0),
  imported_balance numeric(14, 4) not null check (imported_balance >= 0),
  source_allocated numeric(14, 4) not null check (source_allocated >= 0),
  source_plan text not null references public.credit_plans (id)
    on update cascade on delete restrict,
  source_checksum text not null check (char_length(source_checksum) between 16 and 128),
  source_history_count integer not null default 0 check (source_history_count >= 0),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  imported_at timestamptz not null default now()
);

alter table public.legacy_credit_imports enable row level security;
revoke all on public.legacy_credit_imports from anon, authenticated;
grant select on public.legacy_credit_imports to service_role;

/**
 * Import one legacy wallet into one verified Supabase profile.
 *
 * The caller must have established the profile mapping through
 * profiles.legacy_user_id or an equivalent server-side ownership check. This
 * function never guesses an owner. It sets the wallet to the legacy balance
 * rather than adding to it, refuses a wallet that already has credit activity,
 * and is idempotent for the same source and user.
 */
create or replace function public.import_legacy_wallet(
  p_source_key text,
  p_user_id uuid,
  p_balance numeric,
  p_allocated numeric,
  p_plan text,
  p_checksum text,
  p_history_count integer default 0,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  user_id uuid,
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
  v_existing public.legacy_credit_imports%rowtype;
  v_before numeric;
  v_allocated numeric;
  v_tx_count integer;
begin
  if p_source_key is null or p_source_key !~ '^[a-f0-9]{16,64}$' then
    raise exception 'bad_legacy_source_key' using errcode = 'P0001';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'verified_profile_required' using errcode = 'P0001';
  end if;
  if p_balance is null or p_balance < 0 then
    raise exception 'bad_legacy_balance' using errcode = 'P0001';
  end if;
  if p_plan not in ('free', 'plus') then
    raise exception 'bad_legacy_plan' using errcode = 'P0001';
  end if;
  if p_checksum is null or char_length(p_checksum) < 16 then
    raise exception 'bad_legacy_checksum' using errcode = 'P0001';
  end if;
  if coalesce(p_history_count, 0) <> 0 then
    raise exception 'legacy_history_requires_manual_review' using errcode = 'P0001';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'bad_legacy_metadata' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.legacy_credit_imports
  where source_key = p_source_key
  for update;

  if found then
    if v_existing.user_id <> p_user_id then
      raise exception 'legacy_wallet_already_claimed' using errcode = 'P0001';
    end if;
    return query
      select v_existing.user_id,
             (select w.balance from public.wallets w where w.user_id = p_user_id),
             true;
    return;
  end if;

  select * into v_existing
  from public.legacy_credit_imports
  where user_id = p_user_id
  for update;

  if found then
    raise exception 'profile_already_has_legacy_import' using errcode = 'P0001';
  end if;

  perform public.ensure_wallet(p_user_id);

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  select count(*)::integer into v_tx_count
  from public.credit_transactions
  where user_id = p_user_id;

  if v_tx_count > 0 then
    raise exception 'wallet_has_existing_activity' using errcode = 'P0001';
  end if;

  v_before := v_wallet.balance;
  v_allocated := greatest(coalesce(p_allocated, p_balance), p_balance);

  update public.wallets
  set balance = p_balance,
      allocated = v_allocated,
      plan = p_plan,
      subscription_status = 'active',
      period_credits_used = 0,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_wallet;

  insert into public.credit_transactions (
    user_id, kind, credits_delta, balance_before, balance_after,
    idempotency_key, metadata
  )
  values (
    p_user_id,
    'legacy_import',
    p_balance - v_before,
    v_before,
    v_wallet.balance,
    'legacy:' || p_source_key || ':wallet',
    p_metadata || jsonb_build_object(
      'sourceKey', p_source_key,
      'sourceBalance', p_balance,
      'sourceAllocated', p_allocated,
      'sourcePlan', p_plan,
      'sourceHistoryCount', coalesce(p_history_count, 0)
    )
  )
  on conflict (user_id, idempotency_key) do nothing;

  insert into public.legacy_credit_imports (
    source_key, user_id, source_balance, imported_balance, source_allocated,
    source_plan, source_checksum, source_history_count, metadata
  )
  values (
    p_source_key, p_user_id, p_balance, v_wallet.balance, v_allocated,
    p_plan, p_checksum, coalesce(p_history_count, 0), p_metadata
  );

  return query select p_user_id, v_wallet.balance, false;
end;
$$;

-- --------------------------------------------------- admin credit adjustment

create or replace function public.admin_adjust_credits(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_delta numeric,
  p_reason text,
  p_request_id text
)
returns table (
  user_id uuid,
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
  v_before numeric;
  v_after numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text;
  v_existing public.credit_transactions%rowtype;
begin
  if p_admin_user_id is null or not exists (
    select 1 from public.admin_users where user_id = p_admin_user_id
  ) then
    raise exception 'admin_user_not_authorized' using errcode = 'P0001';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'bad_request_id' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then
    raise exception 'bad_adjustment_amount' using errcode = 'P0001';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'adjustment_reason_required' using errcode = 'P0001';
  end if;

  v_key := 'admin:' || p_request_id;

  select * into v_existing
  from public.credit_transactions
  where user_id = p_user_id and idempotency_key = v_key;

  if found then
    return query select p_user_id, v_existing.balance_after, true;
    return;
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet_not_found' using errcode = 'P0001';
  end if;

  v_before := v_wallet.balance;
  v_after := v_before + p_delta;

  if v_after < 0 then
    raise exception 'adjustment_would_make_balance_negative' using errcode = 'P0001';
  end if;

  update public.wallets
  set balance = v_after,
      allocated = greatest(allocated, v_after),
      updated_at = now()
  where user_id = p_user_id
  returning * into v_wallet;

  insert into public.credit_transactions (
    user_id, kind, credits_delta, balance_before, balance_after,
    idempotency_key, metadata
  )
  values (
    p_user_id, 'admin_adjustment', p_delta, v_before, v_wallet.balance,
    v_key,
    jsonb_build_object(
      'reason', left(v_reason, 500),
      'adminUserId', p_admin_user_id,
      'requestId', p_request_id
    )
  );

  perform public.record_admin_audit(
    p_admin_user_id => p_admin_user_id,
    p_actor_type => 'admin_user',
    p_actor_id => p_admin_user_id::text,
    p_action => 'credits.adjust',
    p_target_user_id => p_user_id,
    p_target_user_ref => p_user_id::text,
    p_success => true,
    p_request_id => p_request_id,
    p_metadata => jsonb_build_object(
      'delta', p_delta,
      'reason', left(v_reason, 500),
      'balanceBefore', v_before,
      'balanceAfter', v_wallet.balance
    )
  );

  return query select p_user_id, v_wallet.balance, false;
end;
$$;

-- -------------------------------------------- provider-spend uncertainty

alter table public.ai_spend_reservations
  add column if not exists actual_aud numeric(14, 6)
    check (actual_aud is null or actual_aud >= 0),
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciliation_note text
    check (reconciliation_note is null or char_length(reconciliation_note) <= 500);

alter table public.ai_spend_reservations
  drop constraint if exists ai_spend_reservations_status_check;
alter table public.ai_spend_reservations
  add constraint ai_spend_reservations_status_check
  check (status in ('reserved', 'consumed', 'released', 'expired', 'uncertain', 'reconciled'));

create table if not exists public.ai_spend_rejections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  reason text not null check (char_length(reason) between 1 and 120),
  limit_aud numeric(14, 6) check (limit_aud is null or limit_aud >= 0),
  attempted_aud numeric(14, 6) not null default 0 check (attempted_aud >= 0),
  day_key text not null check (char_length(day_key) = 10),
  month_key text not null check (char_length(month_key) = 7),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists ai_spend_rejections_created_idx
  on public.ai_spend_rejections (created_at desc);
create index if not exists ai_spend_rejections_reason_idx
  on public.ai_spend_rejections (reason, created_at desc);

alter table public.ai_spend_rejections enable row level security;
revoke all on public.ai_spend_rejections from anon, authenticated;
grant select on public.ai_spend_rejections to service_role;

create or replace function public.record_ai_spend_rejection(
  p_user_id uuid,
  p_request_id text,
  p_reason text,
  p_limit_aud numeric default null,
  p_attempted_aud numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'bad_request_id' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'bad_rejection_reason' using errcode = 'P0001';
  end if;

  insert into public.ai_spend_rejections (
    user_id, request_id, reason, limit_aud, attempted_aud, day_key, month_key
  )
  values (
    p_user_id, p_request_id, left(btrim(p_reason), 120), p_limit_aud,
    greatest(0, coalesce(p_attempted_aud, 0)),
    to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
    to_char(now() at time zone 'utc', 'YYYY-MM')
  )
  on conflict (user_id, request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.ai_spend_rejections
    where user_id = p_user_id and request_id = p_request_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.mark_ai_spend_uncertain(
  p_user_id uuid,
  p_request_id text,
  p_note text default 'provider_outcome_unknown'
)
returns table (
  request_id text,
  status text,
  reserved_aud numeric,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_res public.ai_spend_reservations%rowtype;
begin
  select * into v_res
  from public.ai_spend_reservations
  where user_id = p_user_id and ai_spend_reservations.request_id = p_request_id
  for update;

  if not found then
    raise exception 'spend_reservation_not_found' using errcode = 'P0001';
  end if;
  if v_res.status = 'uncertain' then
    return query select p_request_id, 'uncertain'::text, v_res.reserved_aud, true;
    return;
  end if;
  if v_res.status <> 'reserved' then
    raise exception 'spend_reservation_not_reserved' using errcode = 'P0001';
  end if;

  update public.ai_spend_reservations
  set status = 'uncertain',
      reconciliation_note = left(coalesce(nullif(btrim(p_note), ''), 'provider_outcome_unknown'), 500)
  where id = v_res.id
  returning * into v_res;

  return query select p_request_id, 'uncertain'::text, v_res.reserved_aud, false;
end;
$$;

create or replace function public.admin_reconcile_ai_spend(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_request_id text,
  p_actual_aud numeric,
  p_note text
)
returns table (
  request_id text,
  status text,
  actual_aud numeric,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_res public.ai_spend_reservations%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if p_admin_user_id is null or not exists (
    select 1 from public.admin_users where user_id = p_admin_user_id
  ) then
    raise exception 'admin_user_not_authorized' using errcode = 'P0001';
  end if;
  if p_actual_aud is null or p_actual_aud < 0 then
    raise exception 'bad_actual_spend' using errcode = 'P0001';
  end if;
  if char_length(v_note) < 3 then
    raise exception 'reconciliation_reason_required' using errcode = 'P0001';
  end if;

  select * into v_res
  from public.ai_spend_reservations
  where user_id = p_user_id and ai_spend_reservations.request_id = p_request_id
  for update;

  if not found then
    raise exception 'spend_reservation_not_found' using errcode = 'P0001';
  end if;
  if v_res.status = 'reconciled' then
    return query select p_request_id, 'reconciled'::text, v_res.actual_aud, true;
    return;
  end if;
  if v_res.status not in ('reserved', 'uncertain') then
    raise exception 'spend_reservation_not_reconcilable' using errcode = 'P0001';
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

  update public.ai_spend_counters
  set actual_aud = actual_aud + p_actual_aud, updated_at = now()
  where period_type = 'day' and period_key = v_res.day_key
    and scope = 'global' and scope_id = 'global';
  update public.ai_spend_counters
  set actual_aud = actual_aud + p_actual_aud, updated_at = now()
  where period_type = 'month' and period_key = v_res.month_key
    and scope = 'global' and scope_id = 'global';
  update public.ai_spend_counters
  set actual_aud = actual_aud + p_actual_aud, updated_at = now()
  where period_type = 'day' and period_key = v_res.day_key
    and scope = 'user' and scope_id = p_user_id::text;
  update public.ai_spend_counters
  set actual_aud = actual_aud + p_actual_aud, updated_at = now()
  where period_type = 'month' and period_key = v_res.month_key
    and scope = 'user' and scope_id = p_user_id::text;

  update public.ai_spend_reservations
  set status = 'reconciled',
      actual_aud = p_actual_aud,
      reconciled_at = now(),
      reconciliation_note = left(v_note, 500)
  where id = v_res.id
  returning * into v_res;

  perform public.record_admin_audit(
    p_admin_user_id => p_admin_user_id,
    p_actor_type => 'admin_user',
    p_actor_id => p_admin_user_id::text,
    p_action => 'ai.spend.reconcile',
    p_target_user_id => p_user_id,
    p_target_user_ref => p_user_id::text,
    p_success => true,
    p_request_id => p_request_id,
    p_metadata => jsonb_build_object(
      'reservedAud', v_res.reserved_aud,
      'actualAud', p_actual_aud,
      'reason', left(v_note, 500)
    )
  );

  return query select p_request_id, 'reconciled'::text, p_actual_aud, false;
end;
$$;

-- Usage recording is also the normal reconciliation path when the provider
-- eventually returns exact usage. Consume an uncertain reservation then; it
-- must not remain counted as both reserved and actual.
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

  if found and v_res.status in ('reserved', 'uncertain') then
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

-- -------------------------------------------------------- admin summary

create or replace function public.admin_financial_overview()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with wallet_totals as (
    select
      coalesce(sum(balance), 0) as held_credits,
      coalesce(sum(allocated), 0) as allocated_credits,
      count(*)::integer as wallet_count
    from public.wallets
  ),
  credit_totals as (
    select
      coalesce(-sum(credits_delta) filter (
        where kind in ('reserve', 'refund')
      ), 0) as spent_credits,
      coalesce(sum(credits_delta) filter (
        where kind in ('subscription_grant', 'legacy_import', 'admin_adjustment')
          and credits_delta > 0
      ), 0) as earned_credits
    from public.credit_transactions
  ),
  current_period as (
    select
      coalesce(sum(actual_aud) filter (where period_type = 'day'), 0) as day_actual_aud,
      coalesce(sum(actual_aud) filter (where period_type = 'month'), 0) as month_actual_aud,
      coalesce(sum(reserved_aud) filter (where period_type = 'day'), 0) as day_reserved_aud,
      coalesce(sum(reserved_aud) filter (where period_type = 'month'), 0) as month_reserved_aud
    from public.ai_spend_counters
    where (period_type = 'day' and period_key = to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
       or (period_type = 'month' and period_key = to_char(now() at time zone 'utc', 'YYYY-MM'))
  ),
  spend_by_user as (
    select coalesce(jsonb_object_agg(user_id::text, cost), '{}'::jsonb) as value
    from (
      select user_id, round(sum(cost_aud)::numeric, 6) as cost
      from public.ai_usage_daily
      where day >= date_trunc('month', now() at time zone 'utc')::date
      group by user_id
    ) rows
  ),
  spend_by_model as (
    select coalesce(jsonb_object_agg(model, cost), '{}'::jsonb) as value
    from (
      select model, round(sum(cost_aud)::numeric, 6) as cost
      from public.ai_usage_daily
      where day >= date_trunc('month', now() at time zone 'utc')::date
      group by model
    ) rows
  ),
  spend_by_provider as (
    select coalesce(jsonb_object_agg(provider, cost), '{}'::jsonb) as value
    from (
      select provider, round(sum(cost_aud)::numeric, 6) as cost
      from public.ai_usage_daily
      where day >= date_trunc('month', now() at time zone 'utc')::date
      group by provider
    ) rows
  ),
  reservations as (
    select
      count(*)::integer as active_count,
      coalesce(sum(reserved_aud), 0) as reserved_aud,
      count(*) filter (where status = 'uncertain')::integer as uncertain_count
    from public.ai_spend_reservations
    where status in ('reserved', 'uncertain')
  ),
  rejections as (
    select count(*)::integer as count_month
    from public.ai_spend_rejections
    where created_at >= date_trunc('month', now() at time zone 'utc')
  ),
  failures as (
    select
      count(*) filter (where status = 'failed')::integer as failed_requests,
      count(*) filter (where status = 'uncertain')::integer as uncertain_requests
    from public.credit_requests
    where created_at >= date_trunc('month', now() at time zone 'utc')
  ),
  refunds as (
    select coalesce(count(*), 0)::integer as refund_count,
           coalesce(sum(credits_delta), 0) as refunded_credits
    from public.credit_transactions
    where kind = 'refund'
      and created_at >= date_trunc('month', now() at time zone 'utc')
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'credits', jsonb_build_object(
      'held', wallet_totals.held_credits,
      'allocated', wallet_totals.allocated_credits,
      'spent', credit_totals.spent_credits,
      'earned', credit_totals.earned_credits,
      'wallets', wallet_totals.wallet_count
    ),
    'spending', jsonb_build_object(
      'dayAud', current_period.day_actual_aud,
      'monthAud', current_period.month_actual_aud,
      'dayReservedAud', current_period.day_reserved_aud,
      'monthReservedAud', current_period.month_reserved_aud,
      'byUser', spend_by_user.value,
      'byModel', spend_by_model.value,
      'byProvider', spend_by_provider.value
    ),
    'reservations', jsonb_build_object(
      'active', reservations.active_count,
      'reservedAud', reservations.reserved_aud,
      'uncertain', reservations.uncertain_count
    ),
    'rejections', jsonb_build_object(
      'thisMonth', rejections.count_month
    ),
    'requests', jsonb_build_object(
      'failedThisMonth', failures.failed_requests,
      'uncertainThisMonth', failures.uncertain_requests,
      'refundedThisMonth', refunds.refund_count,
      'refundedCreditsThisMonth', refunds.refunded_credits
    )
  )
  from wallet_totals, credit_totals, current_period, spend_by_user,
       spend_by_model, spend_by_provider, reservations, rejections,
       failures, refunds;
$$;

-- ------------------------------------------------------------ privileges

revoke all on function public.set_credit_transaction_balance_before() from public;
revoke all on function public.mark_credit_request_uncertain(uuid, text, text) from public;
revoke all on function public.admin_reconcile_credit_request(uuid, uuid, text, text, text) from public;
revoke all on function public.expire_stale_credit_requests(integer) from public;
revoke all on function public.import_legacy_wallet(text, uuid, numeric, numeric, text, text, integer, jsonb) from public;
revoke all on function public.admin_adjust_credits(uuid, uuid, numeric, text, text) from public;
revoke all on function public.record_ai_spend_rejection(uuid, text, text, numeric, numeric) from public;
revoke all on function public.mark_ai_spend_uncertain(uuid, text, text) from public;
revoke all on function public.admin_reconcile_ai_spend(uuid, uuid, text, numeric, text) from public;
revoke all on function public.admin_financial_overview() from public;

grant execute on function public.mark_credit_request_uncertain(uuid, text, text) to service_role;
grant execute on function public.admin_reconcile_credit_request(uuid, uuid, text, text, text) to service_role;
grant execute on function public.expire_stale_credit_requests(integer) to service_role;
grant execute on function public.import_legacy_wallet(text, uuid, numeric, numeric, text, text, integer, jsonb) to service_role;
grant execute on function public.admin_adjust_credits(uuid, uuid, numeric, text, text) to service_role;
grant execute on function public.record_ai_spend_rejection(uuid, text, text, numeric, numeric) to service_role;
grant execute on function public.mark_ai_spend_uncertain(uuid, text, text) to service_role;
grant execute on function public.admin_reconcile_ai_spend(uuid, uuid, text, numeric, text) to service_role;
grant execute on function public.admin_financial_overview() to service_role;
