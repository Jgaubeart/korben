-- Sentinel-only, read-only browser inspection capability.
with target_org as (
  select d.organization_id
  from public.agents a
  join public.departments d on d.id = a.department_id
  where a.system_key = 'qa_engineer'
  limit 1
)
insert into public.tools (
  organization_id,
  system_key,
  name,
  provider,
  description,
  risk_level,
  status,
  config
)
select
  organization_id,
  'browser.inspect',
  'Sandboxed Browser Inspection',
  'playwright',
  'Constrained ephemeral Chromium inspection for responsive QA on configured project deployments.',
  0,
  'available',
  '{
    "actions":["inspect"],
    "timeout_ms":20000,
    "network":"selected-vercel-project-only",
    "downloads":false,
    "max_actions":16,
    "viewport_min":[320,480],
    "viewport_max":[1920,1200],
    "text_scale_percent":[100,125,150,175,200]
  }'::jsonb
from target_org
on conflict (organization_id, system_key) do update
set
  name = excluded.name,
  provider = excluded.provider,
  description = excluded.description,
  risk_level = excluded.risk_level,
  status = excluded.status,
  config = excluded.config;

insert into public.agent_tool_permissions (
  agent_id,
  tool_id,
  can_execute,
  max_approval_level
)
select
  a.id,
  t.id,
  true,
  0
from public.agents a
join public.departments d on d.id = a.department_id
join public.tools t
  on t.organization_id = d.organization_id
 and t.system_key = 'browser.inspect'
where a.system_key = 'qa_engineer'
on conflict (agent_id, tool_id) do update
set
  can_execute = true,
  max_approval_level = 0;

update public.agent_tool_permissions p
set can_execute = false,
    max_approval_level = 0
from public.tools t,
     public.agents a
where p.tool_id = t.id
  and p.agent_id = a.id
  and t.system_key = 'browser.inspect'
  and a.system_key <> 'qa_engineer';
