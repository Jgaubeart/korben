-- Bounded rolling context for long-running Korben conversations.
create table if not exists public.conversation_contexts (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  summary text not null default '',
  summarized_through timestamptz,
  summarized_message_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.conversation_contexts enable row level security;

drop policy if exists members_manage_conversation_contexts on public.conversation_contexts;
create policy members_manage_conversation_contexts on public.conversation_contexts
for all
using (private.is_org_member(private.conversation_org_id(conversation_id)))
with check (private.is_org_member(private.conversation_org_id(conversation_id)));

create index if not exists conversation_contexts_updated_idx
  on public.conversation_contexts(updated_at desc);
