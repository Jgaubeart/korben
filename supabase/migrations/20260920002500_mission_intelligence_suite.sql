-- Mission intelligence primitives for Korben OS.
-- Applied to production Supabase on 2026-09-19.

alter table public.objectives
  add column if not exists execution_mode text not null default 'sequential',
  add column if not exists mission_summary text,
  add column if not exists report_back text,
  add column if not exists last_reported_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'objectives_execution_mode_check'
  ) then
    alter table public.objectives
      add constraint objectives_execution_mode_check
      check (execution_mode in ('sequential','fleet'));
  end if;
end $$;

alter table public.tasks
  add column if not exists stage text not null default 'queued',
  add column if not exists parallel_group integer not null default 0,
  add column if not exists progress_message text,
  add column if not exists last_heartbeat_at timestamptz;

create table if not exists public.open_loops (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  title text not null,
  detail text,
  status text not null default 'open',
  waiting_on text,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'open_loops_status_check'
  ) then
    alter table public.open_loops
      add constraint open_loops_status_check
      check (status in ('open','waiting','closed'));
  end if;
end $$;

create table if not exists public.action_receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  objective_id uuid references public.objectives(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  run_id uuid references public.agent_runs(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  tool_system_key text,
  action text not null,
  status text not null default 'complete',
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  objective_id uuid references public.objectives(id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text not null,
  urgency text not null default 'normal',
  status text not null default 'unread',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_status_check'
  ) then
    alter table public.notifications
      add constraint notifications_status_check
      check (status in ('unread','read','held'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_urgency_check'
  ) then
    alter table public.notifications
      add constraint notifications_urgency_check
      check (urgency in ('low','normal','high'));
  end if;
end $$;

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  goal text not null,
  duration_minutes integer not null default 30,
  status text not null default 'active',
  interruptions integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  report text
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'focus_sessions_status_check'
  ) then
    alter table public.focus_sessions
      add constraint focus_sessions_status_check
      check (status in ('active','paused','complete','cancelled'));
  end if;
end $$;

alter table public.open_loops enable row level security;
alter table public.action_receipts enable row level security;
alter table public.notifications enable row level security;
alter table public.focus_sessions enable row level security;

drop policy if exists members_manage_open_loops on public.open_loops;
create policy members_manage_open_loops on public.open_loops
for all
using (private.is_org_member(private.project_org_id(project_id)))
with check (private.is_org_member(private.project_org_id(project_id)));

drop policy if exists members_manage_action_receipts on public.action_receipts;
create policy members_manage_action_receipts on public.action_receipts
for all
using (private.is_org_member(private.project_org_id(project_id)))
with check (private.is_org_member(private.project_org_id(project_id)));

drop policy if exists members_manage_notifications on public.notifications;
create policy members_manage_notifications on public.notifications
for all
using (private.is_org_member(private.project_org_id(project_id)))
with check (private.is_org_member(private.project_org_id(project_id)));

drop policy if exists members_manage_focus_sessions on public.focus_sessions;
create policy members_manage_focus_sessions on public.focus_sessions
for all
using (private.is_org_member(private.project_org_id(project_id)))
with check (private.is_org_member(private.project_org_id(project_id)));

create index if not exists open_loops_project_status_idx
  on public.open_loops(project_id,status,created_at desc);
create index if not exists action_receipts_project_created_idx
  on public.action_receipts(project_id,created_at desc);
create index if not exists notifications_project_status_idx
  on public.notifications(project_id,status,created_at desc);
create index if not exists tasks_objective_parallel_idx
  on public.tasks(objective_id,parallel_group,sequence);
