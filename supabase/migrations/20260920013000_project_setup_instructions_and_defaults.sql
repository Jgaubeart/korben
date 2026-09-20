-- Project setup instructions and safe default workspaces.
alter table public.projects
  add column if not exists setup_instructions text;

update public.projects
set name = 'KorbenOS'
where slug = 'korben-os';

update public.projects
set setup_instructions = case slug
  when 'general-workspace' then 'General-purpose project-agnostic workspace for personal assistant work, research, review, planning, and delegation that does not belong to a specific configured project. Do not assume access to any repository, deployment, or business system from this workspace.'
  when 'korben-os' then 'Korben OS is the active product workspace for building and operating Korben itself. Use the configured GitHub repository and Vercel project for Korben-specific engineering and runtime work.'
  else setup_instructions
end
where slug in ('general-workspace','korben-os');

update public.projects
set github_repo = null,
    vercel_project_id = null
where slug = 'general-workspace';

delete from public.projects
where slug = 'cabinet-genies-portal';
