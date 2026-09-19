with target_org as (
  select b.organization_id
  from public.projects p
  join public.businesses b on b.id = p.business_id
  where p.slug = 'general-workspace'
  limit 1
)
update public.tools t
set status = 'available',
    description = 'Search the shared Korben knowledge layer. Uses governed local entries now and can be backed by G-Brain when connected.'
from target_org
where t.organization_id = target_org.organization_id
  and t.system_key = 'knowledge.search';

insert into public.agent_tool_permissions(agent_id, tool_id, max_approval_level)
select a.id, t.id, 0
from public.agents a
join public.departments d on d.id = a.department_id
join public.tools t
  on t.organization_id = d.organization_id
 and t.system_key = 'knowledge.search'
on conflict (agent_id, tool_id) do update
set can_execute = true,
    max_approval_level = 0;
