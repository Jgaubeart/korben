create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  provider text not null,
  status text not null default 'not_configured',
  connection_type text not null default 'external',
  config jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  source_id uuid references public.knowledge_sources(id) on delete set null,
  entry_type text not null check (entry_type in ('document','sop','memory','decision','fact')),
  title text not null,
  content text not null,
  source_uri text,
  status text not null default 'active',
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_by_agent_id uuid references public.agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_sources_org_idx
  on public.knowledge_sources(organization_id, provider);
create index if not exists knowledge_entries_scope_idx
  on public.knowledge_entries(organization_id, project_id, entry_type);
create index if not exists knowledge_entries_tags_idx
  on public.knowledge_entries using gin(tags);

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_entries enable row level security;

drop policy if exists "org members manage knowledge sources" on public.knowledge_sources;
create policy "org members manage knowledge sources"
on public.knowledge_sources for all
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

drop policy if exists "org members manage knowledge entries" on public.knowledge_entries;
create policy "org members manage knowledge entries"
on public.knowledge_entries for all
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

with target_org as (
  select b.organization_id
  from public.projects p
  join public.businesses b on b.id = p.business_id
  where p.slug = 'general-workspace'
  limit 1
),
seed(name,provider,status,connection_type,config) as (
  values
    ('G-Brain','gbrain','not_configured','http',jsonb_build_object('purpose','semantic retrieval')),
    ('Obsidian Vault','obsidian','not_configured','bridge',jsonb_build_object('purpose','markdown source of truth'))
)
insert into public.knowledge_sources (
  organization_id,name,provider,status,connection_type,config
)
select target_org.organization_id, seed.name, seed.provider, seed.status, seed.connection_type, seed.config
from target_org cross join seed
where not exists (
  select 1 from public.knowledge_sources ks
  where ks.organization_id = target_org.organization_id
    and ks.provider = seed.provider
);
