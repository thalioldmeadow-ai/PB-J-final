-- Phase 6.3: AI usage and spending analytics for the existing admin dashboard.
--
-- All aggregation and filtering happens in one server-only RPC. Actual spend
-- comes from settled usage events with estimated_usage = false; estimated spend
-- comes from events where the provider did not return exact usage. Held
-- reservations are reported separately and are never added to actual spend.

create or replace function public.admin_ai_analytics(
  p_start timestamptz,
  p_end timestamptz,
  p_provider text default null,
  p_model text default null,
  p_action text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'bad_date_range' using errcode = 'P0001';
  end if;

  with
  filtered as (
    select e.*, coalesce(pr.display_name, 'User ' || left(e.user_id::text, 8)) as user_label
    from public.ai_usage_events e
    left join public.profiles pr on pr.id = e.user_id
    where e.created_at >= p_start
      and e.created_at < p_end
      and (p_provider is null or e.provider = p_provider)
      and (p_model is null or e.model = p_model)
      and (p_action is null or e.action = p_action)
  ),
  today_filtered as (
    select e.*
    from public.ai_usage_events e
    where e.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
      and e.created_at < ((date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day')
      and (p_provider is null or e.provider = p_provider)
      and (p_model is null or e.model = p_model)
      and (p_action is null or e.action = p_action)
  ),
  month_filtered as (
    select e.*
    from public.ai_usage_events e
    where e.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
      and e.created_at < ((date_trunc('month', now() at time zone 'utc') at time zone 'utc') + interval '1 month')
      and (p_provider is null or e.provider = p_provider)
      and (p_model is null or e.model = p_model)
      and (p_action is null or e.action = p_action)
  ),
  summary as (
    select
      count(*)::bigint as total_requests,
      count(*) filter (where status = 'success')::bigint as successful_requests,
      count(*) filter (where status = 'failed')::bigint as failed_requests,
      coalesce(sum(credits) filter (where status = 'success'), 0) as credits_used,
      coalesce(sum(cost_aud) filter (where estimated_usage = false), 0) as actual_spend_aud,
      coalesce(sum(cost_aud) filter (where estimated_usage = true), 0) as estimated_spend_aud,
      coalesce(sum(cost_aud), 0) as recorded_spend_aud
    from filtered
  ),
  today_metrics as (
    select
      coalesce(sum(cost_aud) filter (where estimated_usage = false), 0) as actual_spend_aud,
      coalesce(sum(cost_aud) filter (where estimated_usage = true), 0) as estimated_spend_aud
    from today_filtered
  ),
  month_metrics as (
    select
      coalesce(sum(cost_aud) filter (where estimated_usage = false), 0) as actual_spend_aud,
      coalesce(sum(cost_aud) filter (where estimated_usage = true), 0) as estimated_spend_aud
    from month_filtered
  ),
  reserved as (
    select
      coalesce(sum(reserved_aud) filter (where status = 'reserved' and expires_at > now()), 0) as reserved_aud,
      coalesce(sum(reserved_aud) filter (where status = 'uncertain'), 0) as uncertain_reserved_aud
    from public.ai_spend_reservations
  ),
  history_filtered as (
    select * from filtered
    where v_search is null
      or request_id ilike '%' || v_search || '%'
      or provider ilike '%' || v_search || '%'
      or model ilike '%' || v_search || '%'
      or action ilike '%' || v_search || '%'
      or user_label ilike '%' || v_search || '%'
  ),
  history_count as (
    select count(*)::bigint as total from history_filtered
  ),
  history_rows as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'requestId', request_id,
          'userLabel', user_label,
          'userShortId', left(user_id::text, 8),
          'action', action,
          'model', model,
          'provider', provider,
          'credits', credits,
          'actualCostAud', case when estimated_usage then 0 else cost_aud end,
          'estimatedCostAud', case when estimated_usage then cost_aud else 0 end,
          'costAud', cost_aud,
          'status', status,
          'estimated', estimated_usage,
          'createdAt', created_at
        )
        order by created_at desc
      ),
      '[]'::jsonb
    ) as value
    from (
      select * from history_filtered
      order by created_at desc
      limit v_limit offset v_offset
    ) h
  ),
  by_provider as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'provider', provider,
      'requests', requests,
      'successful', successful,
      'failed', failed,
      'credits', credits,
      'actualCostAud', actual_cost_aud,
      'estimatedCostAud', estimated_cost_aud,
      'costAud', cost_aud
    ) order by cost_aud desc, requests desc), '[]'::jsonb) as value
    from (
      select
        provider,
        count(*)::bigint as requests,
        count(*) filter (where status = 'success')::bigint as successful,
        count(*) filter (where status = 'failed')::bigint as failed,
        coalesce(sum(credits) filter (where status = 'success'), 0) as credits,
        coalesce(sum(cost_aud) filter (where estimated_usage = false), 0) as actual_cost_aud,
        coalesce(sum(cost_aud) filter (where estimated_usage = true), 0) as estimated_cost_aud,
        coalesce(sum(cost_aud), 0) as cost_aud
      from filtered
      group by provider
    ) rows
  ),
  by_model as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'provider', provider,
      'model', model,
      'requests', requests,
      'successful', successful,
      'failed', failed,
      'credits', credits,
      'actualCostAud', actual_cost_aud,
      'estimatedCostAud', estimated_cost_aud,
      'costAud', cost_aud
    ) order by cost_aud desc, requests desc), '[]'::jsonb) as value
    from (
      select
        provider,
        model,
        count(*)::bigint as requests,
        count(*) filter (where status = 'success')::bigint as successful,
        count(*) filter (where status = 'failed')::bigint as failed,
        coalesce(sum(credits) filter (where status = 'success'), 0) as credits,
        coalesce(sum(cost_aud) filter (where estimated_usage = false), 0) as actual_cost_aud,
        coalesce(sum(cost_aud) filter (where estimated_usage = true), 0) as estimated_cost_aud,
        coalesce(sum(cost_aud), 0) as cost_aud
      from filtered
      group by provider, model
    ) rows
  ),
  by_action as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'action', action,
      'requests', requests,
      'successful', successful,
      'failed', failed,
      'credits', credits,
      'actualCostAud', actual_cost_aud,
      'estimatedCostAud', estimated_cost_aud,
      'costAud', cost_aud
    ) order by cost_aud desc, requests desc), '[]'::jsonb) as value
    from (
      select
        action,
        count(*)::bigint as requests,
        count(*) filter (where status = 'success')::bigint as successful,
        count(*) filter (where status = 'failed')::bigint as failed,
        coalesce(sum(credits) filter (where status = 'success'), 0) as credits,
        coalesce(sum(cost_aud) filter (where estimated_usage = false), 0) as actual_cost_aud,
        coalesce(sum(cost_aud) filter (where estimated_usage = true), 0) as estimated_cost_aud,
        coalesce(sum(cost_aud), 0) as cost_aud
      from filtered
      group by action
    ) rows
  ),
  by_user as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'userLabel', user_label,
      'userShortId', user_short_id,
      'requests', requests,
      'successful', successful,
      'failed', failed,
      'credits', credits,
      'actualCostAud', actual_cost_aud,
      'estimatedCostAud', estimated_cost_aud,
      'costAud', cost_aud
    ) order by cost_aud desc, requests desc), '[]'::jsonb) as value
    from (
      select
        user_label,
        left(user_id::text, 8) as user_short_id,
        count(*)::bigint as requests,
        count(*) filter (where status = 'success')::bigint as successful,
        count(*) filter (where status = 'failed')::bigint as failed,
        coalesce(sum(credits) filter (where status = 'success'), 0) as credits,
        coalesce(sum(cost_aud) filter (where estimated_usage = false), 0) as actual_cost_aud,
        coalesce(sum(cost_aud) filter (where estimated_usage = true), 0) as estimated_cost_aud,
        coalesce(sum(cost_aud), 0) as cost_aud
      from filtered
      group by user_label, user_id
      order by cost_aud desc, requests desc
      limit 50
    ) rows
  ),
  timeseries as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', day,
      'requests', requests,
      'successful', successful,
      'failed', failed,
      'credits', credits,
      'actualCostAud', actual_cost_aud,
      'estimatedCostAud', estimated_cost_aud,
      'costAud', cost_aud
    ) order by day), '[]'::jsonb) as value
    from (
      select
        to_char(date_trunc('day', created_at at time zone 'utc'), 'YYYY-MM-DD') as day,
        count(*)::bigint as requests,
        count(*) filter (where status = 'success')::bigint as successful,
        count(*) filter (where status = 'failed')::bigint as failed,
        coalesce(sum(credits) filter (where status = 'success'), 0) as credits,
        coalesce(sum(cost_aud) filter (where estimated_usage = false), 0) as actual_cost_aud,
        coalesce(sum(cost_aud) filter (where estimated_usage = true), 0) as estimated_cost_aud,
        coalesce(sum(cost_aud), 0) as cost_aud
      from filtered
      group by 1
    ) rows
  ),
  options as (
    select
      coalesce(array_agg(distinct provider order by provider), '{}'::text[]) as providers,
      coalesce(array_agg(distinct model order by model), '{}'::text[]) as models,
      coalesce(array_agg(distinct action order by action), '{}'::text[]) as actions
    from public.ai_usage_events
    where created_at >= p_start and created_at < p_end
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'summary', jsonb_build_object(
      'totalRequests', summary.total_requests,
      'successfulRequests', summary.successful_requests,
      'failedRequests', summary.failed_requests,
      'cancelledRequests', null,
      'cancelledAvailable', false,
      'cancelledReason', 'No cancelled status is recorded in ai_usage_events or credit_requests.',
      'creditsUsed', summary.credits_used,
      'actualSpendAud', summary.actual_spend_aud,
      'estimatedSpendAud', summary.estimated_spend_aud,
      'recordedSpendAud', summary.recorded_spend_aud,
      'actualSpendTodayAud', today_metrics.actual_spend_aud,
      'estimatedSpendTodayAud', today_metrics.estimated_spend_aud,
      'actualSpendMonthAud', month_metrics.actual_spend_aud,
      'estimatedSpendMonthAud', month_metrics.estimated_spend_aud,
      'reservedAud', reserved.reserved_aud,
      'uncertainReservedAud', reserved.uncertain_reserved_aud,
      'heldReservedAud', reserved.reserved_aud + reserved.uncertain_reserved_aud,
      'averageCostPerRequestAud', case
        when summary.total_requests > 0
          then round(summary.recorded_spend_aud / summary.total_requests, 6)
        else 0
      end,
      'averageActualCostPerRequestAud', case
        when summary.successful_requests > 0
          then round(summary.actual_spend_aud / summary.successful_requests, 6)
        else 0
      end
    ),
    'timeseries', timeseries.value,
    'byProvider', by_provider.value,
    'byModel', by_model.value,
    'byAction', by_action.value,
    'byUser', by_user.value,
    'historyTotal', history_count.total,
    'history', history_rows.value,
    'options', jsonb_build_object(
      'providers', options.providers,
      'models', options.models,
      'actions', options.actions
    )
  )
  into v_result
  from summary, today_metrics, month_metrics, reserved, history_count,
       history_rows, timeseries, by_provider, by_model, by_action, by_user, options;

  return v_result;
end;
$$;

revoke all on function public.admin_ai_analytics(timestamptz, timestamptz, text, text, text, text, integer, integer) from public;
grant execute on function public.admin_ai_analytics(timestamptz, timestamptz, text, text, text, text, integer, integer) to service_role;