with target_org as (
  select b.organization_id
  from public.projects p
  join public.businesses b on b.id = p.business_id
  where p.slug = 'general-workspace'
  limit 1
)
insert into public.knowledge_sources (
  organization_id,name,provider,status,connection_type,config,last_sync_at
)
select
  target_org.organization_id,
  'Korben System',
  'internal',
  'connected',
  'database',
  jsonb_build_object('purpose','canonical operating policies'),
  now()
from target_org
where not exists (
  select 1 from public.knowledge_sources ks
  where ks.organization_id = target_org.organization_id
    and ks.provider = 'internal'
);

with target_org as (
  select b.organization_id
  from public.projects p
  join public.businesses b on b.id = p.business_id
  where p.slug = 'general-workspace'
  limit 1
),
internal_source as (
  select ks.id, ks.organization_id
  from public.knowledge_sources ks
  join target_org t on t.organization_id = ks.organization_id
  where ks.provider = 'internal'
  limit 1
),
seed(entry_type,title,content,tags,metadata) as (
  values
    (
      'sop',
      'Korben Approval Levels',
      'L0 actions are read, search, test, planning, and documentation. L1 actions are reversible feature-branch edits and preview deployments. L2 actions include merge, database migration, RLS, permissions, configuration, and infrastructure changes and require explicit owner approval. L3 actions include production deployment, destructive data changes, billing, permissions with broad impact, and customer or external sends and require explicit owner approval.',
      array['korben','approvals','safety'],
      jsonb_build_object('canonical',true,'version',1)
    ),
    (
      'sop',
      'Project Scope Isolation',
      'Every external tool call must be bound to the currently selected Korben project. GitHub actions may only target that project''s configured repository. Vercel actions may only target that project''s configured Vercel project. General Workspace is neutral and must not inherit a business or repository context implicitly.',
      array['korben','projects','security'],
      jsonb_build_object('canonical',true,'version',1)
    ),
    (
      'sop',
      'GitHub Execution Safety',
      'Automatic L1 GitHub writes must occur on a feature branch. Korben may not write directly to main or master through the L1 tool. Pull request creation is L1. Merging is L2 and must wait for explicit owner approval.',
      array['korben','github','safety'],
      jsonb_build_object('canonical',true,'version',1)
    ),
    (
      'sop',
      'Agent Tool Permissions',
      'Agents may use only tools granted through agent_tool_permissions. Tool risk level must not exceed the agent permission ceiling. The Tool Gateway validates authentication, project scope, agent permission, approval state, and writes run events before and after execution.',
      array['korben','agents','tools','security'],
      jsonb_build_object('canonical',true,'version',1)
    ),
    (
      'fact',
      'Korben Shared Brain Model',
      'All Korben agents use one governed knowledge interface. Internal knowledge_entries provide the fallback store. G-Brain can provide semantic retrieval when connected. Obsidian is intended to be a human-editable Markdown source feeding that shared knowledge layer.',
      array['korben','brain','memory'],
      jsonb_build_object('canonical',true,'version',1)
    )
)
insert into public.knowledge_entries (
  organization_id,source_id,entry_type,title,content,status,tags,metadata
)
select
  internal_source.organization_id,
  internal_source.id,
  seed.entry_type,
  seed.title,
  seed.content,
  'active',
  seed.tags,
  seed.metadata
from internal_source cross join seed
where not exists (
  select 1
  from public.knowledge_entries ke
  where ke.organization_id = internal_source.organization_id
    and ke.title = seed.title
    and ke.status = 'active'
);
