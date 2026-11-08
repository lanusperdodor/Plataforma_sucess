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
union all select 'attendant'::public.member_role, c from unnest(array['orders.view','orders.update_status']) c
union all select 'kitchen'::public.member_role, c from unnest(array['orders.view','orders.update_status']) c
union all select 'courier_own'::public.member_role, 'orders.view';

-- ---------- auditoria ----------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

-- ---------- funções de autorização ----------
create or replace function public.has_role(_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = _role)
$$;

create or replace function public.is_business_member(_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members where business_id = _business and user_id = auth.uid())
$$;

create or replace function public.has_business_permission(_business uuid, _permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    join public.role_permissions rp on rp.member_role = m.member_role
    where m.business_id = _business and m.user_id = auth.uid() and rp.permission = _permission)
$$;

-- ---------- novo usuário: profile + papel customer (único papel autoatribuível) ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120));
  insert into public.user_roles(user_id, role) values (new.id, 'customer');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- concessão de papéis: SOMENTE platform_master, com auditoria ----------
create or replace function public.grant_role(_user uuid, _role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('platform_master') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.user_roles(user_id, role, granted_by) values (_user, _role, auth.uid())
    on conflict do nothing;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'grant_role', 'user_roles', _user::text, jsonb_build_object('role', _role));
end $$;

create or replace function public.revoke_role(_user uuid, _role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('platform_master') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _role = 'customer' then raise exception 'customer role is permanent'; end if;
  if _role = 'platform_master' and (select count(*) from public.user_roles where role = 'platform_master') <= 1 then
    raise exception 'cannot revoke the last platform_master';
  end if;
  delete from public.user_roles where user_id = _user and role = _role;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'revoke_role', 'user_roles', _user::text, jsonb_build_object('role', _role));
end $$;

revoke all on function public.grant_role(uuid, public.app_role) from public, anon;
revoke all on function public.revoke_role(uuid, public.app_role) from public, anon;
grant execute on function public.grant_role(uuid, public.app_role) to authenticated;
grant execute on function public.revoke_role(uuid, public.app_role) to authenticated;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: dono lê/edita o próprio; staff da plataforma lê.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('platform_operator') or public.has_role('platform_master'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_roles: leitura do próprio; SEM políticas de escrita (somente grant_role/trigger).
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role('platform_master'));

-- businesses: público vê lojas ativas; membros veem a sua; escrita: dono atualiza dados básicos.
create policy businesses_public_select on public.businesses for select to anon, authenticated
  using (status = 'active');
create policy businesses_member_select on public.businesses for select to authenticated
  using (public.is_business_member(id) or public.has_role('platform_operator') or public.has_role('platform_master'));
create policy businesses_owner_update on public.businesses for update to authenticated
  using (public.has_business_permission(id, 'settings.manage'))
  with check (public.has_business_permission(id, 'settings.manage'));
-- status/owner_id/slug não são atualizáveis por membros (grant por coluna abaixo);
-- aprovação de empresa será feita por função de backend do Master (spec Master).

-- business_members: membros veem colegas; gestão de equipe exige staff.manage.
create policy members_select on public.business_members for select to authenticated
  using (public.is_business_member(business_id) or public.has_role('platform_master'));
create policy members_insert on public.business_members for insert to authenticated
  with check (public.has_business_permission(business_id, 'staff.manage') and member_role <> 'owner');
create policy members_delete on public.business_members for delete to authenticated
  using (public.has_business_permission(business_id, 'staff.manage') and member_role <> 'owner');

-- catálogo de permissões: leitura para autenticados (não sensível); sem escrita.
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

-- audit_logs: apenas master lê; ninguém escreve diretamente.
create policy audit_select on public.audit_logs for select to authenticated
  using (public.has_role('platform_master'));

-- Privilégios mínimos de tabela (defesa em profundidade além da RLS).
revoke all on public.profiles, public.user_roles, public.businesses, public.business_members,
  public.permissions, public.role_permissions, public.audit_logs from anon, authenticated;
-- funções internas/trigger não devem ser chamáveis pela API
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant select on public.businesses to anon;
grant select on public.businesses, public.profiles, public.user_roles, public.business_members,
  public.permissions, public.role_permissions, public.audit_logs to authenticated;
grant update (full_name, phone, preferred_city_id) on public.profiles to authenticated;
grant update (name) on public.businesses to authenticated;
grant insert, delete on public.business_members to authenticated;
