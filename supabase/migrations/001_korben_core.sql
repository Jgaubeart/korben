-- Korben OS core work model
create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  slug text not null,
  github_repo text,
  vercel_project_id text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (business_id, slug)
);

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  name text not null,
  role text not null,
  system_key text not null unique,
  status text not null default 'idle',
  capabilities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  input_mode text not null default 'text' check (input_mode in ('text','voice','system')),
  created_at timestamptz not null default now()
);

create table if not exists objectives (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'planning',
  priority text not null default 'normal',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives(id) on delete cascade,
  assigned_agent_id uuid references agents(id) on delete set null,
  parent_task_id uuid references tasks(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'queued',
  sequence integer not null default 0,
  depends_on uuid[] not null default '{}',
  acceptance_criteria jsonb not null default '[]'::jsonb,
  result_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  status text not null default 'queued',
  model text,
  trace_id text,
  input jsonb,
  output jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid references objectives(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  action_type text not null,
  risk_level integer not null default 2,
  status text not null default 'pending',
  request_payload jsonb not null default '{}'::jsonb,
  decision_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  objective_id uuid references objectives(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_business on projects(business_id);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);
create index if not exists idx_objectives_project on objectives(project_id, created_at desc);
create index if not exists idx_tasks_objective on tasks(objective_id, sequence);
create index if not exists idx_runs_task on agent_runs(task_id, created_at desc);
create index if not exists idx_activity_project on activity_events(project_id, created_at desc);
