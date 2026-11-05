-- Phase 6.4: administrator credit management for the Supabase ledger.
--
-- These RPCs are additive. They never alter historical credit transactions and
-- never top up existing wallets when a plan allocation changes. Every balance
-- change goes through the existing wallet/transaction constraints and writes an
-- append-only administrator audit row.

-- ------------------------------------------------------- credit overview

create or replace function public.admin_credit_management(
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_result jsonb;
begin
  with wallet_totals as (
    select
      t.user_id,
      coalesce(-sum(t.credits_delta) filter (where t.kind in ('reserve', 'refund')), 0) as spent_credits,
      count(t.id)::integer as transaction_count
    from public.credit_transactions t
    group by t.user_id
  ),
  filtered as (
    select
      w.*,
      p.display_name,
      coalesce(t.spent_credits, 0) as spent_credits,
      coalesce(t.transaction_count, 0) as transaction_count
    from public.wallets w
    join public.profiles p on p.id = w.user_id
    left join wallet_totals t on t.user_id = w.user_id
    where v_search is null
      or p.display_name ilike '%' || v_search || '%'
      or w.user_id::text ilike '%' || v_search || '%'
  ),
  counted as (
    select count(*)::integer as total from filtered
  ),
  page as (
    select * from filtered
    order by updated_at desc, user_id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'source', 'supabase',
    'config', jsonb_build_object(
      'actions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'key', key,
          'label', label,
          'description', description,
          'cost', cost
        ) order by key), '[]'::jsonb)
        from public.credit_actions
      ),
      'plans', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id,
          'label', label,
          'creditsPerPeriod', credits_per_period,
          'periodDays', period_days,
          'requestsPerDay', requests_per_day,
          'tokensPerDay', tokens_per_day,
          'memoryLimit', memory_limit,
          'historyLimit', history_limit,
          'historyCharLimit', history_char_limit,
          'maxAttachments', max_attachments,
          'advancedFeatures', advanced_features
        ) order by id), '[]'::jsonb)
        from public.credit_plans
      ),
      'updatedAt', greatest(
        coalesce((select max(updated_at) from public.credit_actions), now()),
        coalesce((select max(updated_at) from public.credit_plans), now())
      )
    ),
    'summary', jsonb_build_object(
      'wallets', (select count(*) from filtered),
      'heldCredits', coalesce((select sum(balance) from filtered), 0),
      'allocatedCredits', coalesce((select sum(allocated) from filtered), 0),
      'totalSpentCredits', coalesce((select sum(spent_credits) from filtered), 0)
    ),
    'total', (select total from counted),
    'users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', user_id,
        'userShortId', left(user_id::text, 8),
        'displayName', display_name,
        'plan', plan,
        'planLabel', (select label from public.credit_plans where id = page.plan),
        'subscriptionStatus', subscription_status,
        'balance', balance,
        'allocated', allocated,
        'totalReceivedCredits', allocated,
        'totalSpentCredits', spent_credits,
        'transactionCount', transaction_count,
        'periodCreditsUsed', period_credits_used,
        'periodStart', period_start,
        'periodEnd', period_end,
        'renewalAt', renewal_at,
        'expiresAt', expires_at,
        'createdAt', created_at,
        'updatedAt', updated_at,
        'lastUsedAt', last_used_at
      ) order by updated_at desc, user_id), '[]'::jsonb)
      from page
    )
  )
  into v_result;

  return v_result;
end;
$$;

-- --------------------------------------------------- one user's ledger

create or replace function public.admin_credit_user_detail(
  p_user_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_result jsonb;
begin
  with wallet_totals as (
    select
      coalesce(-sum(credits_delta) filter (where kind in ('reserve', 'refund')), 0) as spent_credits,
      count(*)::integer as transaction_count
    from public.credit_transactions
    where user_id = p_user_id
  ),
  page as (
    select
      t.id,
      t.kind,
      t.credits_delta,
      t.balance_before,
      t.balance_after,
      t.request_id,
      t.metadata,
      t.created_at
    from public.credit_transactions t
    where t.user_id = p_user_id
    order by t.created_at desc, t.id desc
    limit v_limit
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'user', jsonb_build_object(
      'userId', w.user_id,
      'userShortId', left(w.user_id::text, 8),
      'displayName', p.display_name,
      'plan', w.plan,
      'planLabel', (select label from public.credit_plans where id = w.plan),
      'subscriptionStatus', w.subscription_status,
      'balance', w.balance,
      'allocated', w.allocated,
      'totalReceivedCredits', w.allocated,
      'totalSpentCredits', totals.spent_credits,
      'transactionCount', totals.transaction_count,
      'periodCreditsUsed', w.period_credits_used,
      'periodStart', w.period_start,
      'periodEnd', w.period_end,
      'renewalAt', w.renewal_at,
      'expiresAt', w.expires_at,
      'createdAt', w.created_at,
      'updatedAt', w.updated_at,
      'lastUsedAt', w.last_used_at
    ),
    'transactions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'kind', kind,
        'creditsDelta', credits_delta,
        'balanceBefore', balance_before,
        'balanceAfter', balance_after,
        'reason', metadata ->> 'reason',
        'requestId', request_id,
        'adminUserId', metadata ->> 'adminUserId',
        'createdAt', created_at
      ) order by created_at desc, id desc), '[]'::jsonb)
      from page
    )
  )
  into v_result
  from public.wallets w
  join public.profiles p on p.id = w.user_id
  cross join wallet_totals totals
  where w.user_id = p_user_id;

  if v_result is null then
    raise exception 'wallet_not_found' using errcode = 'P0001';
  end if;

  return v_result;
end;
$$;

-- ------------------------------------------------------- settings changes

create or replace function public.admin_credit_settings_update(
  p_admin_user_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_actions jsonb default '{}'::jsonb,
  p_plans jsonb default '{}'::jsonb,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actions jsonb := coalesce(p_actions, '{}'::jsonb);
  v_plans jsonb := coalesce(p_plans, '{}'::jsonb);
  v_before_actions jsonb;
  v_before_plans jsonb;
  v_action record;
  v_plan record;
  v_cost numeric;
  v_credits numeric;
  v_days integer;
  v_result jsonb;
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'bad_request_id' using errcode = 'P0001';
  end if;
  if p_actor_type not in ('admin_user', 'break_glass') then
    raise exception 'bad_admin_actor_type' using errcode = 'P0001';
  end if;
  if p_actor_type = 'admin_user' and (
    p_admin_user_id is null
    or not exists (select 1 from public.admin_users where user_id = p_admin_user_id)
  ) then
    raise exception 'admin_user_not_authorized' using errcode = 'P0001';
  end if;
  if p_actor_type = 'break_glass' and (
    p_admin_user_id is not null
    or p_actor_id is null
    or btrim(p_actor_id) = ''
  ) then
    raise exception 'break_glass_actor_required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_actions) <> 'object' or jsonb_typeof(v_plans) <> 'object' then
    raise exception 'bad_credit_settings' using errcode = 'P0001';
  end if;
  if v_actions = '{}'::jsonb and v_plans = '{}'::jsonb then
    raise exception 'no_credit_changes' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(key, jsonb_build_object(
    'cost', cost, 'label', label, 'description', description
  )), '{}'::jsonb)
  into v_before_actions
  from public.credit_actions;

  select coalesce(jsonb_object_agg(id, jsonb_build_object(
    'creditsPerPeriod', credits_per_period,
    'periodDays', period_days
  )), '{}'::jsonb)
  into v_before_plans
  from public.credit_plans;

  for v_action in select key, value from jsonb_each(v_actions)
  loop
    if v_action.key not in ('simple_message', 'daily_plan', 'detailed_analysis', 'complex_task') then
      raise exception 'unknown_credit_action' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_action.value) <> 'number' then
      raise exception 'bad_credit_cost' using errcode = 'P0001';
    end if;
    v_cost := (v_action.value #>> '{}')::numeric;
    if v_cost < 0 or v_cost > 10000 then
      raise exception 'bad_credit_cost' using errcode = 'P0001';
    end if;
    update public.credit_actions
    set cost = v_cost, updated_at = now()
    where key = v_action.key;
  end loop;

  for v_plan in select key, value from jsonb_each(v_plans)
  loop
    if v_plan.key not in ('free', 'plus') or jsonb_typeof(v_plan.value) <> 'object' then
      raise exception 'bad_credit_plan' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_plan.value -> 'creditsPerPeriod') <> 'number'
       or jsonb_typeof(v_plan.value -> 'periodDays') <> 'number' then
      raise exception 'bad_credit_plan' using errcode = 'P0001';
    end if;
    v_credits := (v_plan.value ->> 'creditsPerPeriod')::numeric;
    v_days := (v_plan.value ->> 'periodDays')::integer;
    if v_credits < 0 or v_credits > 1000000 or v_days < 1 or v_days > 3650 then
      raise exception 'bad_credit_plan' using errcode = 'P0001';
    end if;
    update public.credit_plans
    set credits_per_period = v_credits,
        period_days = v_days,
        updated_at = now()
    where id = v_plan.key;
  end loop;

  perform public.record_admin_audit(
    p_admin_user_id => case when p_actor_type = 'admin_user' then p_admin_user_id else null end,
    p_actor_type => p_actor_type,
    p_actor_id => p_actor_id,
    p_action => 'credits.settings.change',
    p_success => true,
    p_request_id => p_request_id,
    p_metadata => jsonb_build_object(
      'before', jsonb_build_object('actions', v_before_actions, 'plans', v_before_plans),
      'after', jsonb_build_object('actions', v_actions, 'plans', v_plans),
      'note', 'Existing wallets and historical transactions were not changed.'
    )
  );

  select jsonb_build_object(
    'actions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'label', label, 'description', description, 'cost', cost
      ) order by key), '[]'::jsonb)
      from public.credit_actions
    ),
    'plans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'label', label,
        'creditsPerPeriod', credits_per_period,
        'periodDays', period_days,
        'requestsPerDay', requests_per_day,
        'tokensPerDay', tokens_per_day,
        'memoryLimit', memory_limit,
        'historyLimit', history_limit,
        'historyCharLimit', history_char_limit,
        'maxAttachments', max_attachments,
        'advancedFeatures', advanced_features
      ) order by id), '[]'::jsonb)
      from public.credit_plans
    ),
    'updatedAt', now()
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------- audited adjustment

create or replace function public.admin_credit_adjustment(
  p_admin_user_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_user_id uuid,
  p_delta numeric,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.credit_transactions%rowtype;
  v_before numeric;
  v_after numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text;
  v_result jsonb;
begin
  if p_actor_type not in ('admin_user', 'break_glass') then
    raise exception 'bad_admin_actor_type' using errcode = 'P0001';
  end if;
  if p_actor_type = 'admin_user' and (
    p_admin_user_id is null
    or not exists (select 1 from public.admin_users where user_id = p_admin_user_id)
  ) then
    raise exception 'admin_user_not_authorized' using errcode = 'P0001';
  end if;
  if p_actor_type = 'break_glass' and (
    p_admin_user_id is not null
    or p_actor_id is null
    or btrim(p_actor_id) = ''
  ) then
    raise exception 'break_glass_actor_required' using errcode = 'P0001';
  end if;
  if p_user_id is null then
    raise exception 'bad_user_id' using errcode = 'P0001';
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
    return jsonb_build_object(
      'balance', v_existing.balance_after,
      'balanceBefore', v_existing.balance_before,
      'balanceAfter', v_existing.balance_after,
      'duplicate', true,
      'transactionId', v_existing.id
    );
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
      'actorType', p_actor_type,
      'actorId', left(coalesce(p_actor_id, ''), 120),
      'requestId', p_request_id
    )
  )
  returning * into v_existing;

  perform public.record_admin_audit(
    p_admin_user_id => case when p_actor_type = 'admin_user' then p_admin_user_id else null end,
    p_actor_type => p_actor_type,
    p_actor_id => p_actor_id,
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

  return jsonb_build_object(
    'balance', v_wallet.balance,
    'balanceBefore', v_before,
    'balanceAfter', v_wallet.balance,
    'duplicate', false,
    'transactionId', v_existing.id
  );
end;
$$;

revoke all on function public.admin_credit_management(text, integer, integer) from public;
revoke all on function public.admin_credit_user_detail(uuid, integer) from public;
revoke all on function public.admin_credit_settings_update(uuid, text, text, jsonb, jsonb, text) from public;
revoke all on function public.admin_credit_adjustment(uuid, text, text, uuid, numeric, text, text) from public;

grant execute on function public.admin_credit_management(text, integer, integer) to service_role;
grant execute on function public.admin_credit_user_detail(uuid, integer) to service_role;
grant execute on function public.admin_credit_settings_update(uuid, text, text, jsonb, jsonb, text) to service_role;
grant execute on function public.admin_credit_adjustment(uuid, text, text, uuid, numeric, text, text) to service_role;