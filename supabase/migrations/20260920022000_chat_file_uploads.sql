-- Private chat attachments for Korben conversations.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'korben-chat-files',
  'korben-chat-files',
  false,
  20971520,
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/xml',
    'text/xml',
    'text/html',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null unique,
  openai_file_id text,
  openai_input_type text not null default 'input_file'
    check (openai_input_type in ('input_file','input_image')),
  created_at timestamptz not null default now()
);

create index if not exists message_attachments_conversation_idx
  on public.message_attachments(conversation_id, created_at);

create index if not exists message_attachments_message_idx
  on public.message_attachments(message_id);

alter table public.message_attachments enable row level security;

drop policy if exists members_read_message_attachments on public.message_attachments;
create policy members_read_message_attachments
on public.message_attachments for select
using (private.is_org_member(private.conversation_org_id(conversation_id)));

drop policy if exists members_insert_message_attachments on public.message_attachments;
create policy members_insert_message_attachments
on public.message_attachments for insert
with check (
  uploaded_by = auth.uid()
  and private.is_org_member(private.conversation_org_id(conversation_id))
);

drop policy if exists members_update_message_attachments on public.message_attachments;
create policy members_update_message_attachments
on public.message_attachments for update
using (
  uploaded_by = auth.uid()
  and private.is_org_member(private.conversation_org_id(conversation_id))
)
with check (
  uploaded_by = auth.uid()
  and private.is_org_member(private.conversation_org_id(conversation_id))
);

drop policy if exists members_delete_message_attachments on public.message_attachments;
create policy members_delete_message_attachments
on public.message_attachments for delete
using (
  uploaded_by = auth.uid()
  and private.is_org_member(private.conversation_org_id(conversation_id))
);

drop policy if exists chat_files_select_own on storage.objects;
create policy chat_files_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'korben-chat-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists chat_files_insert_own on storage.objects;
create policy chat_files_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'korben-chat-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists chat_files_delete_own on storage.objects;
create policy chat_files_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'korben-chat-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);
