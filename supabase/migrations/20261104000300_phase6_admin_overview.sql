-- Phase 6.2: aggregate statistics for the existing AI admin dashboard.
--
-- One server-only RPC keeps the overview to a single database round trip and
-- avoids exposing user rows to the browser. It returns counts and totals only.
-- Active-user counts are deliberately null: the schema records no general
-- app-activity/session table, so registration is not treated as activity.

create index if not exists subscriptions_active_plus_idx
  on public.subscriptions (expires_at)
  where plan = 'plus' and status = 'active';

create or replace function public.admin_supabase_overview()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  user_totals as (
    select count(*)::bigint as total_users
    from public.profiles
  ),
  wallet_plans as (
    select count(*) filter (where plan = 'free')::bigint as free_users
    from public.wallets
  ),
  active_plus as (
    select count(*)::bigint as plus_users
    from public.subscriptions
    where plan = 'plus'
      and status = 'active'
      and expires_at is not null
      and expires_at > now()
  ),
  usage_totals as (
    select
      count(*)::bigint as total_requests,
      count(*) filter (where status = 'success')::bigint as successful_requests,
      count(*) filter (where status = 'failed')::bigint as failed_requests,
      coalesce(sum(credits) filter (where status = 'success'), 0) as credits_used,
      coalesce(sum(cost_aud) filter (
        where estimated_usage = false
          and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
      ), 0) as actual_today_aud,
      coalesce(sum(cost_aud) filter (
        where estimated_usage = false
          and created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
      ), 0) as actual_month_aud,
      coalesce(sum(cost_aud) filter (
        where estimated_usage = true
          and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
      ), 0) as estimated_today_aud,
      coalesce(sum(cost_aud) filter (
        where estimated_usage = true
          and created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
      ), 0) as estimated_month_aud
    from public.ai_usage_events
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'source', 'supabase',
    'currency', 'AUD',
    'users', jsonb_build_object(
      'total', user_totals.total_users,
      'free', wallet_plans.free_users,
      'plusActive', active_plus.plus_users,
      'activeToday', null,
      'activeLast30Days', null,
      'activity', jsonb_build_object(
        'available', false,
        'reason', 'No app-activity or session table is populated, so active users cannot be calculated without assuming registration equals activity.'
      )
    ),
    'ai', jsonb_build_object(
      'totalRequests', usage_totals.total_requests,
      'successfulRequests', usage_totals.successful_requests,
      'failedRequests', usage_totals.failed_requests,
      'creditsUsed', usage_totals.credits_used,
      'actualSpendTodayAud', usage_totals.actual_today_aud,
      'actualSpendMonthAud', usage_totals.actual_month_aud,
      'estimatedSpendTodayAud', usage_totals.estimated_today_aud,
      'estimatedSpendMonthAud', usage_totals.estimated_month_aud
    )
  )
  from user_totals, wallet_plans, active_plus, usage_totals;
$$;

revoke all on function public.admin_supabase_overview() from public;
grant execute on function public.admin_supabase_overview() to service_role;