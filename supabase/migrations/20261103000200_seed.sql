-- Seed the credit rules that the running application already uses.
-- `on conflict do nothing` is deliberate: re-running the migration or applying
-- it to a project that already has admin-edited settings must not silently
-- overwrite those settings.

insert into public.credit_actions (key, label, description, cost, updated_at)
values
  ('simple_message', 'Simple AI message', 'A short conversational reply.', 1, '2026-11-02T07:15:57.994Z'),
  ('daily_plan', 'Daily plan generation', 'Building a realistic day or week plan.', 3, '2026-11-02T07:15:57.994Z'),
  ('detailed_analysis', 'Detailed analysis', 'Reviewing records, trends or a budget in depth.', 5, '2026-11-02T07:15:57.994Z'),
  ('complex_task', 'Complex AI task', 'Working with attachments or a larger task.', 10, '2026-11-02T07:15:57.994Z')
on conflict (key) do nothing;

insert into public.credit_plans (
  id,
  label,
  credits_per_period,
  period_days,
  requests_per_day,
  tokens_per_day,
  memory_limit,
  history_limit,
  history_char_limit,
  max_attachments,
  advanced_features,
  updated_at
)
values
  ('free', 'Free', 100, 1, 20, 60000, 6, 8, 4000, 0, false, '2026-11-02T07:15:57.994Z'),
  ('plus', 'Plus', 1000, 30, 120, 300000, 30, 24, 16000, 4, true, '2026-11-02T07:15:57.994Z')
on conflict (id) do nothing;

insert into public.ai_settings (id, overrides)
values (1, '{}'::jsonb)
on conflict (id) do nothing;
