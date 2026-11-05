-- Phase 3: administrator audit hardening.
--
-- The existing JSON admin token remains a temporary break-glass credential.
-- When Supabase Auth is configured, the server verifies a Supabase access token
-- and checks public.admin_users. Every mutating admin action is recorded in
-- public.admin_audit_log through the service-role-only RPC below.
--
-- admin_audit_log is append-only: normal users have no access at all, and even
-- the service role cannot UPDATE or DELETE existing audit rows.

alter table public.admin_audit_log
  add column if not exists actor_type text not null default 'system',
  add column if not exists actor_id text,
  add column if not exists success boolean not null default true,
  add column if not exists error_code text,
  add column if not exists request_id text,
  -- Legacy app accounts use 40-hex ids, while Supabase accounts use UUIDs.
  -- Keep the optional UUID foreign key and a text reference for either form.
  add column if not exists target_user_ref text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_audit_log_actor_type_check'
      and conrelid = 'public.admin_audit_log'::regclass
  ) then
    alter table public.admin_audit_log
      add constraint admin_audit_log_actor_type_check
      check (actor_type in ('admin_user', 'break_glass', 'system'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_audit_log_success_check'
      and conrelid = 'public.admin_audit_log'::regclass
  ) then
    alter table public.admin_audit_log
      add constraint admin_audit_log_success_check
      check (success in (true, false));
  end if;
end;
$$;

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_action_created_idx
  on public.admin_audit_log (action, created_at desc);

create index if not exists admin_audit_log_request_idx
  on public.admin_audit_log (request_id)
  where request_id is not null;

create index if not exists admin_audit_log_target_ref_idx
  on public.admin_audit_log (target_user_ref, created_at desc)
  where target_user_ref is not null;

-- Audit records are evidence, not mutable application rows.
create or replace function public.prevent_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'admin_audit_log_is_append_only' using errcode = 'P0001';
end;
$$;

drop trigger if exists admin_audit_log_append_only on public.admin_audit_log;
create trigger admin_audit_log_append_only
  before update or delete on public.admin_audit_log
  for each row execute function public.prevent_admin_audit_mutation();

/**
 * Insert one audit record. `admin_user` requires a real administrator row;
 * `break_glass` is the transitional token path and must not claim a user id;
 * `system` is reserved for migrations or server maintenance.
 *
 * The caller is responsible for passing only safe metadata. Never pass tokens,
 * passwords, API keys, prompts, journal text or ciphertext.
 */
create or replace function public.record_admin_audit(
  p_admin_user_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_action text,
  p_target_user_id uuid default null,
  p_target_user_ref text default null,
  p_success boolean default true,
  p_error_code text default null,
  p_request_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_actor_id text;
begin
  if p_actor_type not in ('admin_user', 'break_glass', 'system') then
    raise exception 'bad_admin_actor_type' using errcode = 'P0001';
  end if;

  if p_action is null or char_length(btrim(p_action)) = 0 then
    raise exception 'bad_admin_action' using errcode = 'P0001';
  end if;

  if p_actor_type = 'admin_user' then
    if p_admin_user_id is null or not exists (
      select 1 from public.admin_users where user_id = p_admin_user_id
    ) then
      raise exception 'admin_user_not_authorized' using errcode = 'P0001';
    end if;
    v_actor_id := coalesce(nullif(btrim(p_actor_id), ''), p_admin_user_id::text);
  elsif p_actor_type = 'break_glass' then
    if p_admin_user_id is not null then
      raise exception 'break_glass_must_not_claim_user' using errcode = 'P0001';
    end if;
    if p_actor_id is null or char_length(btrim(p_actor_id)) = 0 then
      raise exception 'break_glass_actor_required' using errcode = 'P0001';
    end if;
    v_actor_id := left(btrim(p_actor_id), 120);
  else
    if p_admin_user_id is not null then
      raise exception 'system_actor_must_not_claim_user' using errcode = 'P0001';
    end if;
    v_actor_id := left(coalesce(nullif(btrim(p_actor_id), ''), 'system'), 120);
  end if;

  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'bad_admin_audit_metadata' using errcode = 'P0001';
  end if;

  insert into public.admin_audit_log (
    admin_user_id, actor_type, actor_id, action, target_user_id,
    target_user_ref, success, error_code, request_id, metadata
  )
  values (
    p_admin_user_id, p_actor_type, v_actor_id, left(btrim(p_action), 120),
    p_target_user_id, nullif(left(coalesce(p_target_user_ref, ''), 120), ''),
    coalesce(p_success, true),
    nullif(left(coalesce(p_error_code, ''), 120), ''),
    nullif(left(coalesce(p_request_id, ''), 120), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.prevent_admin_audit_mutation() from public;
revoke all on function public.record_admin_audit(uuid, text, text, text, uuid, text, boolean, text, text, jsonb) from public;

grant execute on function public.record_admin_audit(uuid, text, text, text, uuid, text, boolean, text, text, jsonb) to service_role;

-- No normal-user policy is added to admin_audit_log. It remains server-only,
-- with the service role performing inserts through the RPC above.

-- TRUNCATE bypasses row-level triggers. The audit table is append-only even for
-- the trusted service role, so remove that capability explicitly. Ordinary
-- maintenance can still delete a whole database or table as its owner, which is
-- outside the application's authority.
revoke truncate on public.admin_audit_log from service_role;

-- Phase 1 granted safe profile columns and then revoked table-wide UPDATE.
-- Re-apply the column grant so users can edit only their own safe profile
-- fields. The table-wide UPDATE privilege stays revoked, so role, ownership,
-- wallet, subscription and credit fields remain server-only.
revoke update on public.profiles from authenticated;
grant update (display_name, age_band, settings, updated_at)
  on public.profiles to authenticated;
