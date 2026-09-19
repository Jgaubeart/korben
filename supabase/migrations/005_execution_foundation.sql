create table if not exists public.tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  system_key text not null,
  name text not null,
  provider text not null,
  description text,
  status text not null default 'available',
  risk_level integer not null default 0 check (risk_level between 0 and 3),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, system_key)
);

create table if not exists public.agent_tool_permissions (
  agent_id uuid not null references public.agents(id) on delete cascade,
  tool_id uuid not null references public.tools(id) on delete cascade,
  can_execute boolean not null default true,
  max_approval_level integer not null default 0 check (max_approval_level between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (agent_id, tool_id)
);

create table if not exists public.run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.agent_runs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  event_type text not null,
  tool_system_key text,
  status text not null default 'info',
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists run_events_project_created_idx
  on public.run_events(project_id, created_at desc);

create index if not exists run_events_run_created_idx
  on public.run_events(run_id, created_at asc);

alter table public.tools enable row level security;
alter table public.agent_tool_permissions enable row level security;
alter table public.run_events enable row level security;

drop policy if exists "org members manage tools" on public.tools;
create policy "org members manage tools"
on public.tools for all
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

drop policy if exists "org members manage agent tool permissions" on public.agent_tool_permissions;
create policy "org members manage agent tool permissions"
on public.agent_tool_permissions for all
using (private.is_org_member(private.agent_org_id(agent_id)))
with check (private.is_org_member(private.agent_org_id(agent_id)));

drop policy if exists "org members manage run events" on public.run_events;
create policy "org members manage run events"
on public.run_events for all
using (private.is_org_member(private.project_org_id(project_id)))
with check (private.is_org_member(private.project_org_id(project_id)));

with target_org as (
  select b.organization_id
  from public.projects p
  join public.businesses b on b.id = p.business_id
  where p.slug = 'general-workspace'
  limit 1
),
seed(system_key,name,provider,description,risk_level,status) as (
  values
    ('github.read','GitHub Read','github','Read repositories, branches, commits, pull requests and files.',0,'available'),
    ('github.write','GitHub Write','github','Create branches and edit files on reversible feature branches.',1,'available'),
    ('github.pr','GitHub Pull Requests','github','Create and update pull requests.',1,'available'),
    ('github.merge','GitHub Merge','github','Merge approved pull requests.',2,'available'),
    ('vercel.read','Vercel Read','vercel','Inspect projects, deployments and runtime state.',0,'available'),
    ('vercel.preview','Vercel Preview','vercel','Create and inspect non-production previews.',1,'available'),
    ('vercel.production','Vercel Production','vercel','Promote or deploy to production.',3,'available'),
    ('supabase.read','Supabase Read','supabase','Read schemas, records and project configuration.',0,'available'),
    ('supabase.sql','Supabase SQL','supabase','Execute non-DDL SQL within approved project scope.',1,'available'),
    ('supabase.migration','Supabase Migration','supabase','Apply schema migrations and RLS changes.',2,'available'),
    ('openai.orchestrate','OpenAI Orchestrator','openai','Classify intent, plan work and coordinate agent routing.',0,'available'),
    ('knowledge.search','Knowledge Search','knowledge','Search connected memory, SOP and knowledge sources.',0,'planned')
)
insert into public.tools (organization_id,system_key,name,provider,description,risk_level,status)
select target_org.organization_id, seed.system_key, seed.name, seed.provider, seed.description, seed.risk_level, seed.status
from target_org cross join seed
on conflict (organization_id, system_key) do update
set name = excluded.name,
    provider = excluded.provider,
    description = excluded.description,
    risk_level = excluded.risk_level,
    status = excluded.status;

with perms(agent_key, tool_key, max_level) as (
  values
    ('orchestrator','openai.orchestrate',0),
    ('orchestrator','knowledge.search',0),
    ('product_manager','github.read',0),
    ('solutions_architect','github.read',0),
    ('ux_ui_designer','github.read',0),
    ('frontend_engineer','github.read',0),
    ('frontend_engineer','github.write',1),
    ('frontend_engineer','github.pr',1),
    ('backend_engineer','github.read',0),
    ('backend_engineer','github.write',1),
    ('backend_engineer','github.pr',1),
    ('backend_engineer','supabase.read',0),
    ('database_engineer','supabase.read',0),
    ('database_engineer','supabase.sql',1),
    ('database_engineer','supabase.migration',2),
    ('qa_engineer','github.read',0),
    ('qa_engineer','vercel.read',0),
    ('security_reviewer','github.read',0),
    ('security_reviewer','supabase.read',0),
    ('devops_engineer','github.read',0),
    ('devops_engineer','github.pr',1),
    ('devops_engineer','github.merge',2),
    ('devops_engineer','vercel.read',0),
    ('devops_engineer','vercel.preview',1),
    ('devops_engineer','vercel.production',3)
)
insert into public.agent_tool_permissions(agent_id, tool_id, max_approval_level)
select a.id, t.id, perms.max_level
from perms
join public.agents a on a.system_key = perms.agent_key
join public.departments d on d.id = a.department_id
join public.tools t on t.organization_id = d.organization_id and t.system_key = perms.tool_key
on conflict (agent_id, tool_id) do update
set can_execute = true,
    max_approval_level = excluded.max_approval_level;
