-- Enable RLS before exposing Korben data to the browser.
create table if not exists organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table organizations enable row level security;
alter table businesses enable row level security;
alter table projects enable row level security;
alter table departments enable row level security;
alter table agents enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table objectives enable row level security;
alter table tasks enable row level security;
alter table agent_runs enable row level security;
alter table approvals enable row level security;
alter table activity_events enable row level security;
alter table organization_memberships enable row level security;

create index if not exists idx_memberships_user on organization_memberships(user_id);
create index if not exists idx_memberships_org on organization_memberships(organization_id);
