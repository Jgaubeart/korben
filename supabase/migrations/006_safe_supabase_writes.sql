with target_org as (
  select b.organization_id
  from public.projects p
  join public.businesses b on b.id = p.business_id
  where p.slug = 'general-workspace'
  limit 1
)
insert into public.tools (
  organization_id,
  system_key,
  name,
  provider,
  description,
  risk_level,
  status
)
select
  target_org.organization_id,
  'supabase.write',
  'Supabase Data Write',
  'supabase',
  'Insert and update rows through the signed-in user RLS boundary. No deletes or schema changes.',
  1,
  'available'
from target_org
on conflict (organization_id, system_key) do update
set name = excluded.name,
    provider = excluded.provider,
    description = excluded.description,
    risk_level = excluded.risk_level,
    status = excluded.status;

with perms(agent_key, max_level) as (
  values
    ('database_engineer', 1),
    ('backend_engineer', 1)
)
insert into public.agent_tool_permissions(agent_id, tool_id, max_approval_level)
select a.id, t.id, perms.max_level
from perms
join public.agents a on a.system_key = perms.agent_key
join public.departments d on d.id = a.department_id
join public.tools t
  on t.organization_id = d.organization_id
 and t.system_key = 'supabase.write'
on conflict (agent_id, tool_id) do update
set can_execute = true,
    max_approval_level = excluded.max_approval_level;
