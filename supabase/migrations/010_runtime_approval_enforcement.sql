-- Raise Launch's GitHub merge permission ceiling so exact L3 owner approvals
-- can authorize production-triggering merges after deterministic runtime escalation.
update public.agent_tool_permissions p
set max_approval_level = 3
from public.agents a, public.tools t
where p.agent_id = a.id
  and p.tool_id = t.id
  and a.system_key = 'devops_engineer'
  and t.system_key = 'github.merge'
  and p.max_approval_level < 3;
