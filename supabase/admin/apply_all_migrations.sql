-- =====================================================================================

-- =====================================================================================

create schema if not exists private;
revoke all on schema private from public;
create table if not exists private.tucai_migrations (
  version text primary key,
  name text not null,
  how text not null check (how in ('applied', 'detected')),
  applied_at timestamptz not null default now()
);
revoke all on private.tucai_migrations from public;

-- ===================== supabase/migrations/0001_foundation.sql =====================
do $tucai_0001$
begin
  if exists (select 1 from private.tucai_migrations where version = '0001') then
    raise notice 'Tucaí 0001: já aplicada';
  elsif to_regclass('public.profiles') is not null then
    insert into private.tucai_migrations(version, name, how) values ('0001', '0001_foundation.sql', 'detected');
    raise notice 'Tucaí 0001: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0001_foundation: perfis, papéis, empresas (mínimo), membros, permissões, auditoria, RLS.
-- Princípio: RLS em tudo; escrita de papéis somente por funções SECURITY DEFINER.

create type public.app_role as enum (
  'customer','business_owner','business_staff','courier_partner','courier_own',
  'service_provider','platform_operator','platform_master'
);
create type public.member_role as enum ('owner','manager','attendant','kitchen','courier_own');
create type public.business_status as enum ('pending','active','suspended');

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  phone text check (phone is null or char_length(phone) <= 20),
  preferred_city_id uuid, -- FK para cities na spec de multicidades
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- user_roles (papéis globais) ----------
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------- businesses (núcleo mínimo; expandido em spec própria) ----------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  owner_id uuid not null references auth.users(id),
  status public.business_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_owner_idx on public.businesses(owner_id);
create trigger businesses_updated before update on public.businesses
  for each row execute function public.set_updated_at();

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on public.business_members(user_id);

-- ---------- matriz RBAC ----------
create table public.permissions (code text primary key);
create table public.role_permissions (
  member_role public.member_role not null,
  permission text not null references public.permissions(code),
  primary key (member_role, permission)
);

insert into public.permissions(code) values
 ('store.customize'),('menu.manage'),('orders.view'),('orders.update_status'),
 ('staff.manage'),('reports.view'),('settings.manage'),('delivery.manage_own');

insert into public.role_permissions(member_role, permission)
select 'owner'::public.member_role, code from public.permissions
union all select 'manager'::public.member_role, c from unnest(array['store.customize','menu.manage','orders.view','orders.update_status','reports.view','delivery.manage_own']) c