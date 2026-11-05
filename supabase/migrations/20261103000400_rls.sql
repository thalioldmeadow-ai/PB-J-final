-- Phase 1: Row Level Security.
--
-- Normal users can read their own profile, wallet, credit history, usage,
-- subscription, and encrypted vault records. They cannot write any financial
-- or billing table. Those writes are performed by SECURITY DEFINER functions
-- called by the server's service-role client.
--
-- Keep the service role key on the server. It bypasses RLS by design.

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.credit_actions enable row level security;
alter table public.credit_plans enable row level security;
alter table public.wallets enable row level security;
alter table public.credit_requests enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_customer_aliases enable row level security;
alter table public.revenuecat_events enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_usage_daily enable row level security;
alter table public.ai_spend_counters enable row level security;
alter table public.ai_spend_reservations enable row level security;
alter table public.ai_safety_daily enable row level security;
alter table public.ai_settings enable row level security;
alter table public.vault_records enable row level security;

-- ---------------------------------------------------------- table privileges

grant usage on schema public to anon, authenticated, service_role;

-- The service role is the server's database identity. It needs full access,
-- but it is never shipped to the browser.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Pricing is safe to show to a signed-in user.
grant select on public.credit_actions to authenticated;
grant select on public.credit_plans to authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, age_band, settings, updated_at)
  on public.profiles to authenticated;

grant select on public.wallets to authenticated;
grant select on public.credit_requests to authenticated;
grant select on public.credit_transactions to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.ai_usage_events to authenticated;
grant select on public.ai_usage_daily to authenticated;

grant select, insert, update, delete on public.vault_records to authenticated;

-- Explicitly remove write access from ordinary authenticated users. These
-- tables are written only through the server and its SECURITY DEFINER RPCs.
revoke insert, update, delete on public.profiles from authenticated;
revoke insert, update, delete on public.wallets from authenticated;
revoke insert, update, delete on public.credit_actions from authenticated;
revoke insert, update, delete on public.credit_plans from authenticated;
revoke insert, update, delete on public.credit_requests from authenticated;
revoke insert, update, delete on public.credit_transactions from authenticated;
revoke insert, update, delete on public.subscriptions from authenticated;
revoke insert, update, delete on public.billing_customer_aliases from authenticated;
revoke insert, update, delete on public.revenuecat_events from authenticated;
revoke insert, update, delete on public.ai_usage_events from authenticated;
revoke insert, update, delete on public.ai_usage_daily from authenticated;
revoke insert, update, delete on public.ai_spend_counters from authenticated;
revoke insert, update, delete on public.ai_spend_reservations from authenticated;
revoke insert, update, delete on public.ai_safety_daily from authenticated;
revoke insert, update, delete on public.ai_settings from authenticated;
revoke insert, update, delete on public.admin_users from authenticated;
revoke insert, update, delete on public.admin_audit_log from authenticated;

-- Anonymous visitors get no table access at all.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------- policies

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists wallets_select_own on public.wallets;
create policy wallets_select_own
  on public.wallets
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists credit_requests_select_own on public.credit_requests;
create policy credit_requests_select_own
  on public.credit_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists credit_transactions_select_own on public.credit_transactions;
create policy credit_transactions_select_own
  on public.credit_transactions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
  on public.subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_usage_events_select_own on public.ai_usage_events;
create policy ai_usage_events_select_own
  on public.ai_usage_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_usage_daily_select_own on public.ai_usage_daily;
create policy ai_usage_daily_select_own
  on public.ai_usage_daily
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists credit_actions_select_authenticated on public.credit_actions;
create policy credit_actions_select_authenticated
  on public.credit_actions
  for select
  to authenticated
  using (true);

drop policy if exists credit_plans_select_authenticated on public.credit_plans;
create policy credit_plans_select_authenticated
  on public.credit_plans
  for select
  to authenticated
  using (true);

drop policy if exists vault_records_select_own on public.vault_records;
create policy vault_records_select_own
  on public.vault_records
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists vault_records_insert_own on public.vault_records;
create policy vault_records_insert_own
  on public.vault_records
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists vault_records_update_own on public.vault_records;
create policy vault_records_update_own
  on public.vault_records
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists vault_records_delete_own on public.vault_records;
create policy vault_records_delete_own
  on public.vault_records
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- No authenticated policies exist for:
--   admin_users, admin_audit_log, billing_customer_aliases,
--   revenuecat_events, ai_spend_counters, ai_spend_reservations,
--   ai_safety_daily, ai_settings.
-- Those are server-only tables. is_admin() is SECURITY DEFINER and is the
-- only user-callable admin check.
