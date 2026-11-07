create table if not exists public.plumb_sync (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  revision bigint not null default 1
);

alter table public.plumb_sync
  add column if not exists revision bigint not null default 1;

update public.plumb_sync
set revision = 1
where revision is null;

-- The shared workspace intentionally uses a fixed UUID that is not a login user.
-- Remove the auth-users foreign key so every authenticated account can read/write this one row.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.plumb_sync'::regclass
    and contype = 'f'
    and conkey = array[(select attnum from pg_attribute where attrelid = 'public.plumb_sync'::regclass and attname = 'user_id')];
  if constraint_name is not null then
    execute format('alter table public.plumb_sync drop constraint %I', constraint_name);
  end;
end $$;

alter table public.plumb_sync enable row level security;

revoke all on public.plumb_sync from anon;
grant select, insert, update on public.plumb_sync to authenticated;

drop policy if exists "Users can read their own Plumb sync" on public.plumb_sync;
drop policy if exists "Users can insert their own Plumb sync" on public.plumb_sync;
drop policy if exists "Users can update their own Plumb sync" on public.plumb_sync;
drop policy if exists "Authenticated users can read the shared Plumb sync" on public.plumb_sync;
drop policy if exists "Authenticated users can insert the shared Plumb sync" on public.plumb_sync;
drop policy if exists "Authenticated users can update the shared Plumb sync" on public.plumb_sync;

create policy "Authenticated users can read the shared Plumb sync"
  on public.plumb_sync
  for select
  to authenticated
  using (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

create policy "Authenticated users can insert the shared Plumb sync"
  on public.plumb_sync
  for insert
  to authenticated
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

create policy "Authenticated users can update the shared Plumb sync"
  on public.plumb_sync
  for update
  to authenticated
  using (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);
