-- =====================================================================================
-- TUCAÍ — BANCO COMPLETO (migrations 0001 a 0022) PARA O SQL EDITOR DO SUPABASE
-- Gerado automaticamente a partir de supabase/migrations por `npm run sql:bundle`. NÃO editar aqui.
-- Seguro para rodar quantas vezes quiser: aplica só o que falta e registra em private.tucai_migrations.
-- Uso: copie TODO o conteúdo, cole no SQL Editor e clique em Run.
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

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0001', '0001_foundation.sql', 'applied');
    raise notice 'Tucaí 0001: aplicada agora';
  end if;
end $tucai_0001$;

-- ===================== supabase/migrations/0002_catalog_core.sql =====================
do $tucai_0002$
begin
  if exists (select 1 from private.tucai_migrations where version = '0002') then
    raise notice 'Tucaí 0002: já aplicada';
  elsif to_regclass('public.cities') is not null then
    insert into private.tucai_migrations(version, name, how) values ('0002', '0002_catalog_core.sql', 'detected');
    raise notice 'Tucaí 0002: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0002_catalog_core: catálogo (cidades, categorias, estabelecimentos, cardápio, serviços, avaliações),
-- configuração de preços versionada, visão pública segura de estabelecimentos e RLS.
-- A 0001 não é alterada; ajustes sobre ela (grants/políticas de businesses) são feitos aqui.
-- Todos os objetos usam schema explícito; funções SECURITY DEFINER usam search_path vazio.

-- Schema interno: não exposto pela API; nenhum papel de API recebe USAGE.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.business_type as enum ('restaurante','loja','servico');
create type public.delivery_offer as enum ('partner','own','none');

-- ---------- cities ----------
create table public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  state text not null check (state ~ '^[A-Z]{2}$'),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  center_lat numeric(9,6) check (center_lat between -90 and 90),
  center_lng numeric(9,6) check (center_lng between -180 and 180),
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, state),
  check ((center_lat is null) = (center_lng is null))
);
create trigger cities_updated before update on public.cities
  for each row execute function public.set_updated_at();

-- ---------- categories ----------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label text not null check (char_length(label) between 1 and 60),
  kind text not null check (kind in ('restaurante','loja','servico','vaga')),
  icon text check (icon is null or char_length(icon) <= 60), -- nome do ícone Lucide
  sort_order integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- FK pendente da 0001
alter table public.profiles
  add constraint profiles_preferred_city_fk
  foreign key (preferred_city_id) references public.cities(id) on delete set null;
create index profiles_preferred_city_idx on public.profiles(preferred_city_id);

-- ---------- extensão de businesses ----------
alter table public.businesses
  add column business_type public.business_type not null default 'restaurante',
  add column category_id uuid references public.categories(id) on delete set null,
  add column city_id uuid references public.cities(id) on delete set null,
  add column description text check (description is null or char_length(description) <= 1000),
  add column cover_url text check (cover_url is null or char_length(cover_url) <= 500),
  add column logo_url text check (logo_url is null or char_length(logo_url) <= 500),
  add column address_line text check (address_line is null or char_length(address_line) <= 200), -- endereço resumido
  add column phone text check (phone is null or char_length(phone) <= 20),
  add column whatsapp text check (whatsapp is null or char_length(whatsapp) <= 20),
  add column lat numeric(9,6) check (lat between -90 and 90),
  add column lng numeric(9,6) check (lng between -180 and 180),
  -- ESTIMATIVA: distância aproximada ao centro da cidade; substituída por geolocalização real (lat/lng) depois.
  add column distance_estimate_km numeric(5,1) check (distance_estimate_km >= 0),
  add column delivery_offer public.delivery_offer not null default 'none',
  add column own_delivery_fee_cents integer not null default 0 check (own_delivery_fee_cents >= 0),
  add column accepts_pickup boolean not null default false,
  add column estimated_min_minutes smallint check (estimated_min_minutes > 0),
  add column estimated_max_minutes smallint check (estimated_max_minutes > 0),
  add column min_order_cents integer not null default 0 check (min_order_cents >= 0),
  add column price_tier smallint check (price_tier between 1 and 4),
  add column rating_avg numeric(2,1) not null default 0 check (rating_avg between 0 and 5),
  add column rating_count integer not null default 0 check (rating_count >= 0),
  add column popularity_score integer not null default 0,
  add column is_featured boolean not null default false,
  add column is_demo boolean not null default false,
  add constraint businesses_estimated_range check
    (estimated_min_minutes is null or estimated_max_minutes is null or estimated_max_minutes >= estimated_min_minutes),
  add constraint businesses_lat_lng_pair check ((lat is null) = (lng is null));
-- Selo promocional NÃO é coluna: virá de campanhas/cupons reais (0004).

create index businesses_city_type_status_idx on public.businesses(city_id, business_type, status);
create index businesses_category_idx on public.businesses(category_id);
create index businesses_popularity_idx on public.businesses(popularity_score desc);
create index businesses_rating_idx on public.businesses(rating_avg desc);

-- ---------- funções de apoio ----------
create or replace function public.is_active_business(_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses where id = _b and status = 'active')
$$;

-- ---------- business_hours ----------
create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = domingo
  opens time not null,
  closes time not null, -- closes < opens atravessa a meia-noite; '24:00' permitido
  check (opens <> closes),
  created_at timestamptz not null default now()
);
create index business_hours_business_idx on public.business_hours(business_id, weekday);

-- ---------- menu_categories ----------
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);
create index menu_categories_business_idx on public.menu_categories(business_id, sort_order);
create trigger menu_categories_updated before update on public.menu_categories
  for each row execute function public.set_updated_at();

-- ---------- products ----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  price_cents integer not null check (price_cents >= 0),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  is_available boolean not null default true,
  is_popular boolean not null default false,
  sort_order integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (category_id, business_id) references public.menu_categories(id, business_id) on delete cascade
);
create index products_business_idx on public.products(business_id, sort_order);
create index products_category_idx on public.products(category_id, business_id);
create trigger products_updated before update on public.products
  for each row execute function public.set_updated_at();

-- ---------- option_groups ----------
create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  min_select smallint not null default 0,
  max_select smallint not null default 1,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (min_select >= 0 and max_select >= greatest(min_select, 1)),
  unique (id, business_id),
  foreign key (product_id, business_id) references public.products(id, business_id) on delete cascade
);
create index option_groups_business_idx on public.option_groups(business_id, sort_order);
create index option_groups_product_idx on public.option_groups(product_id, business_id);

-- ---------- options ----------
create table public.options (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  group_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  price_delta_cents integer not null default 0 check (price_delta_cents >= 0),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (group_id, business_id) references public.option_groups(id, business_id) on delete cascade
);
create index options_business_idx on public.options(business_id, sort_order);
create index options_group_idx on public.options(group_id, business_id);

-- ---------- services ----------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  category_id uuid references public.categories(id) on delete set null,
  city_id uuid references public.cities(id) on delete set null,
  description text check (description is null or char_length(description) <= 1000),
  phone text check (phone is null or char_length(phone) <= 20),
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 20),
  status text not null default 'published' check (status in ('published','hidden')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_business_idx on public.services(business_id);
create index services_category_idx on public.services(category_id);
create index services_city_idx on public.services(city_id, status);
create trigger services_updated before update on public.services
  for each row execute function public.set_updated_at();

-- ---------- reviews (somente leitura para clientes nesta fase) ----------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  order_id uuid, -- FK para orders na 0005
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  author_name text check (author_name is null or char_length(author_name) <= 60),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index reviews_business_idx on public.reviews(business_id, created_at desc);
create index reviews_user_idx on public.reviews(user_id);

-- média/contagem denormalizadas por gatilho
create or replace function private.refresh_business_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b uuid := coalesce(new.business_id, old.business_id);
begin
  update public.businesses
     set rating_count = s.n, rating_avg = round(coalesce(s.a, 0), 1)
    from (select count(*)::int n, avg(rating) a from public.reviews where business_id = b) s
   where id = b;
  return null;
end $$;
create trigger reviews_rating after insert or update or delete on public.reviews
  for each row execute function private.refresh_business_rating();

-- ---------- pricing_configs (versionada; imutável após uso) ----------
create table public.pricing_configs (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  -- mesma forma do PricingConfig do TypeScript
  config jsonb not null check (
    jsonb_typeof(config) = 'object'
    and (config->>'commissionThresholdCents') ~ '^[0-9]+$'
    and (config->>'commissionBps') ~ '^[0-9]+$'
    and (config->'partnerDelivery'->>'customerFeeCents') ~ '^[0-9]+$'
    and (config->'partnerDelivery'->>'merchantContributionCents') ~ '^[0-9]+$'
    and (config->'partnerDelivery'->>'courierPayCents') ~ '^[0-9]+$'
    and (config->'partnerDelivery'->>'platformFeeCents') ~ '^[0-9]+$'
    and (config->'ownDelivery'->>'platformFeeCents') ~ '^[0-9]+$'
  ),
  -- comissão incide sobre o subtotal original, antes de descontos do estabelecimento
  commission_base text not null default 'original_subtotal' check (commission_base = 'original_subtotal'),
  effective_from timestamptz not null default now(),
  is_current boolean not null default false,
  used_at timestamptz, -- preenchido na primeira utilização por um pedido; congela a linha
  created_at timestamptz not null default now(),
  -- o frete parceiro precisa estar financiado
  check ((config->'partnerDelivery'->>'customerFeeCents')::bigint + (config->'partnerDelivery'->>'merchantContributionCents')::bigint
       = (config->'partnerDelivery'->>'courierPayCents')::bigint + (config->'partnerDelivery'->>'platformFeeCents')::bigint)
);
create unique index pricing_configs_one_current_idx on public.pricing_configs(is_current) where is_current;

create or replace function private.pricing_configs_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.used_at is not null then raise exception 'pricing_config em uso é imutável' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.used_at is not null then
    -- após o uso só é permitido aposentar a versão (is_current true -> false)
    if new.config is distinct from old.config or new.version <> old.version
       or new.effective_from <> old.effective_from or new.commission_base <> old.commission_base
       or new.used_at is distinct from old.used_at or (new.is_current and not old.is_current) then
      raise exception 'pricing_config em uso é imutável' using errcode = 'P0001';
    end if;
  elsif new.used_at is not null and new.used_at is distinct from old.used_at then
    -- marcação de uso: nenhum outro campo pode mudar na mesma operação
    if new.config is distinct from old.config or new.version <> old.version then
      raise exception 'pricing_config: marcação de uso não altera conteúdo' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger pricing_configs_guard before update or delete on public.pricing_configs
  for each row execute function private.pricing_configs_guard();

-- usada pelas funções de pedido (0006): congela a versão no primeiro pedido
create or replace function private.mark_pricing_config_used(_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.pricing_configs set used_at = now() where id = _id and used_at is null
$$;

insert into public.pricing_configs(version, config, is_current) values (
  1,
  jsonb_build_object(
    'commissionThresholdCents', 5000,
    'commissionBps', 200,
    'partnerDelivery', jsonb_build_object(
      'customerFeeCents', 400, 'merchantContributionCents', 200,
      'courierPayCents', 500, 'platformFeeCents', 100),
    'ownDelivery', jsonb_build_object('platformFeeCents', 100)),
  true);

-- ---------- horário de funcionamento ----------
create or replace function private.is_open(_business uuid, _at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  with l as (select (_at at time zone 'America/Sao_Paulo') as ts)
  select exists (
    select 1 from public.business_hours h, l
    where h.business_id = _business
      and (
        -- janela iniciada hoje
        (h.weekday = extract(dow from l.ts)::int
          and l.ts::time >= h.opens
          and (h.closes < h.opens or l.ts::time < h.closes))
        -- janela de ontem que atravessa a meia-noite
        or (h.weekday = ((extract(dow from l.ts)::int + 6) % 7)
          and h.closes < h.opens
          and l.ts::time < h.closes)
      ))
$$;

create or replace function public.business_is_open(_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_open(_business, now())
$$;

-- ---------- RLS ----------
alter table public.cities enable row level security;
alter table public.categories enable row level security;
alter table public.business_hours enable row level security;
alter table public.menu_categories enable row level security;
alter table public.products enable row level security;
alter table public.option_groups enable row level security;
alter table public.options enable row level security;
alter table public.services enable row level security;
alter table public.reviews enable row level security;
alter table public.pricing_configs enable row level security;

-- catálogos públicos por natureza (não sensíveis)
create policy cities_select on public.cities for select to anon, authenticated using (is_active);
create policy categories_select on public.categories for select to anon, authenticated using (true);

create policy business_hours_select on public.business_hours for select to anon, authenticated
  using (public.is_active_business(business_id));
create policy menu_categories_select on public.menu_categories for select to anon, authenticated
  using (is_active and public.is_active_business(business_id));
create policy products_select on public.products for select to anon, authenticated
  using (public.is_active_business(business_id));
create policy option_groups_select on public.option_groups for select to anon, authenticated
  using (public.is_active_business(business_id));
create policy options_select on public.options for select to anon, authenticated
  using (public.is_active_business(business_id));
create policy services_select on public.services for select to anon, authenticated
  using (status = 'published' and public.is_active_business(business_id));
create policy reviews_select on public.reviews for select to anon, authenticated
  using (public.is_active_business(business_id));
-- pricing_configs: sem política e sem grant (leitura apenas nas funções definer)

-- ---------- businesses: fechar a leitura direta pública ----------
-- A 0001 concedeu SELECT a anon e uma política pública. Dados públicos agora saem
-- só pela visão public.public_businesses; a tabela fica restrita a membros/operadores/master
-- (política businesses_member_select da 0001), o que protege owner_id e demais campos privados.
revoke select on public.businesses from anon;
drop policy businesses_public_select on public.businesses;

-- Visão pública segura. Semântica de DEFINER (security_invoker não serve: anon/não-membros
-- não têm mais acesso à tabela). Segurança garantida por: filtro explícito status = 'active',
-- lista fechada de colunas (sem owner_id, updated_at ou dados privados) e security_barrier.
create view public.public_businesses with (security_barrier = true) as
  select b.id, b.name, b.slug, b.status, b.business_type, b.category_id, b.city_id,
         b.description, b.cover_url, b.logo_url, b.address_line, b.phone, b.whatsapp,
         b.lat, b.lng, b.distance_estimate_km,
         b.delivery_offer, b.own_delivery_fee_cents, b.accepts_pickup,
         b.estimated_min_minutes, b.estimated_max_minutes, b.min_order_cents, b.price_tier,
         b.rating_avg, b.rating_count, b.popularity_score, b.is_featured, b.is_demo,
         b.created_at,
         public.business_is_open(b.id) as is_open
    from public.businesses b
   where b.status = 'active';

-- ---------- privilégios explícitos ----------
revoke all on public.cities, public.categories, public.business_hours, public.menu_categories,
  public.products, public.option_groups, public.options, public.services, public.reviews,
  public.pricing_configs, public.public_businesses from anon, authenticated;

grant select on public.cities, public.categories, public.business_hours, public.menu_categories,
  public.products, public.option_groups, public.options, public.services,
  public.public_businesses to anon, authenticated;
-- reviews: sem user_id/order_id (identificadores internos)
grant select (id, business_id, rating, comment, author_name, is_demo, created_at)
  on public.reviews to anon, authenticated;

-- funções: internas sem EXECUTE para a API; públicas só para quem precisa
revoke all on function private.refresh_business_rating() from public, anon, authenticated;
revoke all on function private.pricing_configs_guard() from public, anon, authenticated;
revoke all on function private.mark_pricing_config_used(uuid) from public, anon, authenticated;
revoke all on function private.is_open(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.is_active_business(uuid) from public, anon, authenticated;
revoke all on function public.business_is_open(uuid) from public, anon, authenticated;
grant execute on function public.is_active_business(uuid) to anon, authenticated;
grant execute on function public.business_is_open(uuid) to anon, authenticated;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0002', '0002_catalog_core.sql', 'applied');
    raise notice 'Tucaí 0002: aplicada agora';
  end if;
end $tucai_0002$;

-- ===================== supabase/migrations/0003_public_real_data_only.sql =====================
do $tucai_0003$
begin
  if exists (select 1 from private.tucai_migrations where version = '0003') then
    raise notice 'Tucaí 0003: já aplicada';
  elsif to_regclass('public.public_businesses') is not null and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'public_businesses' and column_name = 'is_demo') then
    insert into private.tucai_migrations(version, name, how) values ('0003', '0003_public_real_data_only.sql', 'detected');
    raise notice 'Tucaí 0003: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0003_public_real_data_only: a experiência pública só mostra dados reais.
-- Linhas marcadas is_demo (antigo seed de desenvolvimento) deixam de ser visíveis para
-- anon/authenticated em qualquer leitura pública, mesmo que existam no banco.
-- Também cadastra a taxonomia oficial de categorias e a cidade inicial (sem coordenadas
-- inventadas: o centro geográfico é definido pelo Master no painel).

-- ---------- estabelecimento público: ativo E não demonstrativo ----------
create or replace function public.is_active_business(_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses where id = _b and status = 'active' and not is_demo)
$$;

drop policy cities_select on public.cities;
create policy cities_select on public.cities for select to anon, authenticated
  using (is_active and not is_demo);

drop policy categories_select on public.categories;
create policy categories_select on public.categories for select to anon, authenticated
  using (not is_demo);

drop policy menu_categories_select on public.menu_categories;
create policy menu_categories_select on public.menu_categories for select to anon, authenticated
  using (is_active and not is_demo and public.is_active_business(business_id));

drop policy products_select on public.products;
create policy products_select on public.products for select to anon, authenticated
  using (not is_demo and public.is_active_business(business_id));

drop policy services_select on public.services;
create policy services_select on public.services for select to anon, authenticated
  using (status = 'published' and not is_demo and public.is_active_business(business_id));

drop policy reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to anon, authenticated
  using (not is_demo and public.is_active_business(business_id));

-- reviews: a coluna is_demo deixa de ser exposta
revoke select on public.reviews from anon, authenticated;
grant select (id, business_id, rating, comment, author_name, created_at)
  on public.reviews to anon, authenticated;

-- ---------- visão pública sem is_demo ----------
drop view public.public_businesses;
create view public.public_businesses with (security_barrier = true) as
  select b.id, b.name, b.slug, b.status, b.business_type, b.category_id, b.city_id,
         b.description, b.cover_url, b.logo_url, b.address_line, b.phone, b.whatsapp,
         b.lat, b.lng, b.distance_estimate_km,
         b.delivery_offer, b.own_delivery_fee_cents, b.accepts_pickup,
         b.estimated_min_minutes, b.estimated_max_minutes, b.min_order_cents, b.price_tier,
         b.rating_avg, b.rating_count, b.popularity_score, b.is_featured,
         b.created_at,
         public.business_is_open(b.id) as is_open
    from public.businesses b
   where b.status = 'active' and not b.is_demo;
revoke all on public.public_businesses from public, anon, authenticated;
grant select on public.public_businesses to anon, authenticated;

-- ---------- taxonomia oficial (dados de plataforma, não comerciais) ----------
insert into public.categories (slug, label, kind, icon, sort_order) values
  ('lanches',        'Lanches',        'restaurante', 'Sandwich',        10),
  ('pizzas',         'Pizzas',         'restaurante', 'Pizza',           20),
  ('marmitas',       'Marmitas',       'restaurante', 'Soup',            30),
  ('acai',           'Açaí',           'restaurante', 'IceCreamBowl',    40),
  ('bebidas',        'Bebidas',        'restaurante', 'CupSoda',         50),
  ('restaurantes-outros', 'Outros',    'restaurante', 'UtensilsCrossed', 90),
  ('roupas',         'Roupas',         'loja',        'Shirt',          110),
  ('calcados',       'Calçados',       'loja',        'Footprints',     120),
  ('joias',          'Joias',          'loja',        'Gem',            130),
  ('acessorios',     'Acessórios',     'loja',        'Watch',          140),
  ('perfumes',       'Perfumes',       'loja',        'Droplets',       150),
  ('cosmeticos',     'Cosméticos',     'loja',        'Sparkles',       160),
  ('presentes',      'Presentes',      'loja',        'Gift',           170),
  ('eletronicos',    'Eletrônicos',    'loja',        'Smartphone',     180),
  ('lojas-outros',   'Outros',         'loja',        'Package',        190),
  ('barbearias',     'Barbearias',     'servico',     'Scissors',       210),
  ('saloes',         'Salões',         'servico',     'Sparkles',       220),
  ('manicures',      'Manicures',      'servico',     'Hand',           230),
  ('tecnicos',       'Técnicos',       'servico',     'Cpu',            240),
  ('fotografos',     'Fotógrafos',     'servico',     'Camera',         250),
  ('limpeza',        'Limpeza',        'servico',     'SprayCan',       260),
  ('manutencao',     'Manutenção',     'servico',     'Hammer',         270),
  ('servicos-outros','Outros',         'servico',     'Wrench',         290)
on conflict (slug) do nothing;

-- cidade inicial; coordenadas definidas depois pelo Master
insert into public.cities (name, state, slug, is_active)
values ('Itaú de Minas', 'MG', 'itau-de-minas-mg', true)
on conflict do nothing;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0003', '0003_public_real_data_only.sql', 'applied');
    raise notice 'Tucaí 0003: aplicada agora';
  end if;
end $tucai_0003$;

-- ===================== supabase/migrations/0004_business_status_rejected.sql =====================
do $tucai_0004$
begin
  if exists (select 1 from private.tucai_migrations where version = '0004') then
    raise notice 'Tucaí 0004: já aplicada';
  elsif exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'business_status' and e.enumlabel = 'rejected') then
    insert into private.tucai_migrations(version, name, how) values ('0004', '0004_business_status_rejected.sql', 'detected');
    raise notice 'Tucaí 0004: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0004: novo estado de estabelecimento "rejected" (solicitação recusada pelo Master).
-- Isolado em migration própria: um valor novo de enum não pode ser usado na mesma transação.
alter type public.business_status add value if not exists 'rejected';

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0004', '0004_business_status_rejected.sql', 'applied');
    raise notice 'Tucaí 0004: aplicada agora';
  end if;
end $tucai_0004$;

-- ===================== supabase/migrations/0005_platform_admin.sql =====================
do $tucai_0005$
begin
  if exists (select 1 from private.tucai_migrations where version = '0005') then
    raise notice 'Tucaí 0005: já aplicada';
  elsif to_regclass('public.platform_settings') is not null then
    insert into private.tucai_migrations(version, name, how) values ('0005', '0005_platform_admin.sql', 'detected');
    raise notice 'Tucaí 0005: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0005_platform_admin: base do Painel Master.
--  * Configurações operacionais (platform_settings) alteráveis só pelo Master, com auditoria.
--  * Permissões administrativas configuráveis por integrante (operadores não recebem nada por padrão).
--  * MFA: com require_admin_mfa = true, toda permissão administrativa exige sessão aal2.
--  * Solicitação de cadastro de estabelecimento pelo próprio usuário e análise pelo Master.
--  * Gestão de cidades, equipe e consulta de auditoria por funções SECURITY DEFINER.
-- Nenhuma autoelevação: só o Master concede papéis/permissões; ninguém aprova o próprio negócio.

-- ---------- auditoria (helper interno) ----------
create or replace function private.audit(_action text, _entity text, _entity_id text, _details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (auth.uid(), _action, _entity, _entity_id, coalesce(_details, '{}'::jsonb))
$$;

-- ---------- configurações operacionais ----------
create table public.platform_settings (
  key text primary key check (key in ('require_admin_mfa', 'max_pending_business_applications')),
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(key, value) values
  -- Ativar (true) assim que o primeiro Master cadastrar o fator TOTP; obrigatório antes de produção.
  ('require_admin_mfa', 'false'::jsonb),
  ('max_pending_business_applications', '3'::jsonb);
create index platform_settings_updated_by_idx on public.platform_settings(updated_by);

create or replace function private.setting(_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.platform_settings where key = _key
$$;

-- ---------- MFA ----------
-- aal2 = sessão verificada com segundo fator (Supabase Auth MFA/TOTP).
create or replace function private.current_aal() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1')
$$;

create or replace function private.admin_mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((private.setting('require_admin_mfa'))::text::boolean, false) = false
      or private.current_aal() = 'aal2'
$$;

-- ---------- permissões administrativas ----------
create table public.platform_permissions (
  code text primary key check (code ~ '^[a-z]+(\.[a-z_]+)+$'),
  description text not null check (char_length(description) between 3 and 160),
  sort_order integer not null default 0
);
insert into public.platform_permissions(code, description, sort_order) values
  ('admin.dashboard',    'Ver o painel geral', 10),
  ('users.view',         'Consultar usuários e perfis', 20),
  ('businesses.review',  'Analisar, aprovar, recusar e suspender estabelecimentos', 30),
  ('cities.manage',      'Gerenciar cidades', 40),
  ('audit.view',         'Consultar logs de auditoria', 50),
  ('couriers.review',    'Analisar entregadores (Sprint 5)', 60),
  ('orders.view',        'Consultar pedidos e entregas (Sprint 4)', 70),
  ('finance.view',       'Consultar financeiro e repasses (Sprint 6)', 80),
  ('moderation.manage',  'Moderar o Conecta e tratar denúncias (Sprint 9)', 90),
  ('support.manage',     'Atender chamados (Sprint 11)', 100),
  ('campaigns.manage',   'Gerenciar campanhas e conteúdo patrocinado (Sprint 11)', 110),
  ('jobs.manage',        'Gerenciar vagas (Sprint 11)', 120);
-- Reservado ao Master (não concedível): papéis, equipe, configurações, planos e regras comerciais.

create table public.platform_staff_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null references public.platform_permissions(code) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, permission)
);
create index platform_staff_permissions_permission_idx on public.platform_staff_permissions(permission);
create index platform_staff_permissions_granted_by_idx on public.platform_staff_permissions(granted_by);

create or replace function public.has_platform_permission(_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_mfa_ok() and (
    public.has_role('platform_master')
    or (public.has_role('platform_operator') and exists (
          select 1 from public.platform_staff_permissions
           where user_id = auth.uid() and permission = _permission)))
$$;

create or replace function private.is_master_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('platform_master') and private.admin_mfa_ok()
$$;

create or replace function private.require_permission(_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_platform_permission(_permission) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function private.require_master() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_master_ok() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ---------- papéis: Master + MFA (substitui as versões da 0001) ----------
create or replace function public.grant_role(_user uuid, _role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  if not exists (select 1 from auth.users where id = _user) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0001';
  end if;
  insert into public.user_roles(user_id, role, granted_by) values (_user, _role, auth.uid())
    on conflict do nothing;
  perform private.audit('grant_role', 'user_roles', _user::text, jsonb_build_object('role', _role));
end $$;

create or replace function public.revoke_role(_user uuid, _role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  if _role = 'customer' then raise exception 'customer role is permanent' using errcode = 'P0001'; end if;
  if _role = 'platform_master' and (select count(*) from public.user_roles where role = 'platform_master') <= 1 then
    raise exception 'cannot revoke the last platform_master' using errcode = 'P0001';
  end if;
  delete from public.user_roles where user_id = _user and role = _role;
  if _role = 'platform_operator' then
    delete from public.platform_staff_permissions where user_id = _user;
  end if;
  perform private.audit('revoke_role', 'user_roles', _user::text, jsonb_build_object('role', _role));
end $$;

-- ---------- políticas da 0001: leitura administrativa por permissão (não por papel genérico) ----------
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_platform_permission('users.view'));

drop policy user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_platform_permission('users.view'));

drop policy businesses_member_select on public.businesses;
create policy businesses_member_select on public.businesses for select to authenticated
  using (public.is_business_member(id) or public.has_platform_permission('businesses.review'));

drop policy audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (public.has_platform_permission('audit.view'));

-- ---------- estabelecimentos: dados da análise ----------
alter table public.businesses
  add column submitted_at timestamptz,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id),
  add column review_note text check (review_note is null or char_length(review_note) <= 500);
create index businesses_reviewed_by_idx on public.businesses(reviewed_by);
create index businesses_status_submitted_idx on public.businesses(status, submitted_at desc);

-- slug estável a partir do nome (sem depender da extensão unaccent)
create or replace function private.slugify(_text text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(
           translate(lower(_text), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]+', '-', 'g')), 60), ''), 'negocio')
$$;

create or replace function private.unique_business_slug(_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare base text := trim(both '-' from private.slugify(_name)); candidate text; n int := 1;
begin
  if base = '' then base := 'negocio'; end if;
  candidate := base;
  while exists (select 1 from public.businesses where slug = candidate) loop
    n := n + 1;
    candidate := left(base, 55) || '-' || n;
  end loop;
  return candidate;
end $$;

-- Solicitação de cadastro feita pelo próprio usuário (fica "pending" até a análise).
create or replace function public.submit_business_application(
  _name text,
  _business_type public.business_type,
  _city_id uuid,
  _category_id uuid default null,
  _phone text default null,
  _description text default null,
  _address_line text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  max_pending int := coalesce((private.setting('max_pending_business_applications'))::text::int, 3);
  new_id uuid;
  clean_name text := btrim(coalesce(_name, ''));
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Informe o nome do negócio (2 a 120 caracteres).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cities where id = _city_id and is_active and not is_demo) then
    raise exception 'Cidade indisponível.' using errcode = 'P0001';
  end if;
  if _category_id is not null and not exists (
       select 1 from public.categories where id = _category_id and not is_demo and kind = _business_type::text) then
    raise exception 'Categoria incompatível com o tipo de negócio.' using errcode = 'P0001';
  end if;
  if _phone is not null and _phone !~ '^[0-9+() -]{8,20}$' then
    raise exception 'Telefone inválido.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(_description, '')) > 1000 or char_length(coalesce(_address_line, '')) > 200 then
    raise exception 'Texto muito longo.' using errcode = 'P0001';
  end if;
  -- proteção contra spam: limite de solicitações em análise por usuário
  perform pg_advisory_xact_lock(hashtext('business_application:' || uid::text));
  if (select count(*) from public.businesses where owner_id = uid and status = 'pending') >= max_pending then
    raise exception 'Você já tem solicitações em análise. Aguarde a resposta da equipe Tucaí.' using errcode = 'P0001';
  end if;

  insert into public.businesses (name, slug, owner_id, status, business_type, category_id, city_id,
                                 phone, description, address_line, submitted_at, is_demo)
  values (clean_name, private.unique_business_slug(clean_name), uid, 'pending', _business_type, _category_id, _city_id,
          nullif(btrim(_phone), ''), nullif(btrim(_description), ''), nullif(btrim(_address_line), ''), now(), false)
  returning id into new_id;

  insert into public.business_members(business_id, user_id, member_role) values (new_id, uid, 'owner');
  perform private.audit('business.submit', 'businesses', new_id::text,
                        jsonb_build_object('name', clean_name, 'type', _business_type));
  return new_id;
end $$;

-- Análise pelo Master/operador com permissão. Transições válidas:
--   approve:    pending | rejected -> active
--   reject:     pending            -> rejected   (motivo obrigatório)
--   suspend:    active             -> suspended  (motivo obrigatório)
--   reactivate: suspended          -> active
create or replace function public.admin_review_business(_business uuid, _decision text, _note text default null)
returns public.business_status
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses%rowtype;
  next_status public.business_status;
  note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('businesses.review');
  select * into b from public.businesses where id = _business for update;
  if not found or b.is_demo then raise exception 'Estabelecimento não encontrado.' using errcode = 'P0001'; end if;
  if b.owner_id = auth.uid() or exists (select 1 from public.business_members where business_id = b.id and user_id = auth.uid()) then
    raise exception 'Você não pode analisar um estabelecimento do qual faz parte.' using errcode = '42501';
  end if;
  if char_length(coalesce(note, '')) > 500 then
    raise exception 'Motivo muito longo (máximo 500 caracteres).' using errcode = 'P0001';
  end if;

  next_status := case
    when _decision = 'approve' and b.status::text in ('pending', 'rejected') then 'active'
    when _decision = 'reject' and b.status = 'pending' then 'rejected'
    when _decision = 'suspend' and b.status = 'active' then 'suspended'
    when _decision = 'reactivate' and b.status = 'suspended' then 'active'
  end;
  if next_status is null then
    raise exception 'Transição inválida: % a partir de %.', _decision, b.status using errcode = 'P0001';
  end if;
  if _decision in ('reject', 'suspend') and note is null then
    raise exception 'Informe o motivo.' using errcode = 'P0001';
  end if;

  update public.businesses
     set status = next_status, reviewed_at = now(), reviewed_by = auth.uid(), review_note = note
   where id = b.id;
  if next_status = 'active' then
    insert into public.user_roles(user_id, role, granted_by) values (b.owner_id, 'business_owner', auth.uid())
      on conflict do nothing;
  end if;
  perform private.audit('business.' || _decision, 'businesses', b.id::text,
                        jsonb_build_object('from', b.status, 'to', next_status, 'note', note));
  return next_status;
end $$;

create or replace function public.admin_list_businesses(
  _status public.business_status default null,
  _search text default null,
  _limit int default 50,
  _offset int default 0
) returns table (
  id uuid, name text, slug text, status public.business_status, business_type public.business_type,
  city_name text, city_state text, category_label text, owner_id uuid, owner_email text, owner_name text,
  phone text, description text, address_line text, submitted_at timestamptz, reviewed_at timestamptz,
  review_note text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('businesses.review');
  return query
    select b.id, b.name, b.slug, b.status, b.business_type, c.name, c.state, k.label, b.owner_id,
           u.email::text, p.full_name, b.phone, b.description, b.address_line, b.submitted_at,
           b.reviewed_at, b.review_note, b.created_at
      from public.businesses b
      left join public.cities c on c.id = b.city_id
      left join public.categories k on k.id = b.category_id
      left join auth.users u on u.id = b.owner_id
      left join public.profiles p on p.id = b.owner_id
     where not b.is_demo
       and (_status is null or b.status = _status)
       and (_search is null or b.name ilike '%' || replace(replace(_search, '%', ''), '_', '') || '%')
     order by coalesce(b.submitted_at, b.created_at) desc, b.id
     limit least(greatest(coalesce(_limit, 50), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

-- ---------- cidades ----------
create or replace function public.admin_list_cities()
returns table (id uuid, name text, state text, slug text, center_lat numeric, center_lng numeric,
               is_active boolean, businesses_active bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('cities.manage');
  return query
    select c.id, c.name, c.state, c.slug, c.center_lat, c.center_lng, c.is_active,
           (select count(*) from public.businesses b where b.city_id = c.id and b.status = 'active' and not b.is_demo),
           c.created_at
      from public.cities c where not c.is_demo order by c.state, c.name;
end $$;

create or replace function public.admin_save_city(
  _id uuid, _name text, _state text, _center_lat numeric default null, _center_lng numeric default null,
  _is_active boolean default true
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(coalesce(_name, ''));
  uf text := upper(btrim(coalesce(_state, '')));
  result uuid;
  before jsonb;
begin
  perform private.require_permission('cities.manage');
  if char_length(clean_name) not between 2 and 120 then raise exception 'Nome da cidade inválido.' using errcode = 'P0001'; end if;
  if uf !~ '^[A-Z]{2}$' then raise exception 'UF inválida.' using errcode = 'P0001'; end if;
  if (_center_lat is null) <> (_center_lng is null) then
    raise exception 'Informe latitude e longitude juntas.' using errcode = 'P0001';
  end if;
  if _center_lat is not null and (_center_lat not between -90 and 90 or _center_lng not between -180 and 180) then
    raise exception 'Coordenadas inválidas.' using errcode = 'P0001';
  end if;
  if _id is null then
    insert into public.cities(name, state, slug, center_lat, center_lng, is_active)
    values (clean_name, uf, private.slugify(clean_name || '-' || uf), _center_lat, _center_lng, coalesce(_is_active, true))
    returning id into result;
    perform private.audit('city.create', 'cities', result::text, jsonb_build_object('name', clean_name, 'state', uf));
  else
    select to_jsonb(c) into before from public.cities c where c.id = _id and not c.is_demo for update;
    if before is null then raise exception 'Cidade não encontrada.' using errcode = 'P0001'; end if;
    update public.cities
       set name = clean_name, state = uf, center_lat = _center_lat, center_lng = _center_lng,
           is_active = coalesce(_is_active, is_active)
     where id = _id returning id into result;
    perform private.audit('city.update', 'cities', result::text,
      jsonb_build_object('before', before - 'created_at' - 'updated_at',
                         'after', jsonb_build_object('name', clean_name, 'state', uf, 'center_lat', _center_lat,
                                                     'center_lng', _center_lng, 'is_active', _is_active)));
  end if;
  return result;
exception when unique_violation then
  raise exception 'Já existe uma cidade com este nome nesta UF.' using errcode = '23505';
end $$;

-- ---------- painel geral ----------
create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('admin.dashboard');
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'businesses', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                     from (select status, count(*) n from public.businesses where not is_demo group by status) s),
    'cities_active', (select count(*) from public.cities where is_active and not is_demo),
    'staff_total', (select count(distinct user_id) from public.user_roles where role in ('platform_master', 'platform_operator')),
    'audit_last_24h', (select count(*) from public.audit_logs where created_at > now() - interval '24 hours'),
    'generated_at', now());
end $$;

-- ---------- usuários e equipe ----------
create or replace function public.admin_find_user(_email text)
returns table (user_id uuid, email text, full_name text, roles public.app_role[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('users.view');
  return query
    select u.id, u.email::text, p.full_name,
           coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = u.id), '{}')
      from auth.users u left join public.profiles p on p.id = u.id
     where lower(u.email) = lower(btrim(coalesce(_email, '')));
end $$;

create or replace function public.admin_list_staff()
returns table (user_id uuid, email text, full_name text, roles public.app_role[], permissions text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select u.id, u.email::text, p.full_name,
           (select array_agg(r.role order by r.role) from public.user_roles r
             where r.user_id = u.id and r.role in ('platform_master', 'platform_operator')),
           coalesce((select array_agg(s.permission order by s.permission) from public.platform_staff_permissions s
                      where s.user_id = u.id), '{}')
      from auth.users u left join public.profiles p on p.id = u.id
     where exists (select 1 from public.user_roles r where r.user_id = u.id
                     and r.role in ('platform_master', 'platform_operator'))
     order by u.email;
end $$;

create or replace function public.admin_set_staff_permission(_user uuid, _permission text, _granted boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  if _user = auth.uid() then
    raise exception 'Não é possível alterar as próprias permissões.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _user and role = 'platform_operator') then
    raise exception 'O usuário precisa ter o papel de operador da plataforma.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.platform_permissions where code = _permission) then
    raise exception 'Permissão desconhecida.' using errcode = 'P0001';
  end if;
  if _granted then
    insert into public.platform_staff_permissions(user_id, permission, granted_by)
    values (_user, _permission, auth.uid()) on conflict do nothing;
  else
    delete from public.platform_staff_permissions where user_id = _user and permission = _permission;
  end if;
  perform private.audit(case when _granted then 'staff_permission.grant' else 'staff_permission.revoke' end,
                        'platform_staff_permissions', _user::text, jsonb_build_object('permission', _permission));
end $$;

-- ---------- auditoria e configurações ----------
create or replace function public.admin_list_audit(_limit int default 50, _before_id bigint default null)
returns table (id bigint, actor_id uuid, actor_email text, action text, entity text, entity_id text,
               details jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('audit.view');
  return query
    select a.id, a.actor_id, u.email::text, a.action, a.entity, a.entity_id, a.details, a.created_at
      from public.audit_logs a left join auth.users u on u.id = a.actor_id
     where _before_id is null or a.id < _before_id
     order by a.id desc
     limit least(greatest(coalesce(_limit, 50), 1), 200);
end $$;

create or replace function public.admin_list_settings()
returns table (key text, value jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query select s.key, s.value, s.updated_at from public.platform_settings s order by s.key;
end $$;

create or replace function public.admin_set_setting(_key text, _value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare before jsonb;
begin
  perform private.require_master();
  if _key = 'require_admin_mfa' and jsonb_typeof(_value) <> 'boolean' then
    raise exception 'Valor deve ser verdadeiro ou falso.' using errcode = 'P0001';
  end if;
  if _key = 'require_admin_mfa' and _value = 'true'::jsonb and private.current_aal() <> 'aal2' then
    -- evita trancar a própria equipe: só quem já está com MFA ativo pode exigir MFA
    raise exception 'Ative e verifique seu próprio MFA antes de exigi-lo da equipe.' using errcode = 'P0001';
  end if;
  if _key = 'max_pending_business_applications'
     and (jsonb_typeof(_value) <> 'number' or (_value::text)::numeric not between 1 and 20) then
    raise exception 'Valor deve ser um número entre 1 e 20.' using errcode = 'P0001';
  end if;
  select value into before from public.platform_settings where key = _key for update;
  if not found then raise exception 'Configuração desconhecida.' using errcode = 'P0001'; end if;
  update public.platform_settings set value = _value, updated_by = auth.uid(), updated_at = now() where key = _key;
  perform private.audit('setting.update', 'platform_settings', _key, jsonb_build_object('before', before, 'after', _value));
end $$;

-- Contexto de acesso para a interface (somente UX; cada função valida de novo no servidor).
create or replace function public.admin_my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_master', public.has_role('platform_master'),
    'is_operator', public.has_role('platform_operator'),
    'mfa_required', coalesce((private.setting('require_admin_mfa'))::text::boolean, false),
    'aal', private.current_aal(),
    'mfa_ok', private.admin_mfa_ok(),
    'permissions', case
      when not private.admin_mfa_ok() then '[]'::jsonb
      when public.has_role('platform_master') then (select coalesce(jsonb_agg(code order by sort_order), '[]'::jsonb) from public.platform_permissions)
      when public.has_role('platform_operator') then (select coalesce(jsonb_agg(permission order by permission), '[]'::jsonb)
                                                       from public.platform_staff_permissions where user_id = auth.uid())
      else '[]'::jsonb end)
$$;

-- ---------- RLS e privilégios ----------
alter table public.platform_settings enable row level security;
alter table public.platform_permissions enable row level security;
alter table public.platform_staff_permissions enable row level security;
-- catálogo de permissões: leitura para quem administra
create policy platform_permissions_select on public.platform_permissions for select to authenticated
  using (public.has_role('platform_master') or public.has_role('platform_operator'));
-- permissões da equipe: o próprio integrante e o Master leem; escrita só por função
create policy platform_staff_permissions_select on public.platform_staff_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_role('platform_master'));
-- platform_settings: sem política (leitura/escrita apenas pelas funções do Master)

revoke all on public.platform_settings, public.platform_permissions, public.platform_staff_permissions
  from public, anon, authenticated;
grant select on public.platform_permissions, public.platform_staff_permissions to authenticated;

-- funções internas: nenhum acesso pela API
revoke all on function private.audit(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.setting(text) from public, anon, authenticated;
revoke all on function private.current_aal() from public, anon, authenticated;
revoke all on function private.admin_mfa_ok() from public, anon, authenticated;
revoke all on function private.is_master_ok() from public, anon, authenticated;
revoke all on function private.require_permission(text) from public, anon, authenticated;
revoke all on function private.require_master() from public, anon, authenticated;
revoke all on function private.slugify(text) from public, anon, authenticated;
revoke all on function private.unique_business_slug(text) from public, anon, authenticated;

-- funções públicas: apenas usuários autenticados (cada uma valida permissão no servidor)
do $$
declare f text;
begin
  foreach f in array array[
    'public.has_platform_permission(text)',
    'public.grant_role(uuid, public.app_role)',
    'public.revoke_role(uuid, public.app_role)',
    'public.submit_business_application(text, public.business_type, uuid, uuid, text, text, text)',
    'public.admin_review_business(uuid, text, text)',
    'public.admin_list_businesses(public.business_status, text, int, int)',
    'public.admin_list_cities()',
    'public.admin_save_city(uuid, text, text, numeric, numeric, boolean)',
    'public.admin_dashboard()',
    'public.admin_find_user(text)',
    'public.admin_list_staff()',
    'public.admin_set_staff_permission(uuid, text, boolean)',
    'public.admin_list_audit(int, bigint)',
    'public.admin_list_settings()',
    'public.admin_set_setting(text, jsonb)',
    'public.admin_my_access()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0005', '0005_platform_admin.sql', 'applied');
    raise notice 'Tucaí 0005: aplicada agora';
  end if;
end $tucai_0005$;

-- ===================== supabase/migrations/0006_security_privacy.sql =====================
do $tucai_0006$
begin
  if exists (select 1 from private.tucai_migrations where version = '0006') then
    raise notice 'Tucaí 0006: já aplicada';
  elsif to_regclass('public.privacy_requests') is not null then
    insert into private.tucai_migrations(version, name, how) values ('0006', '0006_security_privacy.sql', 'detected');
    raise notice 'Tucaí 0006: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0006_security_privacy: controles fundamentais de segurança e LGPD.
--  * MFA obrigatório para a equipe administrativa por padrão (o Master cadastra o TOTP em
--    /admin/seguranca antes de qualquer outra ação; o cadastro do fator não depende do painel).
--  * Rate limiting no servidor (janela fixa, atômico) aplicado às RPCs sensíveis.
--    Excesso responde SQLSTATE PT429 -> HTTP 429 no PostgREST.
--  * URLs de imagem só https (bloqueia javascript:, data:, http:).
--  * Direitos do titular: solicitações registradas, exportação dos próprios dados,
--    anonimização controlada pelo Master/operador com permissão privacy.manage.

-- ---------- MFA obrigatório por padrão ----------
update public.platform_settings set value = 'true'::jsonb, updated_at = now() where key = 'require_admin_mfa';

-- ---------- rate limiting ----------
create table private.rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (bucket, subject)
);
revoke all on private.rate_limits from public, anon, authenticated;

-- Conta uma ocorrência e recusa acima do limite. O sujeito é o usuário autenticado.
create or replace function private.rate_limit(_bucket text, _max integer, _window_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  who text := coalesce(auth.uid()::text, 'anon');
  n integer;
begin
  insert into private.rate_limits as r (bucket, subject, window_start, hits)
  values (_bucket, who, now(), 1)
  on conflict (bucket, subject) do update
    set hits = case when r.window_start < now() - make_interval(secs => _window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => _window_seconds) then now() else r.window_start end
  returning hits into n;
  if n > _max then
    raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
      using errcode = 'PT429';
  end if;
end $$;
revoke all on function private.rate_limit(text, integer, integer) from public, anon, authenticated;

-- Limpeza de janelas antigas (pode ser agendada com pg_cron quando disponível).
create or replace function private.purge_rate_limits() returns integer
language sql security definer set search_path = '' as $$
  with d as (delete from private.rate_limits where window_start < now() - interval '1 day' returning 1)
  select count(*)::int from d
$$;
revoke all on function private.purge_rate_limits() from public, anon, authenticated;

-- Os limites ficam em um único lugar (proporcionais ao uso legítimo).
create or replace function private.limit_for(_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  case _action
    when 'business.submit'      then perform private.rate_limit(_action, 5, 3600);
    when 'admin.review'         then perform private.rate_limit(_action, 120, 600);
    when 'admin.city'           then perform private.rate_limit(_action, 60, 600);
    when 'admin.staff'          then perform private.rate_limit(_action, 60, 600);
    when 'admin.role'           then perform private.rate_limit(_action, 30, 600);
    when 'admin.setting'        then perform private.rate_limit(_action, 30, 600);
    when 'admin.privacy'        then perform private.rate_limit(_action, 60, 600);
    when 'privacy.request'      then perform private.rate_limit(_action, 5, 86400);
    when 'privacy.export'       then perform private.rate_limit(_action, 10, 3600);
    else raise exception 'rate limit não configurado: %', _action;
  end case;
end $$;
revoke all on function private.limit_for(text) from public, anon, authenticated;

-- submit_business_application é recriada com o limite (e sem o nome do negócio na auditoria).

create or replace function public.submit_business_application(
  _name text,
  _business_type public.business_type,
  _city_id uuid,
  _category_id uuid default null,
  _phone text default null,
  _description text default null,
  _address_line text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  max_pending int := coalesce((private.setting('max_pending_business_applications'))::text::int, 3);
  new_id uuid;
  clean_name text := btrim(coalesce(_name, ''));
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('business.submit');
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Informe o nome do negócio (2 a 120 caracteres).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cities where id = _city_id and is_active and not is_demo) then
    raise exception 'Cidade indisponível.' using errcode = 'P0001';
  end if;
  if _category_id is not null and not exists (
       select 1 from public.categories where id = _category_id and not is_demo and kind = _business_type::text) then
    raise exception 'Categoria incompatível com o tipo de negócio.' using errcode = 'P0001';
  end if;
  if _phone is not null and _phone !~ '^[0-9+() -]{8,20}$' then
    raise exception 'Telefone inválido.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(_description, '')) > 1000 or char_length(coalesce(_address_line, '')) > 200 then
    raise exception 'Texto muito longo.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('business_application:' || uid::text));
  if (select count(*) from public.businesses where owner_id = uid and status = 'pending') >= max_pending then
    raise exception 'Você já tem solicitações em análise. Aguarde a resposta da equipe Tucaí.' using errcode = 'P0001';
  end if;

  insert into public.businesses (name, slug, owner_id, status, business_type, category_id, city_id,
                                 phone, description, address_line, submitted_at, is_demo)
  values (clean_name, private.unique_business_slug(clean_name), uid, 'pending', _business_type, _category_id, _city_id,
          nullif(btrim(_phone), ''), nullif(btrim(_description), ''), nullif(btrim(_address_line), ''), now(), false)
  returning id into new_id;

  insert into public.business_members(business_id, user_id, member_role) values (new_id, uid, 'owner');
  perform private.audit('business.submit', 'businesses', new_id::text,
                        jsonb_build_object('type', _business_type));
  return new_id;
end $$;

-- Os wrappers abaixo preservam a lógica da 0005 renomeando-a para private.*_impl e
-- expondo a versão pública com autorização + limite. Assim a regra de negócio não é duplicada.
alter function public.admin_review_business(uuid, text, text) set schema private;
alter function private.admin_review_business(uuid, text, text) rename to admin_review_business_impl;
create function public.admin_review_business(_business uuid, _decision text, _note text default null)
returns public.business_status language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('businesses.review');
  perform private.limit_for('admin.review');
  return private.admin_review_business_impl(_business, _decision, _note);
end $$;

alter function public.admin_save_city(uuid, text, text, numeric, numeric, boolean) set schema private;
alter function private.admin_save_city(uuid, text, text, numeric, numeric, boolean) rename to admin_save_city_impl;
create function public.admin_save_city(
  _id uuid, _name text, _state text, _center_lat numeric default null, _center_lng numeric default null,
  _is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('cities.manage');
  perform private.limit_for('admin.city');
  return private.admin_save_city_impl(_id, _name, _state, _center_lat, _center_lng, _is_active);
end $$;

alter function public.admin_set_staff_permission(uuid, text, boolean) set schema private;
alter function private.admin_set_staff_permission(uuid, text, boolean) rename to admin_set_staff_permission_impl;
create function public.admin_set_staff_permission(_user uuid, _permission text, _granted boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.staff');
  perform private.admin_set_staff_permission_impl(_user, _permission, _granted);
end $$;

alter function public.grant_role(uuid, public.app_role) set schema private;
alter function private.grant_role(uuid, public.app_role) rename to grant_role_impl;
create function public.grant_role(_user uuid, _role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.role');
  perform private.grant_role_impl(_user, _role);
end $$;

alter function public.revoke_role(uuid, public.app_role) set schema private;
alter function private.revoke_role(uuid, public.app_role) rename to revoke_role_impl;
create function public.revoke_role(_user uuid, _role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.role');
  perform private.revoke_role_impl(_user, _role);
end $$;

alter function public.admin_set_setting(text, jsonb) set schema private;
alter function private.admin_set_setting(text, jsonb) rename to admin_set_setting_impl;
create function public.admin_set_setting(_key text, _value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.setting');
  perform private.admin_set_setting_impl(_key, _value);
end $$;

-- ---------- URLs de imagem: somente https ----------
-- NOT VALID: vale para gravações novas sem falhar por linhas antigas; validar depois com
-- "alter table ... validate constraint ..." após conferir os dados remotos.
alter table public.businesses
  add constraint businesses_cover_url_https check (cover_url is null or cover_url ~ '^https://[^\s<>"'']+$') not valid,
  add constraint businesses_logo_url_https check (logo_url is null or logo_url ~ '^https://[^\s<>"'']+$') not valid;
alter table public.products
  add constraint products_image_url_https check (image_url is null or image_url ~ '^https://[^\s<>"'']+$') not valid;

-- ---------- LGPD: solicitações do titular ----------
insert into public.platform_permissions(code, description, sort_order) values
  ('privacy.manage', 'Atender solicitações de privacidade (LGPD)', 55);

create type public.privacy_request_kind as enum
  ('access', 'correction', 'portability', 'deletion', 'sharing_info', 'consent_revocation', 'objection');
create type public.privacy_request_status as enum ('open', 'in_progress', 'completed', 'rejected');

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  -- set null: o registro do atendimento é preservado mesmo após a exclusão da conta
  user_id uuid references auth.users(id) on delete set null,
  kind public.privacy_request_kind not null,
  details text check (details is null or char_length(details) <= 2000),
  status public.privacy_request_status not null default 'open',
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index privacy_requests_user_idx on public.privacy_requests(user_id, created_at desc);
create index privacy_requests_status_idx on public.privacy_requests(status, created_at);
create index privacy_requests_resolved_by_idx on public.privacy_requests(resolved_by);

alter table public.privacy_requests enable row level security;
create policy privacy_requests_select on public.privacy_requests for select to authenticated
  using (user_id = auth.uid() or public.has_platform_permission('privacy.manage'));
revoke all on public.privacy_requests from public, anon, authenticated;
grant select on public.privacy_requests to authenticated;

create or replace function public.submit_privacy_request(_kind public.privacy_request_kind, _details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('privacy.request');
  if char_length(coalesce(_details, '')) > 2000 then
    raise exception 'Texto muito longo (máximo 2000 caracteres).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.privacy_requests where user_id = uid and kind = _kind and status in ('open', 'in_progress')) then
    raise exception 'Você já tem uma solicitação deste tipo em andamento.' using errcode = 'P0001';
  end if;
  insert into public.privacy_requests(user_id, kind, details)
  values (uid, _kind, nullif(btrim(coalesce(_details, '')), ''))
  returning id into new_id;
  -- auditoria sem o texto livre (pode conter dados pessoais)
  perform private.audit('privacy.request', 'privacy_requests', new_id::text, jsonb_build_object('kind', _kind));
  return new_id;
end $$;

-- Portabilidade/acesso: tudo o que a plataforma guarda sobre o próprio usuário.
create or replace function public.my_data_export() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('privacy.export');
  return jsonb_build_object(
    'generated_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email) from auth.users u where u.id = uid),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.role, 'since', r.created_at)) from public.user_roles r where r.user_id = uid), '[]'::jsonb),
    'business_memberships', coalesce((select jsonb_agg(jsonb_build_object('business', b.name, 'role', m.member_role, 'since', m.created_at))
                                       from public.business_members m join public.businesses b on b.id = m.business_id
                                      where m.user_id = uid), '[]'::jsonb),
    'businesses_owned', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'status', b.status, 'phone', b.phone,
                                                                      'address_line', b.address_line, 'submitted_at', b.submitted_at))
                                   from public.businesses b where b.owner_id = uid), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('rating', v.rating, 'comment', v.comment, 'created_at', v.created_at))
                          from public.reviews v where v.user_id = uid), '[]'::jsonb),
    'privacy_requests', coalesce((select jsonb_agg(jsonb_build_object('kind', q.kind, 'status', q.status, 'created_at', q.created_at,
                                                                      'resolved_at', q.resolved_at, 'resolution_note', q.resolution_note))
                                   from public.privacy_requests q where q.user_id = uid), '[]'::jsonb),
    'notes', jsonb_build_array(
      'Senha: guardada apenas como hash pelo Supabase Auth; nunca é exportada.',
      'Registros de auditoria e dados fiscais/financeiros podem ser mantidos pelo prazo legal.'));
end $$;

-- Anonimização: remove dados pessoais do perfil sem apagar registros comerciais/fiscais.
-- A exclusão definitiva da conta de login (auth.users) é feita pelo painel do Supabase
-- (Authentication -> Users), seguindo o procedimento documentado em docs/LGPD.md.
create or replace function private.anonymize_user(_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set full_name = null, phone = null, preferred_city_id = null where id = _user;
  update public.reviews set author_name = null where user_id = _user;
end $$;
revoke all on function private.anonymize_user(uuid) from public, anon, authenticated;

create or replace function public.admin_list_privacy_requests(_status public.privacy_request_status default null)
returns table (id uuid, user_id uuid, user_email text, kind public.privacy_request_kind, details text,
               status public.privacy_request_status, resolution_note text, resolved_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('privacy.manage');
  return query
    select q.id, q.user_id, u.email::text, q.kind, q.details, q.status, q.resolution_note, q.resolved_at, q.created_at
      from public.privacy_requests q left join auth.users u on u.id = q.user_id
     where _status is null or q.status = _status
     order by q.created_at
     limit 200;
end $$;

create or replace function public.admin_resolve_privacy_request(
  _request uuid, _status public.privacy_request_status, _note text, _anonymize boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare q public.privacy_requests%rowtype; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('privacy.manage');
  perform private.limit_for('admin.privacy');
  select * into q from public.privacy_requests where id = _request for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  if q.status in ('completed', 'rejected') then
    raise exception 'Solicitação já encerrada.' using errcode = 'P0001';
  end if;
  if _status = 'open' then raise exception 'Status inválido.' using errcode = 'P0001'; end if;
  if _status in ('completed', 'rejected') and note is null then
    raise exception 'Registre o resultado do atendimento.' using errcode = 'P0001';
  end if;
  if _anonymize then
    -- confirmação explícita e restrita a pedidos de exclusão concluídos
    if q.kind <> 'deletion' or _status <> 'completed' or q.user_id is null then
      raise exception 'Anonimização só ao concluir um pedido de exclusão.' using errcode = 'P0001';
    end if;
    if q.user_id = auth.uid() then
      raise exception 'Você não pode atender a própria solicitação.' using errcode = '42501';
    end if;
    perform private.anonymize_user(q.user_id);
  end if;
  update public.privacy_requests
     set status = _status, resolution_note = note,
         resolved_by = case when _status in ('completed', 'rejected') then auth.uid() end,
         resolved_at = case when _status in ('completed', 'rejected') then now() end
   where id = q.id;
  perform private.audit('privacy.' || _status::text, 'privacy_requests', q.id::text,
                        jsonb_build_object('kind', q.kind, 'anonymized', coalesce(_anonymize, false)));
end $$;

-- ---------- privilégios ----------
do $$
declare f text;
begin
  foreach f in array array[
    'private.admin_review_business_impl(uuid, text, text)',
    'private.admin_save_city_impl(uuid, text, text, numeric, numeric, boolean)',
    'private.admin_set_staff_permission_impl(uuid, text, boolean)',
    'private.grant_role_impl(uuid, public.app_role)',
    'private.revoke_role_impl(uuid, public.app_role)',
    'private.admin_set_setting_impl(text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.submit_business_application(text, public.business_type, uuid, uuid, text, text, text)',
    'public.admin_review_business(uuid, text, text)',
    'public.admin_save_city(uuid, text, text, numeric, numeric, boolean)',
    'public.admin_set_staff_permission(uuid, text, boolean)',
    'public.grant_role(uuid, public.app_role)',
    'public.revoke_role(uuid, public.app_role)',
    'public.admin_set_setting(text, jsonb)',
    'public.submit_privacy_request(public.privacy_request_kind, text)',
    'public.my_data_export()',
    'public.admin_list_privacy_requests(public.privacy_request_status)',
    'public.admin_resolve_privacy_request(uuid, public.privacy_request_status, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0006', '0006_security_privacy.sql', 'applied');
    raise notice 'Tucaí 0006: aplicada agora';
  end if;
end $tucai_0006$;

-- ===================== supabase/migrations/0007_merchant_panel.sql =====================
do $tucai_0007$
begin
  if exists (select 1 from private.tucai_migrations where version = '0007') then
    raise notice 'Tucaí 0007: já aplicada';
  elsif exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'businesses' and policyname = 'businesses_member_update') then
    insert into private.tucai_migrations(version, name, how) values ('0007', '0007_merchant_panel.sql', 'detected');
    raise notice 'Tucaí 0007: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0007_merchant_panel: escrita do painel do estabelecimento com RLS por permissão.
--  * Membros leem os próprios dados (inclusive antes da aprovação, para preparar a loja).
--  * Loja/horários: store.customize ou settings.manage. Cardápio: menu.manage.
--  * Colunas sensíveis nunca são graváveis pelo comerciante: status, owner_id, slug, notas,
--    is_featured, popularity_score, rating_*, is_demo, is_popular (afirmação "mais pedido"
--    só pode vir de dados reais de vendas, não do próprio comerciante).
--  * Mudanças de preço ficam na auditoria.

-- ---------- estabelecimento ----------
drop policy businesses_owner_update on public.businesses;
create policy businesses_member_update on public.businesses for update to authenticated
  using (public.has_business_permission(id, 'store.customize') or public.has_business_permission(id, 'settings.manage'))
  with check (public.has_business_permission(id, 'store.customize') or public.has_business_permission(id, 'settings.manage'));

revoke update on public.businesses from authenticated;
grant update (name, description, phone, whatsapp, address_line, cover_url, logo_url, category_id,
              delivery_offer, own_delivery_fee_cents, accepts_pickup, estimated_min_minutes,
              estimated_max_minutes, min_order_cents)
  on public.businesses to authenticated;

-- a categoria precisa ser do mesmo tipo do estabelecimento
create or replace function private.businesses_category_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.category_id is not null and not exists (
       select 1 from public.categories where id = new.category_id and kind = new.business_type::text and not is_demo) then
    raise exception 'Categoria incompatível com o tipo de negócio.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.businesses_category_guard() from public, anon, authenticated;
create trigger businesses_category_guard before insert or update of category_id on public.businesses
  for each row execute function private.businesses_category_guard();

alter table public.businesses
  add constraint businesses_description_len check (description is null or char_length(description) <= 1000) not valid,
  add constraint businesses_fee_cap check (own_delivery_fee_cents <= 100000) not valid,
  add constraint businesses_min_order_cap check (min_order_cents <= 1000000) not valid;

-- ---------- horários ----------
create policy business_hours_member_select on public.business_hours for select to authenticated
  using (public.is_business_member(business_id));
create policy business_hours_member_write on public.business_hours for all to authenticated
  using (public.has_business_permission(business_id, 'store.customize') or public.has_business_permission(business_id, 'settings.manage'))
  with check (public.has_business_permission(business_id, 'store.customize') or public.has_business_permission(business_id, 'settings.manage'));
grant insert, update, delete on public.business_hours to authenticated;

-- ---------- cardápio ----------
create policy menu_categories_member_select on public.menu_categories for select to authenticated
  using (public.is_business_member(business_id));
create policy menu_categories_member_write on public.menu_categories for all to authenticated
  using (public.has_business_permission(business_id, 'menu.manage'))
  with check (public.has_business_permission(business_id, 'menu.manage'));
grant insert (business_id, name, sort_order, is_active) on public.menu_categories to authenticated;
grant update (name, sort_order, is_active) on public.menu_categories to authenticated;
grant delete on public.menu_categories to authenticated;

create policy products_member_select on public.products for select to authenticated
  using (public.is_business_member(business_id));
create policy products_member_write on public.products for all to authenticated
  using (public.has_business_permission(business_id, 'menu.manage'))
  with check (public.has_business_permission(business_id, 'menu.manage'));
grant insert (business_id, category_id, name, description, price_cents, image_url, is_available, sort_order)
  on public.products to authenticated;
grant update (category_id, name, description, price_cents, image_url, is_available, sort_order)
  on public.products to authenticated;
grant delete on public.products to authenticated;
alter table public.products
  add constraint products_price_cap check (price_cents <= 10000000) not valid;

create policy option_groups_member_select on public.option_groups for select to authenticated
  using (public.is_business_member(business_id));
create policy option_groups_member_write on public.option_groups for all to authenticated
  using (public.has_business_permission(business_id, 'menu.manage'))
  with check (public.has_business_permission(business_id, 'menu.manage'));
grant insert (business_id, product_id, name, min_select, max_select, sort_order) on public.option_groups to authenticated;
grant update (name, min_select, max_select, sort_order) on public.option_groups to authenticated;
grant delete on public.option_groups to authenticated;

create policy options_member_select on public.options for select to authenticated
  using (public.is_business_member(business_id));
create policy options_member_write on public.options for all to authenticated
  using (public.has_business_permission(business_id, 'menu.manage'))
  with check (public.has_business_permission(business_id, 'menu.manage'));
grant insert (business_id, group_id, name, price_delta_cents, is_available, sort_order) on public.options to authenticated;
grant update (name, price_delta_cents, is_available, sort_order) on public.options to authenticated;
grant delete on public.options to authenticated;

-- ---------- auditoria de preços ----------
create or replace function private.audit_product_price() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('product.create', 'products', new.id::text,
      jsonb_build_object('business_id', new.business_id, 'price_cents', new.price_cents));
  elsif new.price_cents is distinct from old.price_cents then
    perform private.audit('product.price', 'products', new.id::text,
      jsonb_build_object('business_id', new.business_id, 'from', old.price_cents, 'to', new.price_cents));
  end if;
  return null;
end $$;
revoke all on function private.audit_product_price() from public, anon, authenticated;
create trigger products_audit_price after insert or update of price_cents on public.products
  for each row execute function private.audit_product_price();

-- O nome do negócio (identidade comercial) continua exigindo settings.manage (dono).
create or replace function private.businesses_name_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- só para chamadas da API (PostgREST faz SET ROLE authenticated); manutenção interna não passa aqui
  if new.name is distinct from old.name and current_setting('role', true) in ('authenticated', 'anon')
     and not public.has_business_permission(new.id, 'settings.manage') then
    raise exception 'Somente o responsável pode alterar o nome do negócio.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.businesses_name_guard() from public, anon, authenticated;
create trigger businesses_name_guard before update of name on public.businesses
  for each row execute function private.businesses_name_guard();

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0007', '0007_merchant_panel.sql', 'applied');
    raise notice 'Tucaí 0007: aplicada agora';
  end if;
end $tucai_0007$;

-- ===================== supabase/migrations/0008_conecta_feed.sql =====================
do $tucai_0008$
begin
  if exists (select 1 from private.tucai_migrations where version = '0008') then
    raise notice 'Tucaí 0008: já aplicada';
  elsif to_regclass('public.social_profiles') is not null then
    insert into private.tucai_migrations(version, name, how) values ('0008', '0008_conecta_feed.sql', 'detected');
    raise notice 'Tucaí 0008: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0008_conecta_feed: Tucaí Conecta — perfis sociais, feed, comentários, curtidas, salvos,
-- seguir (pessoas e estabelecimentos), bloqueio, denúncias, moderação humana com contestação,
-- suspensão e notificações. Reutiliza auth.users, businesses, products e cities.
-- Princípios: críticas legítimas são permitidas; nada é removido automaticamente; termos de
-- ameaça explícita só geram sinalização para revisão humana.

-- ---------- perfis sociais ----------
create table public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60),
  bio text check (bio is null or char_length(bio) <= 300),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://[^\s<>"'']+$'),
  -- cidade só aparece se a própria pessoa informar (nulo = não divulgada)
  city_id uuid references public.cities(id) on delete set null,
  -- perfil fechado: publicações só para seguidores
  is_public boolean not null default true,
  conecta_suspended_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index social_profiles_city_idx on public.social_profiles(city_id);
create trigger social_profiles_updated before update on public.social_profiles
  for each row execute function public.set_updated_at();

-- ---------- seguir e bloquear ----------
create table public.follows (
  follower_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  followee_id uuid not null references public.social_profiles(user_id) on delete cascade,
  -- perfil fechado: a seguida fica pendente até a pessoa aprovar
  status text not null default 'accepted' check (status in ('accepted', 'pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows(followee_id);

create table public.business_follows (
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);
create index business_follows_business_idx on public.business_follows(business_id);

create table public.user_blocks (
  blocker_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks(blocked_id);

create or replace function public.is_blocked_between(_a uuid, _b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_blocks
                  where (blocker_id = _a and blocked_id = _b) or (blocker_id = _b and blocked_id = _a))
$$;

-- O usuário atual pode ver conteúdo deste autor? (perfil aberto ou seguidor, e sem bloqueio)
create or replace function public.conecta_can_see(_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select _author = auth.uid()
      or (not public.is_blocked_between(_author, auth.uid())
          and exists (select 1 from public.social_profiles p where p.user_id = _author
                        and (p.is_public or exists (select 1 from public.follows f
                                                     where f.follower_id = auth.uid() and f.followee_id = _author
                                                       and f.status = 'accepted'))))
$$;

-- ---------- publicações ----------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  -- publicação em nome de um estabelecimento (exige permissão no estabelecimento)
  business_id uuid references public.businesses(id) on delete cascade,
  product_id uuid,
  city_id uuid references public.cities(id) on delete set null,
  shared_post_id uuid references public.posts(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  -- patrocínio só pode ser marcado pela plataforma (campanhas); nunca pelo autor
  is_sponsored boolean not null default false,
  status text not null default 'published' check (status in ('published', 'hidden')),
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  check (product_id is null or business_id is not null),
  foreign key (product_id, business_id) references public.products(id, business_id) on delete set null (product_id)
);
create index posts_city_created_idx on public.posts(city_id, created_at desc, id desc);
create index posts_author_created_idx on public.posts(author_id, created_at desc);
create index posts_business_idx on public.posts(business_id, created_at desc);
create index posts_shared_idx on public.posts(shared_post_id);
create index posts_product_idx on public.posts(product_id, business_id);
create index posts_created_idx on public.posts(created_at desc, id desc);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  parent_id uuid references public.post_comments(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index post_comments_post_idx on public.post_comments(post_id, created_at);
create index post_comments_author_idx on public.post_comments(author_id);
create index post_comments_parent_idx on public.post_comments(parent_id);

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes(user_id);

create table public.post_saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_saves_user_idx on public.post_saves(user_id, created_at desc);

-- ---------- notificações ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('like', 'comment', 'reply', 'follow', 'moderation')),
  actor_id uuid references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  message text check (message is null or char_length(message) <= 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_actor_idx on public.notifications(actor_id);
create index notifications_post_idx on public.notifications(post_id);
create index notifications_comment_idx on public.notifications(comment_id);

create or replace function private.notify(_user uuid, _kind text, _actor uuid, _post uuid, _comment uuid, _message text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if _user is null or _user = _actor then return; end if;
  if _actor is not null and public.is_blocked_between(_user, _actor) then return; end if;
  -- evita enxurrada: uma curtida/seguida não lida do mesmo autor basta
  if _kind in ('like', 'follow') and exists (
       select 1 from public.notifications where user_id = _user and kind = _kind and actor_id = _actor
          and post_id is not distinct from _post and read_at is null) then
    return;
  end if;
  insert into public.notifications(user_id, kind, actor_id, post_id, comment_id, message)
  values (_user, _kind, _actor, _post, _comment, _message);
end $$;

-- ---------- denúncias, moderação e contestação ----------
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  -- nulo = sinalização automática para revisão humana
  reporter_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('post', 'comment', 'profile')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'threat', 'sexual', 'false_info', 'other', 'auto_flag')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index content_reports_status_idx on public.content_reports(status, created_at);
create index content_reports_target_idx on public.content_reports(target_type, target_id);
create index content_reports_reporter_idx on public.content_reports(reporter_id);
create index content_reports_resolved_by_idx on public.content_reports(resolved_by);
create unique index content_reports_one_open_idx on public.content_reports(reporter_id, target_type, target_id)
  where status = 'open' and reporter_id is not null;

create table public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'suspension')),
  target_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status text not null default 'open' check (status in ('open', 'upheld', 'reversed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index moderation_appeals_status_idx on public.moderation_appeals(status, created_at);
create index moderation_appeals_author_idx on public.moderation_appeals(author_id);
create index moderation_appeals_resolved_by_idx on public.moderation_appeals(resolved_by);
create unique index moderation_appeals_one_open_idx on public.moderation_appeals(author_id, target_type, target_id) where status = 'open';

-- limites de uso do Conecta (somam-se aos da 0006)
create or replace function private.limit_for(_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  case _action
    when 'business.submit'      then perform private.rate_limit(_action, 5, 3600);
    when 'admin.review'         then perform private.rate_limit(_action, 120, 600);
    when 'admin.city'           then perform private.rate_limit(_action, 60, 600);
    when 'admin.staff'          then perform private.rate_limit(_action, 60, 600);
    when 'admin.role'           then perform private.rate_limit(_action, 30, 600);
    when 'admin.setting'        then perform private.rate_limit(_action, 30, 600);
    when 'admin.privacy'        then perform private.rate_limit(_action, 60, 600);
    when 'privacy.request'      then perform private.rate_limit(_action, 5, 86400);
    when 'privacy.export'       then perform private.rate_limit(_action, 10, 3600);
    when 'conecta.post'         then perform private.rate_limit(_action, 10, 600);
    when 'conecta.comment'      then perform private.rate_limit(_action, 30, 600);
    when 'conecta.like'         then perform private.rate_limit(_action, 200, 600);
    when 'conecta.follow'       then perform private.rate_limit(_action, 60, 600);
    when 'conecta.report'       then perform private.rate_limit(_action, 20, 86400);
    when 'conecta.appeal'       then perform private.rate_limit(_action, 5, 86400);
    when 'admin.moderation'     then perform private.rate_limit(_action, 300, 600);
    else raise exception 'rate limit não configurado: %', _action;
  end case;
end $$;

-- Sinalização conservadora: só ameaças explícitas; não bloqueia, vai para revisão humana.
create or replace function private.needs_review(_text text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(_text) ~ '(vou|vamos) (te|lhe) (matar|esfaquear|dar um tiro)|(te|vou) (achar|pegar) na rua|merece morrer'
$$;

create or replace function private.conecta_author_guard() returns void
language plpgsql stable security definer set search_path = '' as $$
declare until timestamptz;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select conecta_suspended_until into until from public.social_profiles where user_id = auth.uid();
  if not found then
    raise exception 'Crie seu perfil no Conecta antes de interagir.' using errcode = 'P0001';
  end if;
  if until is not null and until > now() then
    raise exception 'Sua conta está suspensa no Conecta até %. Você pode contestar a decisão.',
      to_char(until at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') using errcode = 'P0001';
  end if;
end $$;

-- ---------- gatilhos de publicações ----------
create or replace function private.posts_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.post');
  new.body := btrim(new.body);
  new.is_sponsored := false;
  new.status := 'published';
  new.like_count := 0;
  new.comment_count := 0;
  if new.business_id is not null then
    if not (public.has_business_permission(new.business_id, 'store.customize') or public.has_business_permission(new.business_id, 'settings.manage')) then
      raise exception 'Você não pode publicar em nome deste estabelecimento.' using errcode = '42501';
    end if;
    if not public.is_active_business(new.business_id) then
      raise exception 'O estabelecimento precisa estar aprovado para publicar.' using errcode = 'P0001';
    end if;
  end if;
  if new.shared_post_id is not null and not exists (
       select 1 from public.posts p where p.id = new.shared_post_id and p.status = 'published' and public.conecta_can_see(p.author_id)) then
    raise exception 'Publicação compartilhada indisponível.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.posts where author_id = new.author_id and body = new.body
               and created_at > now() - interval '10 minutes') then
    raise exception 'Você acabou de publicar este mesmo texto.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.posts_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.needs_review(new.body) then
    insert into public.content_reports(reporter_id, target_type, target_id, reason)
    values (null, 'post', new.id, 'auto_flag');
  end if;
  return null;
end $$;

create or replace function private.posts_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- só o texto é editável pelo autor (grant por coluna); status/contadores vêm de funções internas
  if new.body is distinct from old.body then
    if old.status = 'hidden' then
      raise exception 'Publicação ocultada pela moderação não pode ser editada. Conteste a decisão.' using errcode = 'P0001';
    end if;
    new.body := btrim(new.body);
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger posts_before_insert before insert on public.posts for each row execute function private.posts_before_insert();
create trigger posts_after_insert after insert on public.posts for each row execute function private.posts_after_insert();
create trigger posts_before_update before update on public.posts for each row execute function private.posts_before_update();

-- ---------- gatilhos de comentários ----------
create or replace function private.comments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid; post_status text; parent public.post_comments%rowtype;
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.comment');
  new.body := btrim(new.body);
  new.status := 'published';
  select author_id, status into post_author, post_status from public.posts where id = new.post_id;
  if post_author is null or post_status <> 'published' or not public.conecta_can_see(post_author) then
    raise exception 'Publicação indisponível.' using errcode = 'P0001';
  end if;
  if new.parent_id is not null then
    select * into parent from public.post_comments where id = new.parent_id;
    if not found or parent.post_id <> new.post_id or parent.parent_id is not null or parent.status <> 'published' then
      raise exception 'Resposta inválida.' using errcode = 'P0001';
    end if;
    if public.is_blocked_between(parent.author_id, auth.uid()) then
      raise exception 'Não é possível responder a este comentário.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function private.comments_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid; parent_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id returning author_id into post_author;
    if new.parent_id is not null then
      select author_id into parent_author from public.post_comments where id = new.parent_id;
      perform private.notify(parent_author, 'reply', new.author_id, new.post_id, new.id);
    end if;
    if post_author is distinct from parent_author then
      perform private.notify(post_author, 'comment', new.author_id, new.post_id, new.id);
    end if;
    if private.needs_review(new.body) then
      insert into public.content_reports(reporter_id, target_type, target_id, reason) values (null, 'comment', new.id, 'auto_flag');
    end if;
  elsif tg_op = 'DELETE' then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;

create or replace function private.comments_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- só o texto é editável pelo autor (grant por coluna); status/contadores vêm de funções internas
  if new.body is distinct from old.body then
    if old.status = 'hidden' then
      raise exception 'Comentário ocultado pela moderação não pode ser editado.' using errcode = 'P0001';
    end if;
    new.body := btrim(new.body);
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger comments_before_insert before insert on public.post_comments for each row execute function private.comments_before_insert();
create trigger comments_after_change after insert or delete on public.post_comments for each row execute function private.comments_after_change();
create trigger comments_before_update before update on public.post_comments for each row execute function private.comments_before_update();

-- ---------- curtidas, seguidas, bloqueios ----------
create or replace function private.likes_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid; post_status text;
begin
  perform private.conecta_author_guard();
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.like');
  select author_id, status into post_author, post_status from public.posts where id = new.post_id;
  if post_author is null or post_status <> 'published' or not public.conecta_can_see(post_author) then
    raise exception 'Publicação indisponível.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.likes_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id returning author_id into post_author;
    perform private.notify(post_author, 'like', new.user_id, new.post_id, null);
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;

create trigger likes_before_insert before insert on public.post_likes for each row execute function private.likes_before_insert();
create trigger likes_after_change after insert or delete on public.post_likes for each row execute function private.likes_after_change();

create or replace function private.saves_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid;
begin
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  select author_id into post_author from public.posts where id = new.post_id and status = 'published';
  if post_author is null or not public.conecta_can_see(post_author) then
    raise exception 'Publicação indisponível.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger saves_before_insert before insert on public.post_saves for each row execute function private.saves_before_insert();

create or replace function private.follows_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.follower_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.follow');
  if public.is_blocked_between(new.follower_id, new.followee_id) then
    raise exception 'Não é possível seguir este perfil.' using errcode = 'P0001';
  end if;
  new.status := case when exists (select 1 from public.social_profiles where user_id = new.followee_id and not is_public)
                     then 'pending' else 'accepted' end;
  return new;
end $$;
-- só quem é seguido aprova (pending -> accepted); recusar = apagar a linha
create or replace function private.follows_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'accepted' or old.status <> 'pending' then
    raise exception 'Alteração inválida.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function private.follows_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.followee_id, 'follow', new.follower_id, null, null,
    case when new.status = 'pending' then 'quer seguir você. Aprove ou recuse em Seguidores.' end);
  return null;
end $$;
create trigger follows_before_insert before insert on public.follows for each row execute function private.follows_before_insert();
create trigger follows_after_insert after insert on public.follows for each row execute function private.follows_after_insert();
create trigger follows_before_update before update on public.follows for each row execute function private.follows_before_update();

create or replace function private.business_follows_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.follow');
  if not public.is_active_business(new.business_id) then
    raise exception 'Estabelecimento indisponível.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger business_follows_before_insert before insert on public.business_follows for each row execute function private.business_follows_before_insert();

-- bloquear desfaz as seguidas nos dois sentidos
create or replace function private.blocks_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.follows where (follower_id = new.blocker_id and followee_id = new.blocked_id)
                               or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return null;
end $$;
create trigger blocks_after_insert after insert on public.user_blocks for each row execute function private.blocks_after_insert();

-- ---------- denúncias e contestação (titular) ----------
create or replace function public.report_content(_target_type text, _target_id uuid, _reason text, _details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.report');
  if _reason = 'auto_flag' or _reason is null then raise exception 'Motivo inválido.' using errcode = 'P0001'; end if;
  if char_length(coalesce(_details, '')) > 1000 then raise exception 'Texto muito longo.' using errcode = 'P0001'; end if;
  if not ((_target_type = 'post' and exists (select 1 from public.posts where id = _target_id))
       or (_target_type = 'comment' and exists (select 1 from public.post_comments where id = _target_id))
       or (_target_type = 'profile' and exists (select 1 from public.social_profiles where user_id = _target_id))) then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0001';
  end if;
  insert into public.content_reports(reporter_id, target_type, target_id, reason, details)
  values (auth.uid(), _target_type, _target_id, _reason, nullif(btrim(coalesce(_details, '')), ''))
  on conflict do nothing
  returning id into new_id;
  if new_id is null then raise exception 'Você já denunciou este conteúdo; a denúncia está em análise.' using errcode = 'P0001'; end if;
  return new_id;
end $$;

create or replace function public.appeal_moderation(_target_type text, _target_id uuid, _reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.appeal');
  if not ((_target_type = 'post' and exists (select 1 from public.posts where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'comment' and exists (select 1 from public.post_comments where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'suspension' and _target_id = uid and exists (select 1 from public.social_profiles
                                                                      where user_id = uid and conecta_suspended_until > now()))) then
    raise exception 'Não há decisão de moderação para contestar.' using errcode = 'P0001';
  end if;
  insert into public.moderation_appeals(author_id, target_type, target_id, reason)
  values (uid, _target_type, _target_id, btrim(coalesce(_reason, '')))
  on conflict do nothing returning id into new_id;
  if new_id is null then raise exception 'Já existe uma contestação em análise.' using errcode = 'P0001'; end if;
  return new_id;
end $$;

-- ---------- moderação (equipe com moderation.manage + MFA) ----------
create or replace function public.admin_list_reports(_status text default 'open')
returns table (id uuid, target_type text, target_id uuid, reason text, details text, status text, created_at timestamptz,
               reporter_email text, content_body text, content_status text, author_id uuid, author_handle text, open_reports bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('moderation.manage');
  return query
    select r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at, u.email::text,
           coalesce(p.body, c.body, sp.bio, ''),
           coalesce(p.status, c.status, 'published'),
           coalesce(p.author_id, c.author_id, sp.user_id),
           coalesce(pa.handle, ca.handle, sp.handle),
           (select count(*) from public.content_reports x where x.target_type = r.target_type and x.target_id = r.target_id and x.status = 'open')
      from public.content_reports r
      left join auth.users u on u.id = r.reporter_id
      left join public.posts p on r.target_type = 'post' and p.id = r.target_id
      left join public.social_profiles pa on pa.user_id = p.author_id
      left join public.post_comments c on r.target_type = 'comment' and c.id = r.target_id
      left join public.social_profiles ca on ca.user_id = c.author_id
      left join public.social_profiles sp on r.target_type = 'profile' and sp.user_id = r.target_id
     where _status is null or r.status = _status
     order by r.created_at
     limit 200;
end $$;

create or replace function private.set_content_status(_type text, _id uuid, _status text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare author uuid;
begin
  if _type = 'post' then
    update public.posts set status = _status where id = _id returning author_id into author;
  elsif _type = 'comment' then
    update public.post_comments set status = _status where id = _id returning author_id into author;
  end if;
  return author;
end $$;

-- action: 'dismiss' (sem violação) | 'hide' (oculta o conteúdo). Resolve todas as denúncias abertas do alvo.
create or replace function public.admin_moderate(_report uuid, _action text, _note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.content_reports%rowtype; author uuid; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('moderation.manage');
  perform private.limit_for('admin.moderation');
  select * into r from public.content_reports where id = _report for update;
  if not found or r.status <> 'open' then raise exception 'Denúncia não encontrada ou já resolvida.' using errcode = 'P0001'; end if;
  if note is null then raise exception 'Registre o motivo da decisão.' using errcode = 'P0001'; end if;
  if _action not in ('dismiss', 'hide') then raise exception 'Ação inválida.' using errcode = 'P0001'; end if;
  if _action = 'hide' then
    if r.target_type = 'profile' then raise exception 'Para perfis, use a suspensão.' using errcode = 'P0001'; end if;
    author := private.set_content_status(r.target_type, r.target_id, 'hidden');
    if author = auth.uid() then raise exception 'Você não pode moderar o próprio conteúdo.' using errcode = '42501'; end if;
    perform private.notify(author, 'moderation', null,
      case when r.target_type = 'post' then r.target_id end, case when r.target_type = 'comment' then r.target_id end,
      'Seu conteúdo foi ocultado por violar as regras do Conecta: ' || note || ' Você pode contestar.');
  end if;
  update public.content_reports
     set status = case when _action = 'hide' then 'actioned' else 'dismissed' end,
         resolution_note = note, resolved_by = auth.uid(), resolved_at = now()
   where target_type = r.target_type and target_id = r.target_id and status = 'open';
  perform private.audit('moderation.' || _action, r.target_type, r.target_id::text, jsonb_build_object('report', r.id, 'reason', r.reason));
end $$;

create or replace function public.admin_suspend_user(_user uuid, _until timestamptz, _note text)
returns void language plpgsql security definer set search_path = '' as $$
declare note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('moderation.manage');
  perform private.limit_for('admin.moderation');
  if _user = auth.uid() then raise exception 'Você não pode suspender a si mesmo.' using errcode = '42501'; end if;
  if note is null then raise exception 'Registre o motivo da decisão.' using errcode = 'P0001'; end if;
  if _until is not null and (_until <= now() or _until > now() + interval '365 days') then
    raise exception 'Prazo inválido (até 365 dias).' using errcode = 'P0001';
  end if;
  update public.social_profiles set conecta_suspended_until = _until where user_id = _user;
  if not found then raise exception 'Perfil não encontrado.' using errcode = 'P0001'; end if;
  perform private.notify(_user, 'moderation', null, null, null,
    case when _until is null then 'Sua suspensão no Conecta foi encerrada.'
         else 'Sua conta foi suspensa no Conecta: ' || note || ' Você pode contestar.' end);
  perform private.audit(case when _until is null then 'moderation.unsuspend' else 'moderation.suspend' end,
                        'social_profiles', _user::text, jsonb_build_object('until', _until));
end $$;

create or replace function public.admin_list_appeals(_status text default 'open')
returns table (id uuid, author_id uuid, author_handle text, target_type text, target_id uuid, reason text, status text,
               content_body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('moderation.manage');
  return query
    select a.id, a.author_id, sp.handle, a.target_type, a.target_id, a.reason, a.status,
           coalesce(p.body, c.body, ''), a.created_at
      from public.moderation_appeals a
      left join public.social_profiles sp on sp.user_id = a.author_id
      left join public.posts p on a.target_type = 'post' and p.id = a.target_id
      left join public.post_comments c on a.target_type = 'comment' and c.id = a.target_id
     where _status is null or a.status = _status
     order by a.created_at
     limit 200;
end $$;

-- decision: 'uphold' (mantém) | 'reverse' (desfaz: republica ou encerra a suspensão)
create or replace function public.admin_resolve_appeal(_appeal uuid, _decision text, _note text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.moderation_appeals%rowtype; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('moderation.manage');
  perform private.limit_for('admin.moderation');
  select * into a from public.moderation_appeals where id = _appeal for update;
  if not found or a.status <> 'open' then raise exception 'Contestação não encontrada ou já resolvida.' using errcode = 'P0001'; end if;
  if a.author_id = auth.uid() then raise exception 'Você não pode julgar a própria contestação.' using errcode = '42501'; end if;
  if note is null then raise exception 'Registre o motivo da decisão.' using errcode = 'P0001'; end if;
  if _decision not in ('uphold', 'reverse') then raise exception 'Decisão inválida.' using errcode = 'P0001'; end if;
  if _decision = 'reverse' then
    if a.target_type = 'suspension' then
      update public.social_profiles set conecta_suspended_until = null where user_id = a.author_id;
    else
      perform private.set_content_status(a.target_type, a.target_id, 'published');
    end if;
  end if;
  update public.moderation_appeals
     set status = case when _decision = 'reverse' then 'reversed' else 'upheld' end,
         resolution_note = note, resolved_by = auth.uid(), resolved_at = now()
   where id = a.id;
  perform private.notify(a.author_id, 'moderation', null, null, null,
    case when _decision = 'reverse' then 'Sua contestação foi aceita: ' else 'Sua contestação foi analisada e a decisão foi mantida: ' end || note);
  perform private.audit('moderation.appeal_' || _decision, a.target_type, a.target_id::text, jsonb_build_object('appeal', a.id));
end $$;

-- ---------- RLS ----------
alter table public.social_profiles enable row level security;
alter table public.follows enable row level security;
alter table public.business_follows enable row level security;
alter table public.user_blocks enable row level security;
alter table public.posts enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_saves enable row level security;
alter table public.notifications enable row level security;
alter table public.content_reports enable row level security;
alter table public.moderation_appeals enable row level security;

create policy social_profiles_select on public.social_profiles for select to anon, authenticated
  using (user_id = auth.uid() or not public.is_blocked_between(user_id, auth.uid()));
create policy social_profiles_insert on public.social_profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy social_profiles_update on public.social_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- conexões de perfis fechados não são expostas
create policy follows_select on public.follows for select to anon, authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid()
         or exists (select 1 from public.social_profiles p where p.user_id = followee_id and p.is_public));
create policy follows_insert on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid() or followee_id = auth.uid());
create policy follows_update on public.follows for update to authenticated using (followee_id = auth.uid()) with check (followee_id = auth.uid());

create policy business_follows_select on public.business_follows for select to authenticated
  using (user_id = auth.uid());
create policy business_follows_insert on public.business_follows for insert to authenticated with check (user_id = auth.uid());
create policy business_follows_delete on public.business_follows for delete to authenticated using (user_id = auth.uid());

create policy user_blocks_select on public.user_blocks for select to authenticated using (blocker_id = auth.uid());
create policy user_blocks_insert on public.user_blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy user_blocks_delete on public.user_blocks for delete to authenticated using (blocker_id = auth.uid());

create policy posts_select on public.posts for select to anon, authenticated
  using (author_id = auth.uid() or (status = 'published' and public.conecta_can_see(author_id)));
create policy posts_select_moderation on public.posts for select to authenticated
  using (public.has_platform_permission('moderation.manage'));
create policy posts_insert on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy posts_update on public.posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy posts_delete on public.posts for delete to authenticated using (author_id = auth.uid());

create policy comments_select on public.post_comments for select to anon, authenticated
  using (author_id = auth.uid()
         or (status = 'published' and public.conecta_can_see(author_id)
             and exists (select 1 from public.posts p where p.id = post_id)));
create policy comments_select_moderation on public.post_comments for select to authenticated
  using (public.has_platform_permission('moderation.manage'));
create policy comments_insert on public.post_comments for insert to authenticated with check (author_id = auth.uid());
create policy comments_update on public.post_comments for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
-- o autor do comentário ou o autor da publicação podem apagar
create policy comments_delete on public.post_comments for delete to authenticated
  using (author_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

create policy likes_select on public.post_likes for select to authenticated using (user_id = auth.uid());
create policy likes_insert on public.post_likes for insert to authenticated with check (user_id = auth.uid());
create policy likes_delete on public.post_likes for delete to authenticated using (user_id = auth.uid());

create policy saves_select on public.post_saves for select to authenticated using (user_id = auth.uid());
create policy saves_insert on public.post_saves for insert to authenticated with check (user_id = auth.uid());
create policy saves_delete on public.post_saves for delete to authenticated using (user_id = auth.uid());

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy reports_select on public.content_reports for select to authenticated
  using (reporter_id = auth.uid() or public.has_platform_permission('moderation.manage'));
create policy appeals_select on public.moderation_appeals for select to authenticated
  using (author_id = auth.uid() or public.has_platform_permission('moderation.manage'));

-- ---------- privilégios (por coluna onde há escrita) ----------
revoke all on public.social_profiles, public.follows, public.business_follows, public.user_blocks, public.posts,
  public.post_comments, public.post_likes, public.post_saves, public.notifications, public.content_reports,
  public.moderation_appeals from public, anon, authenticated;

grant select (user_id, handle, display_name, bio, avatar_url, city_id, is_public, created_at) on public.social_profiles to anon, authenticated;
grant insert (user_id, handle, display_name, bio, avatar_url, city_id, is_public) on public.social_profiles to authenticated;
grant update (handle, display_name, bio, avatar_url, city_id, is_public) on public.social_profiles to authenticated;

grant select on public.follows to anon, authenticated;
grant insert (follower_id, followee_id), delete on public.follows to authenticated;
grant update (status) on public.follows to authenticated;
grant select, delete on public.business_follows to authenticated;
grant insert (user_id, business_id) on public.business_follows to authenticated;
grant select, delete on public.user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.user_blocks to authenticated;

grant select on public.posts to anon, authenticated;
grant insert (author_id, business_id, product_id, city_id, shared_post_id, body) on public.posts to authenticated;
grant update (body) on public.posts to authenticated;
grant delete on public.posts to authenticated;

grant select on public.post_comments to anon, authenticated;
grant insert (post_id, author_id, parent_id, body) on public.post_comments to authenticated;
grant update (body) on public.post_comments to authenticated;
grant delete on public.post_comments to authenticated;

grant select, delete on public.post_likes, public.post_saves to authenticated;
grant insert (post_id, user_id) on public.post_likes, public.post_saves to authenticated;

grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant select on public.content_reports, public.moderation_appeals to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'private.notify(uuid, text, uuid, uuid, uuid, text)', 'private.needs_review(text)', 'private.conecta_author_guard()',
    'private.posts_before_insert()', 'private.posts_after_insert()', 'private.posts_before_update()',
    'private.comments_before_insert()', 'private.comments_after_change()', 'private.comments_before_update()',
    'private.likes_before_insert()', 'private.likes_after_change()', 'private.saves_before_insert()',
    'private.follows_before_insert()', 'private.follows_after_insert()', 'private.follows_before_update()', 'private.business_follows_before_insert()',
    'private.blocks_after_insert()', 'private.set_content_status(text, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.is_blocked_between(uuid, uuid)', 'public.conecta_can_see(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.report_content(text, uuid, text, text)', 'public.appeal_moderation(text, uuid, text)',
    'public.admin_list_reports(text)', 'public.admin_moderate(uuid, text, text)',
    'public.admin_suspend_user(uuid, timestamptz, text)', 'public.admin_list_appeals(text)',
    'public.admin_resolve_appeal(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- LGPD: Conecta na exportação e na exclusão ----------
create or replace function public.my_data_export() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('privacy.export');
  return jsonb_build_object(
    'generated_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email) from auth.users u where u.id = uid),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.role, 'since', r.created_at)) from public.user_roles r where r.user_id = uid), '[]'::jsonb),
    'business_memberships', coalesce((select jsonb_agg(jsonb_build_object('business', b.name, 'role', m.member_role, 'since', m.created_at))
                                       from public.business_members m join public.businesses b on b.id = m.business_id
                                      where m.user_id = uid), '[]'::jsonb),
    'businesses_owned', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'status', b.status, 'phone', b.phone,
                                                                      'address_line', b.address_line, 'submitted_at', b.submitted_at))
                                   from public.businesses b where b.owner_id = uid), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('rating', v.rating, 'comment', v.comment, 'created_at', v.created_at))
                          from public.reviews v where v.user_id = uid), '[]'::jsonb),
    'privacy_requests', coalesce((select jsonb_agg(jsonb_build_object('kind', q.kind, 'status', q.status, 'created_at', q.created_at,
                                                                      'resolved_at', q.resolved_at, 'resolution_note', q.resolution_note))
                                   from public.privacy_requests q where q.user_id = uid), '[]'::jsonb),
    'conecta', jsonb_build_object(
      'social_profile', (select to_jsonb(s) - 'user_id' from public.social_profiles s where s.user_id = uid),
      'posts', coalesce((select jsonb_agg(jsonb_build_object('body', p.body, 'status', p.status, 'created_at', p.created_at) order by p.created_at)
                          from public.posts p where p.author_id = uid), '[]'::jsonb),
      'comments', coalesce((select jsonb_agg(jsonb_build_object('body', c.body, 'status', c.status, 'created_at', c.created_at) order by c.created_at)
                             from public.post_comments c where c.author_id = uid), '[]'::jsonb),
      'following', coalesce((select jsonb_agg(sp.handle) from public.follows f join public.social_profiles sp on sp.user_id = f.followee_id
                              where f.follower_id = uid and f.status = 'accepted'), '[]'::jsonb),
      'blocked', coalesce((select count(*) from public.user_blocks where blocker_id = uid), 0),
      'reports_sent', coalesce((select count(*) from public.content_reports where reporter_id = uid), 0)),
    'notes', jsonb_build_array(
      'Senha: guardada apenas como hash pelo Supabase Auth; nunca é exportada.',
      'Registros de auditoria e dados fiscais/financeiros podem ser mantidos pelo prazo legal.'));
end $$;

-- Exclusão: além do perfil, remove o perfil social (publicações, comentários, curtidas e
-- seguidas saem em cascata). Denúncias e decisões de moderação ficam como registro.
create or replace function private.anonymize_user(_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set full_name = null, phone = null, preferred_city_id = null where id = _user;
  update public.reviews set author_name = null where user_id = _user;
  delete from public.social_profiles where user_id = _user;
  delete from public.notifications where user_id = _user;
end $$;
revoke all on function private.anonymize_user(uuid) from public, anon, authenticated;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0008', '0008_conecta_feed.sql', 'applied');
    raise notice 'Tucaí 0008: aplicada agora';
  end if;
end $tucai_0008$;

-- ===================== supabase/migrations/0009_couriers.sql =====================
do $tucai_0009$
begin
  if exists (select 1 from private.tucai_migrations where version = '0009') then
    raise notice 'Tucaí 0009: já aplicada';
  elsif to_regclass('public.couriers') is not null then
    insert into private.tucai_migrations(version, name, how) values ('0009', '0009_couriers.sql', 'detected');
    raise notice 'Tucaí 0009: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0009_couriers: cadastro de entregadores parceiros (independentes) e análise pela equipe.
--  * Minimização (LGPD): só o necessário para analisar e contatar; documentos ficam para o
--    envio por Storage com política própria (ainda não disponível).
--  * Aprovação concede o papel courier_partner; suspensão o remove.
--  * Limites de uso passam a ser uma tabela (cada módulo inclui os seus sem reescrever a função).

-- ---------- limites de uso: regras em tabela ----------
create table private.rate_limit_rules (
  action text primary key,
  max_hits integer not null check (max_hits > 0),
  window_seconds integer not null check (window_seconds > 0)
);
revoke all on private.rate_limit_rules from public, anon, authenticated;
insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('business.submit', 5, 3600), ('admin.review', 120, 600), ('admin.city', 60, 600), ('admin.staff', 60, 600),
  ('admin.role', 30, 600), ('admin.setting', 30, 600), ('admin.privacy', 60, 600), ('privacy.request', 5, 86400),
  ('privacy.export', 10, 3600), ('conecta.post', 10, 600), ('conecta.comment', 30, 600), ('conecta.like', 200, 600),
  ('conecta.follow', 60, 600), ('conecta.report', 20, 86400), ('conecta.appeal', 5, 86400), ('admin.moderation', 300, 600),
  ('courier.submit', 5, 86400), ('courier.online', 60, 600), ('admin.courier', 120, 600);

create or replace function private.limit_for(_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare r private.rate_limit_rules%rowtype;
begin
  select * into r from private.rate_limit_rules where action = _action;
  if not found then raise exception 'rate limit não configurado: %', _action; end if;
  perform private.rate_limit(_action, r.max_hits, r.window_seconds);
end $$;
revoke all on function private.limit_for(text) from public, anon, authenticated;

-- ---------- entregadores ----------
create type public.courier_vehicle as enum ('moto', 'bicicleta', 'carro', 'a_pe');
create type public.courier_status as enum ('pending', 'approved', 'rejected', 'suspended');

create table public.couriers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 3 and 120),
  phone text not null check (phone ~ '^[0-9+() -]{8,20}$'),
  city_id uuid not null references public.cities(id),
  vehicle public.courier_vehicle not null,
  -- placa e CNH só para veículos motorizados
  vehicle_plate text check (vehicle_plate is null or vehicle_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  cnh_category text check (cnh_category is null or cnh_category in ('A', 'B', 'AB', 'AC', 'AD', 'AE')),
  status public.courier_status not null default 'pending',
  is_online boolean not null default false,
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((vehicle in ('moto', 'carro')) = (vehicle_plate is not null and cnh_category is not null)),
  check (not is_online or status = 'approved')
);
create index couriers_city_status_idx on public.couriers(city_id, status, is_online);
create index couriers_reviewed_by_idx on public.couriers(reviewed_by);
create trigger couriers_updated before update on public.couriers
  for each row execute function public.set_updated_at();

alter table public.couriers enable row level security;
create policy couriers_select_own on public.couriers for select to authenticated
  using (user_id = (select auth.uid()));
-- escrita só por funções
revoke all on public.couriers from public, anon, authenticated;
grant select on public.couriers to authenticated;

-- Versão vigente dos termos de parceria (texto em /termos, sujeito a revisão jurídica).
create or replace function private.courier_terms_version() returns text
language sql immutable set search_path = '' as $$ select '2026-11-11' $$;
revoke all on function private.courier_terms_version() from public, anon, authenticated;

create or replace function public.submit_courier_application(
  _full_name text, _phone text, _city_id uuid, _vehicle public.courier_vehicle,
  _vehicle_plate text default null, _cnh_category text default null, _accept_terms boolean default false
) returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  plate text := nullif(upper(regexp_replace(coalesce(_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g')), '');
  cnh text := nullif(upper(btrim(coalesce(_cnh_category, ''))), '');
  current_status public.courier_status;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.submit');
  if not coalesce(_accept_terms, false) then
    raise exception 'É preciso aceitar os termos de parceria.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cities where id = _city_id and is_active and not is_demo) then
    raise exception 'Cidade indisponível.' using errcode = 'P0001';
  end if;
  if _vehicle in ('bicicleta', 'a_pe') then plate := null; cnh := null; end if;
  if _vehicle in ('moto', 'carro') and (plate is null or cnh is null) then
    raise exception 'Informe a placa e a categoria da CNH.' using errcode = 'P0001';
  end if;
  select status into current_status from public.couriers where user_id = uid for update;
  if current_status in ('approved', 'suspended') then
    raise exception 'Seu cadastro já foi analisado. Fale com o suporte para alterar dados.' using errcode = 'P0001';
  end if;
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category,
                              status, terms_version, terms_accepted_at, submitted_at, review_note, reviewed_by, reviewed_at)
  values (uid, btrim(_full_name), btrim(_phone), _city_id, _vehicle, plate, cnh, 'pending',
          private.courier_terms_version(), now(), now(), null, null, null)
  on conflict (user_id) do update set
    full_name = excluded.full_name, phone = excluded.phone, city_id = excluded.city_id, vehicle = excluded.vehicle,
    vehicle_plate = excluded.vehicle_plate, cnh_category = excluded.cnh_category, status = 'pending',
    terms_version = excluded.terms_version, terms_accepted_at = excluded.terms_accepted_at,
    submitted_at = now(), review_note = null, reviewed_by = null, reviewed_at = null;
  perform private.audit('courier.submit', 'couriers', uid::text, jsonb_build_object('vehicle', _vehicle));
  return 'pending';
end $$;

create or replace function public.set_courier_online(_online boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.online');
  update public.couriers set is_online = coalesce(_online, false) where user_id = uid and status = 'approved';
  if not found then raise exception 'Seu cadastro de entregador ainda não está aprovado.' using errcode = 'P0001'; end if;
  return coalesce(_online, false);
end $$;

-- ---------- análise pela equipe (couriers.review + MFA) ----------
create or replace function public.admin_list_couriers(_status public.courier_status default 'pending')
returns table (user_id uuid, email text, full_name text, phone text, city_name text, vehicle public.courier_vehicle,
               vehicle_plate text, cnh_category text, status public.courier_status, is_online boolean,
               review_note text, submitted_at timestamptz, reviewed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('couriers.review');
  return query
    select c.user_id, u.email::text, c.full_name, c.phone, ci.name, c.vehicle, c.vehicle_plate, c.cnh_category,
           c.status, c.is_online, c.review_note, c.submitted_at, c.reviewed_at
      from public.couriers c
      left join auth.users u on u.id = c.user_id
      left join public.cities ci on ci.id = c.city_id
     where _status is null or c.status = _status
     order by c.submitted_at
     limit 200;
end $$;

-- approve: pending|rejected -> approved · reject: pending -> rejected (motivo)
-- suspend: approved -> suspended (motivo) · reactivate: suspended -> approved
create or replace function public.admin_review_courier(_user uuid, _decision text, _note text default null)
returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype; next_status public.courier_status; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('couriers.review');
  perform private.limit_for('admin.courier');
  if _user = auth.uid() then raise exception 'Você não pode analisar o próprio cadastro.' using errcode = '42501'; end if;
  select * into c from public.couriers where user_id = _user for update;
  if not found then raise exception 'Cadastro não encontrado.' using errcode = 'P0001'; end if;
  next_status := case
    when _decision = 'approve' and c.status::text in ('pending', 'rejected') then 'approved'
    when _decision = 'reject' and c.status = 'pending' then 'rejected'
    when _decision = 'suspend' and c.status = 'approved' then 'suspended'
    when _decision = 'reactivate' and c.status = 'suspended' then 'approved'
  end;
  if next_status is null then
    raise exception 'Transição inválida: % a partir de %.', _decision, c.status using errcode = 'P0001';
  end if;
  if _decision in ('reject', 'suspend') and note is null then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  update public.couriers
     set status = next_status, review_note = note, reviewed_by = auth.uid(), reviewed_at = now(),
         is_online = case when next_status = 'approved' then is_online else false end
   where user_id = _user;
  if next_status = 'approved' then
    insert into public.user_roles(user_id, role, granted_by) values (_user, 'courier_partner', auth.uid()) on conflict do nothing;
  else
    delete from public.user_roles where user_id = _user and role = 'courier_partner';
  end if;
  perform private.audit('courier.' || _decision, 'couriers', _user::text, jsonb_build_object('from', c.status, 'to', next_status, 'note', note));
  return next_status;
end $$;

-- ---------- privilégios ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.submit_courier_application(text, text, uuid, public.courier_vehicle, text, text, boolean)',
    'public.set_courier_online(boolean)',
    'public.admin_list_couriers(public.courier_status)',
    'public.admin_review_courier(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0009', '0009_couriers.sql', 'applied');
    raise notice 'Tucaí 0009: aplicada agora';
  end if;
end $tucai_0009$;

-- ===================== supabase/migrations/0010_conectuai_comunidades.sql =====================
do $tucai_0010$
begin
  if exists (select 1 from private.tucai_migrations where version = '0010') then
    raise notice 'Tucaí 0010: já aplicada';
  elsif to_regclass('public.communities') is not null then
    insert into private.tucai_migrations(version, name, how) values ('0010', '0010_conectuai_comunidades.sql', 'detected');
    raise notice 'Tucaí 0010: já existia no banco (registrada)';
  else
    execute $tucai_sql$
-- 0010_conectuai_comunidades: Conectuaí completo — privacidade do perfil, amizades, recados
-- (mural), depoimentos com aprovação, comunidades públicas/privadas com moderadores, tópicos,
-- respostas e enquetes. Reaproveita perfis sociais, bloqueios, denúncias, moderação e
-- notificações da 0008. Depoimentos são pessoais: nunca viram avaliação de estabelecimento.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('conectuai.friend', 40, 3600), ('conectuai.scrap', 30, 600), ('conectuai.testimonial', 10, 86400),
  ('conectuai.community', 3, 86400), ('conectuai.join', 60, 3600), ('conectuai.topic', 10, 3600),
  ('conectuai.reply', 40, 600), ('conectuai.poll', 5, 86400), ('conectuai.vote', 120, 600),
  ('conectuai.community_mod', 300, 600);

-- ---------- privacidade do perfil ----------
alter table public.social_profiles
  add column wall_enabled boolean not null default true,
  add column wall_audience text not null default 'everyone' check (wall_audience in ('everyone', 'friends')),
  add column show_connections boolean not null default true,
  add column testimonials_enabled boolean not null default true;
grant select (wall_enabled, wall_audience, show_connections, testimonials_enabled) on public.social_profiles to anon, authenticated;
grant update (wall_enabled, wall_audience, show_connections, testimonials_enabled) on public.social_profiles to authenticated;

-- notificações e denúncias ganham os novos tipos
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply'));
alter table public.notifications add column link text check (link is null or link ~ '^/conectuai/[A-Za-z0-9/_-]*$');

alter table public.content_reports drop constraint content_reports_target_type_check;
alter table public.content_reports add constraint content_reports_target_type_check check (target_type in (
  'post', 'comment', 'profile', 'community', 'topic', 'reply', 'scrap', 'testimonial'));
alter table public.moderation_appeals drop constraint moderation_appeals_target_type_check;
alter table public.moderation_appeals add constraint moderation_appeals_target_type_check check (target_type in (
  'post', 'comment', 'suspension', 'topic', 'reply', 'scrap', 'community'));

-- Marca interna da transação para operações do próprio sistema (criação da comunidade,
-- moderação). Não é alcançável pela API: set_config não é exposto pelo PostgREST.
create or replace function private.internal_on() returns boolean
language sql stable set search_path = '' as $$ select current_setting('tucai.internal', true) = 'on' $$;

create or replace function private.notify_link(_user uuid, _kind text, _actor uuid, _link text, _message text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if _user is null or _user = _actor then return; end if;
  if _actor is not null and public.is_blocked_between(_user, _actor) then return; end if;
  insert into public.notifications(user_id, kind, actor_id, link, message) values (_user, _kind, _actor, _link, _message);
end $$;

-- ---------- amizades ----------
create table public.friendships (
  requester_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  addressee_id uuid not null references public.social_profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create index friendships_addressee_idx on public.friendships(addressee_id, status);
-- um único vínculo por par, em qualquer direção
create unique index friendships_pair_idx on public.friendships(least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create or replace function public.are_friends(_a uuid, _b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships
                  where status = 'accepted'
                    and ((requester_id = _a and addressee_id = _b) or (requester_id = _b and addressee_id = _a)))
$$;

create or replace function private.friendships_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.requester_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.friend');
  if public.is_blocked_between(new.requester_id, new.addressee_id) then
    raise exception 'Não é possível enviar convite para este perfil.' using errcode = 'P0001';
  end if;
  new.status := 'pending';
  new.responded_at := null;
  return new;
end $$;
create or replace function private.friendships_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'pending' or new.status <> 'accepted' then raise exception 'Alteração inválida.' using errcode = 'P0001'; end if;
  new.responded_at := now();
  return new;
end $$;
create or replace function private.friendships_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  if tg_op = 'INSERT' then
    select handle into h from public.social_profiles where user_id = new.requester_id;
    perform private.notify_link(new.addressee_id, 'friend_request', new.requester_id, '/conectuai/amigos');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' then
    select handle into h from public.social_profiles where user_id = new.addressee_id;
    perform private.notify_link(new.requester_id, 'friend_accept', new.addressee_id, '/conectuai/u/' || h);
  end if;
  return null;
end $$;
create trigger friendships_before_insert before insert on public.friendships for each row execute function private.friendships_before_insert();
create trigger friendships_before_update before update on public.friendships for each row execute function private.friendships_before_update();
create trigger friendships_after_change after insert or update on public.friendships for each row execute function private.friendships_after_change();

-- bloquear desfaz amizade
create or replace function private.blocks_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.follows where (follower_id = new.blocker_id and followee_id = new.blocked_id)
                               or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  delete from public.friendships where (requester_id = new.blocker_id and addressee_id = new.blocked_id)
                                   or (requester_id = new.blocked_id and addressee_id = new.blocker_id);
  return null;
end $$;

-- ---------- recados (mural) ----------
create table public.scraps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.social_profiles(user_id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  parent_id uuid references public.scraps(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now()
);
create index scraps_owner_idx on public.scraps(owner_id, created_at desc);
create index scraps_author_idx on public.scraps(author_id);
create index scraps_parent_idx on public.scraps(parent_id);

create or replace function public.can_see_wall(_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select _owner = auth.uid() or exists (
    select 1 from public.social_profiles p where p.user_id = _owner and p.wall_enabled
       and not public.is_blocked_between(_owner, auth.uid())
       and (p.wall_audience = 'everyone' or public.are_friends(_owner, auth.uid())))
$$;

create or replace function private.scraps_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent public.scraps%rowtype;
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.scrap');
  new.body := btrim(new.body);
  new.status := 'published';
  if not exists (select 1 from public.social_profiles where user_id = new.owner_id and wall_enabled) then
    raise exception 'Este mural está desativado.' using errcode = 'P0001';
  end if;
  if new.owner_id <> new.author_id and not public.can_see_wall(new.owner_id) then
    raise exception 'Você não pode deixar recados neste mural.' using errcode = 'P0001';
  end if;
  if new.parent_id is not null then
    select * into parent from public.scraps where id = new.parent_id;
    if not found or parent.owner_id <> new.owner_id or parent.parent_id is not null then
      raise exception 'Resposta inválida.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create or replace function private.scraps_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select handle into h from public.social_profiles where user_id = new.owner_id;
  perform private.notify_link(new.owner_id, 'scrap', new.author_id, '/conectuai/u/' || h);
  if private.needs_review(new.body) then
    insert into public.content_reports(reporter_id, target_type, target_id, reason) values (null, 'scrap', new.id, 'auto_flag');
  end if;
  return null;
end $$;
create trigger scraps_before_insert before insert on public.scraps for each row execute function private.scraps_before_insert();
create trigger scraps_after_insert after insert on public.scraps for each row execute function private.scraps_after_insert();

-- ---------- depoimentos (aprovados antes de aparecer) ----------
create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.social_profiles(user_id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'hidden')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (recipient_id, author_id),
  check (recipient_id <> author_id)
);
create index testimonials_author_idx on public.testimonials(author_id);
create index testimonials_recipient_idx on public.testimonials(recipient_id, status);

create or replace function private.testimonials_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.testimonial');
  new.body := btrim(new.body);
  new.status := 'pending';
  new.decided_at := null;
  if not exists (select 1 from public.social_profiles where user_id = new.recipient_id and testimonials_enabled) then
    raise exception 'Esta pessoa não recebe depoimentos.' using errcode = 'P0001';
  end if;
  if not public.are_friends(new.author_id, new.recipient_id) then
    raise exception 'Depoimentos são só entre amigos.' using errcode = 'P0001';
  end if;
  return new;
end $$;
-- só quem recebe decide (pendente -> aprovado/recusado); o autor só pode apagar
create or replace function private.testimonials_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.internal_on() then
    if old.recipient_id is distinct from auth.uid() or new.body is distinct from old.body
       or new.status not in ('approved', 'rejected') or old.status = 'hidden' then
      raise exception 'Alteração inválida.' using errcode = 'P0001';
    end if;
  end if;
  new.decided_at := now();
  return new;
end $$;
create or replace function private.testimonials_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_link(new.recipient_id, 'testimonial', new.author_id, '/conectuai/amigos',
                              'escreveu um depoimento para você. Aprove ou recuse.');
  return null;
end $$;
create trigger testimonials_before_insert before insert on public.testimonials for each row execute function private.testimonials_before_insert();
create trigger testimonials_before_update before update on public.testimonials for each row execute function private.testimonials_before_update();
create trigger testimonials_after_insert after insert on public.testimonials for each row execute function private.testimonials_after_insert();

-- ---------- comunidades ----------
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 3 and 80),
  description text check (description is null or char_length(description) <= 1000),
  rules text check (rules is null or char_length(rules) <= 3000),
  category text not null check (category in ('gastronomia', 'comercio', 'promocoes', 'empregos', 'servicos', 'esportes',
                                             'veiculos', 'cultura', 'educacao', 'bairro', 'cidade', 'outros')),
  city_id uuid references public.cities(id) on delete set null,
  is_private boolean not null default false,
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://[^\s<>"'']+$'),
  cover_url text check (cover_url is null or cover_url ~ '^https://[^\s<>"'']+$'),
  -- comerciante pode criar a comunidade do próprio estabelecimento
  business_id uuid references public.businesses(id) on delete set null,
  owner_id uuid not null default auth.uid() references public.social_profiles(user_id),
  status text not null default 'active' check (status in ('active', 'hidden')),
  member_count integer not null default 0 check (member_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communities_city_idx on public.communities(city_id, member_count desc);
create index communities_category_idx on public.communities(category);
create index communities_owner_idx on public.communities(owner_id);
create index communities_business_idx on public.communities(business_id);
create trigger communities_updated before update on public.communities for each row execute function public.set_updated_at();

create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  status text not null default 'active' check (status in ('active', 'pending', 'banned')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_idx on public.community_members(user_id, status);

create or replace function public.community_role(_community uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.community_members where community_id = _community and user_id = auth.uid() and status = 'active'
$$;
create or replace function public.is_community_mod(_community uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.community_role(_community) in ('owner', 'moderator'), false)
$$;
create or replace function public.can_read_community(_community uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.communities c where c.id = _community and c.status = 'active'
                   and (not c.is_private or public.community_role(c.id) is not null))
$$;

create or replace function private.communities_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.owner_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.community');
  new.name := btrim(new.name);
  new.slug := private.slugify(new.name);
  if exists (select 1 from public.communities where slug = new.slug) then
    new.slug := left(new.slug, 50) || '-' || substr(md5(random()::text), 1, 6);
  end if;
  new.status := 'active';
  new.member_count := 0;
  if new.business_id is not null and not public.has_business_permission(new.business_id, 'store.customize')
     and not public.has_business_permission(new.business_id, 'settings.manage') then
    raise exception 'Você não pode criar comunidade em nome deste estabelecimento.' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace function private.communities_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('tucai.internal', 'on', true);
  insert into public.community_members(community_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active');
  perform set_config('tucai.internal', 'off', true);
  perform private.audit('community.create', 'communities', new.id::text, jsonb_build_object('private', new.is_private));
  return null;
end $$;
create trigger communities_before_insert before insert on public.communities for each row execute function private.communities_before_insert();
create trigger communities_after_insert after insert on public.communities for each row execute function private.communities_after_insert();

-- entrar: aberta -> ativo; fechada -> pendente (moderadores aprovam)
create or replace function private.members_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare priv boolean;
begin
  -- a dona entra pela criação da comunidade (operação interna)
  if private.internal_on() and new.role = 'owner'
     and exists (select 1 from public.communities where id = new.community_id and owner_id = new.user_id) then
    return new;
  end if;
  perform private.conecta_author_guard();
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.join');
  select is_private into priv from public.communities where id = new.community_id and status = 'active';
  if priv is null then raise exception 'Comunidade indisponível.' using errcode = 'P0001'; end if;
  new.role := 'member';
  new.status := case when priv then 'pending' else 'active' end;
  return new;
end $$;
create or replace function private.members_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid uuid := coalesce(new.community_id, old.community_id); s text; mod uuid;
begin
  update public.communities set member_count = (select count(*) from public.community_members
                                                  where community_id = cid and status = 'active') where id = cid;
  if tg_op = 'INSERT' and new.status = 'pending' then
    select slug into s from public.communities where id = cid;
    for mod in select user_id from public.community_members where community_id = cid and role in ('owner', 'moderator') and status = 'active' loop
      perform private.notify_link(mod, 'community_request', new.user_id, '/conectuai/c/' || s);
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    select slug into s from public.communities where id = cid;
    perform private.notify_link(new.user_id, 'community_accept', null, '/conectuai/c/' || s, 'Sua entrada na comunidade foi aprovada.');
  end if;
  return null;
end $$;
create trigger members_before_insert before insert on public.community_members for each row execute function private.members_before_insert();
create trigger members_after_change after insert or update or delete on public.community_members for each row execute function private.members_after_change();

-- ação de moderação da comunidade: aprovar/recusar entrada, promover, rebaixar, banir, desbanir
create or replace function public.community_manage_member(_community uuid, _user uuid, _action text)
returns void language plpgsql security definer set search_path = '' as $$
declare me_role text := public.community_role(_community); target public.community_members%rowtype;
begin
  if me_role is null or me_role not in ('owner', 'moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.community_mod');
  select * into target from public.community_members where community_id = _community and user_id = _user for update;
  if not found then raise exception 'Membro não encontrado.' using errcode = 'P0001'; end if;
  if target.role = 'owner' or (target.role = 'moderator' and me_role <> 'owner') then
    raise exception 'Você não pode alterar este membro.' using errcode = '42501';
  end if;
  if _action = 'approve' and target.status = 'pending' then
    update public.community_members set status = 'active', joined_at = now() where community_id = _community and user_id = _user;
  elsif _action = 'reject' and target.status = 'pending' then
    delete from public.community_members where community_id = _community and user_id = _user;
  elsif _action = 'ban' and target.status <> 'banned' then
    update public.community_members set status = 'banned', role = 'member' where community_id = _community and user_id = _user;
  elsif _action = 'unban' and target.status = 'banned' then
    delete from public.community_members where community_id = _community and user_id = _user;
  elsif _action = 'promote' and me_role = 'owner' and target.status = 'active' and target.role = 'member' then
    update public.community_members set role = 'moderator' where community_id = _community and user_id = _user;
  elsif _action = 'demote' and me_role = 'owner' and target.role = 'moderator' then
    update public.community_members set role = 'member' where community_id = _community and user_id = _user;
  else
    raise exception 'Ação inválida para este membro.' using errcode = 'P0001';
  end if;
  perform private.audit('community.member_' || _action, 'communities', _community::text, jsonb_build_object('user', _user));
end $$;

-- ---------- tópicos, respostas e enquetes ----------
create table public.community_topics (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 140),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  is_pinned boolean not null default false,
  is_locked boolean not null default false,
  status text not null default 'published' check (status in ('published', 'hidden')),
  reply_count integer not null default 0 check (reply_count >= 0),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index community_topics_list_idx on public.community_topics(community_id, is_pinned desc, last_activity_at desc);
create index community_topics_author_idx on public.community_topics(author_id);

create table public.topic_replies (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.community_topics(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index topic_replies_topic_idx on public.topic_replies(topic_id, created_at);
create index topic_replies_author_idx on public.topic_replies(author_id);

create table public.community_polls (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.social_profiles(user_id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 3 and 200),
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (closes_at > created_at)
);
create index community_polls_community_idx on public.community_polls(community_id, created_at desc);
create index community_polls_author_idx on public.community_polls(author_id);
create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.community_polls(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  position smallint not null,
  vote_count integer not null default 0 check (vote_count >= 0),
  unique (poll_id, position),
  unique (id, poll_id)
);
create table public.poll_votes (
  poll_id uuid not null references public.community_polls(id) on delete cascade,
  option_id uuid not null,
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id),
  foreign key (option_id, poll_id) references public.poll_options(id, poll_id) on delete cascade
);
create index poll_votes_option_idx on public.poll_votes(option_id, poll_id);
create index poll_votes_user_idx on public.poll_votes(user_id);

create or replace function private.topics_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.topic');
  if public.community_role(new.community_id) is null then
    raise exception 'Entre na comunidade para criar tópicos.' using errcode = 'P0001';
  end if;
  new.title := btrim(new.title); new.body := btrim(new.body);
  new.is_pinned := false; new.is_locked := false; new.status := 'published'; new.reply_count := 0; new.last_activity_at := now();
  return new;
end $$;
create or replace function private.topics_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.internal_on() then
    if (new.title is distinct from old.title or new.body is distinct from old.body) then
      if old.author_id <> auth.uid() or old.status = 'hidden' then raise exception 'Alteração inválida.' using errcode = 'P0001'; end if;
      new.edited_at := now();
    end if;
    if (new.is_pinned is distinct from old.is_pinned or new.is_locked is distinct from old.is_locked)
       and not public.is_community_mod(old.community_id) then
      raise exception 'Só moderadores fixam ou trancam tópicos.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create or replace function private.topics_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.needs_review(new.title || ' ' || new.body) then
    insert into public.content_reports(reporter_id, target_type, target_id, reason) values (null, 'topic', new.id, 'auto_flag');
  end if;
  return null;
end $$;
create trigger topics_before_insert before insert on public.community_topics for each row execute function private.topics_before_insert();
create trigger topics_before_update before update on public.community_topics for each row execute function private.topics_before_update();
create trigger topics_after_insert after insert on public.community_topics for each row execute function private.topics_after_insert();

create or replace function private.replies_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.community_topics%rowtype;
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.reply');
  select * into t from public.community_topics where id = new.topic_id;
  if not found or t.status <> 'published' then raise exception 'Tópico indisponível.' using errcode = 'P0001'; end if;
  if t.is_locked then raise exception 'Tópico trancado pelos moderadores.' using errcode = 'P0001'; end if;
  if public.community_role(t.community_id) is null then raise exception 'Entre na comunidade para responder.' using errcode = 'P0001'; end if;
  new.body := btrim(new.body); new.status := 'published';
  return new;
end $$;
create or replace function private.replies_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.community_topics%rowtype; s text;
begin
  if tg_op = 'INSERT' then
    update public.community_topics set reply_count = reply_count + 1, last_activity_at = now() where id = new.topic_id returning * into t;
    select slug into s from public.communities where id = t.community_id;
    perform private.notify_link(t.author_id, 'topic_reply', new.author_id, '/conectuai/c/' || s || '/t/' || t.id);
    if private.needs_review(new.body) then
      insert into public.content_reports(reporter_id, target_type, target_id, reason) values (null, 'reply', new.id, 'auto_flag');
    end if;
  else
    update public.community_topics set reply_count = greatest(reply_count - 1, 0) where id = old.topic_id;
  end if;
  return null;
end $$;
create or replace function private.replies_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.body is distinct from old.body then
    if old.status = 'hidden' then raise exception 'Resposta ocultada pela moderação não pode ser editada.' using errcode = 'P0001'; end if;
    new.body := btrim(new.body); new.edited_at := now();
  end if;
  return new;
end $$;
create trigger replies_before_insert before insert on public.topic_replies for each row execute function private.replies_before_insert();
create trigger replies_after_change after insert or delete on public.topic_replies for each row execute function private.replies_after_change();
create trigger replies_before_update before update on public.topic_replies for each row execute function private.replies_before_update();

create or replace function public.create_poll(_community uuid, _question text, _options text[], _days integer default 7)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pid uuid; i int := 0; opt text; clean text[];
begin
  perform private.conecta_author_guard();
  perform private.limit_for('conectuai.poll');
  if public.community_role(_community) is null then raise exception 'Entre na comunidade para criar enquetes.' using errcode = 'P0001'; end if;
  select array_agg(btrim(o)) into clean from unnest(_options) o where btrim(o) <> '';
  if coalesce(array_length(clean, 1), 0) not between 2 and 6 then
    raise exception 'A enquete precisa de 2 a 6 opções.' using errcode = 'P0001';
  end if;
  if coalesce(_days, 7) not between 1 and 30 then raise exception 'Duração de 1 a 30 dias.' using errcode = 'P0001'; end if;
  insert into public.community_polls(community_id, author_id, question, closes_at)
  values (_community, auth.uid(), btrim(_question), now() + make_interval(days => coalesce(_days, 7))) returning id into pid;
  foreach opt in array clean loop
    i := i + 1;
    insert into public.poll_options(poll_id, label, position) values (pid, opt, i);
  end loop;
  return pid;
end $$;

create or replace function private.votes_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.community_polls%rowtype;
begin
  perform private.conecta_author_guard();
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.vote');
  select * into p from public.community_polls where id = new.poll_id;
  if not found then raise exception 'Enquete indisponível.' using errcode = 'P0001'; end if;
  if p.closes_at <= now() then raise exception 'Enquete encerrada.' using errcode = 'P0001'; end if;
  if public.community_role(p.community_id) is null then raise exception 'Só membros votam.' using errcode = 'P0001'; end if;
  return new;
end $$;
create or replace function private.votes_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.poll_options set vote_count = vote_count + 1 where id = new.option_id;
  else update public.poll_options set vote_count = greatest(vote_count - 1, 0) where id = old.option_id; end if;
  return null;
end $$;
create trigger votes_before_insert before insert on public.poll_votes for each row execute function private.votes_before_insert();
create trigger votes_after_change after insert or delete on public.poll_votes for each row execute function private.votes_after_change();

-- ---------- moderação: novos alvos ----------
create or replace function private.set_content_status(_type text, _id uuid, _status text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare author uuid;
begin
  perform set_config('tucai.internal', 'on', true);
  case _type
    when 'post' then update public.posts set status = _status where id = _id returning author_id into author;
    when 'comment' then update public.post_comments set status = _status where id = _id returning author_id into author;
    when 'topic' then update public.community_topics set status = _status where id = _id returning author_id into author;
    when 'reply' then update public.topic_replies set status = _status where id = _id returning author_id into author;
    when 'scrap' then update public.scraps set status = _status where id = _id returning author_id into author;
    when 'testimonial' then
      update public.testimonials set status = case when _status = 'hidden' then 'hidden' else 'approved' end
       where id = _id returning author_id into author;
    when 'community' then
      update public.communities set status = case when _status = 'hidden' then 'hidden' else 'active' end
       where id = _id returning owner_id into author;
    else null;
  end case;
  perform set_config('tucai.internal', 'off', true);
  return author;
end $$;
revoke all on function private.set_content_status(text, uuid, text) from public, anon, authenticated;

create or replace function public.report_content(_target_type text, _target_id uuid, _reason text, _details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.report');
  if _reason = 'auto_flag' or _reason is null then raise exception 'Motivo inválido.' using errcode = 'P0001'; end if;
  if char_length(coalesce(_details, '')) > 1000 then raise exception 'Texto muito longo.' using errcode = 'P0001'; end if;
  if not ((_target_type = 'post' and exists (select 1 from public.posts where id = _target_id))
       or (_target_type = 'comment' and exists (select 1 from public.post_comments where id = _target_id))
       or (_target_type = 'profile' and exists (select 1 from public.social_profiles where user_id = _target_id))
       or (_target_type = 'community' and exists (select 1 from public.communities where id = _target_id))
       or (_target_type = 'topic' and exists (select 1 from public.community_topics where id = _target_id))
       or (_target_type = 'reply' and exists (select 1 from public.topic_replies where id = _target_id))
       or (_target_type = 'scrap' and exists (select 1 from public.scraps where id = _target_id))
       or (_target_type = 'testimonial' and exists (select 1 from public.testimonials where id = _target_id))) then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0001';
  end if;
  insert into public.content_reports(reporter_id, target_type, target_id, reason, details)
  values (auth.uid(), _target_type, _target_id, _reason, nullif(btrim(coalesce(_details, '')), ''))
  on conflict do nothing returning id into new_id;
  if new_id is null then raise exception 'Você já denunciou este conteúdo; a denúncia está em análise.' using errcode = 'P0001'; end if;
  return new_id;
end $$;

create or replace function public.appeal_moderation(_target_type text, _target_id uuid, _reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.appeal');
  if not ((_target_type = 'post' and exists (select 1 from public.posts where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'comment' and exists (select 1 from public.post_comments where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'topic' and exists (select 1 from public.community_topics where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'reply' and exists (select 1 from public.topic_replies where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'scrap' and exists (select 1 from public.scraps where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'community' and exists (select 1 from public.communities where id = _target_id and owner_id = uid and status = 'hidden'))
       or (_target_type = 'suspension' and _target_id = uid and exists (select 1 from public.social_profiles
                                                                      where user_id = uid and conecta_suspended_until > now()))) then
    raise exception 'Não há decisão de moderação para contestar.' using errcode = 'P0001';
  end if;
  insert into public.moderation_appeals(author_id, target_type, target_id, reason)
  values (uid, _target_type, _target_id, btrim(coalesce(_reason, '')))
  on conflict do nothing returning id into new_id;
  if new_id is null then raise exception 'Já existe uma contestação em análise.' using errcode = 'P0001'; end if;
  return new_id;
end $$;

create or replace function public.admin_moderate(_report uuid, _action text, _note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.content_reports%rowtype; author uuid; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('moderation.manage');
  perform private.limit_for('admin.moderation');
  select * into r from public.content_reports where id = _report for update;
  if not found or r.status <> 'open' then raise exception 'Denúncia não encontrada ou já resolvida.' using errcode = 'P0001'; end if;
  if note is null then raise exception 'Registre o motivo da decisão.' using errcode = 'P0001'; end if;
  if _action not in ('dismiss', 'hide') then raise exception 'Ação inválida.' using errcode = 'P0001'; end if;
  if _action = 'hide' then
    if r.target_type = 'profile' then raise exception 'Para perfis, use a suspensão.' using errcode = 'P0001'; end if;
    author := private.set_content_status(r.target_type, r.target_id, 'hidden');
    if author = auth.uid() then raise exception 'Você não pode moderar o próprio conteúdo.' using errcode = '42501'; end if;
    perform private.notify(author, 'moderation', null,
      case when r.target_type = 'post' then r.target_id end, case when r.target_type = 'comment' then r.target_id end,
      'Seu conteúdo foi ocultado por violar as regras do Conectuaí: ' || note || ' Você pode contestar.');
  end if;
  update public.content_reports
     set status = case when _action = 'hide' then 'actioned' else 'dismissed' end,
         resolution_note = note, resolved_by = auth.uid(), resolved_at = now()
   where target_type = r.target_type and target_id = r.target_id and status = 'open';
  perform private.audit('moderation.' || _action, r.target_type, r.target_id::text, jsonb_build_object('report', r.id, 'reason', r.reason));
end $$;

create or replace function public.admin_list_reports(_status text default 'open')
returns table (id uuid, target_type text, target_id uuid, reason text, details text, status text, created_at timestamptz,
               reporter_email text, content_body text, content_status text, author_id uuid, author_handle text, open_reports bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('moderation.manage');
  return query
    with c as (
      select r.*,
        case r.target_type
          when 'post' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.posts x where x.id = r.target_id)
          when 'comment' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.post_comments x where x.id = r.target_id)
          when 'profile' then (select jsonb_build_object('b', coalesce(x.bio, x.display_name), 's', 'published', 'a', x.user_id) from public.social_profiles x where x.user_id = r.target_id)
          when 'community' then (select jsonb_build_object('b', x.name || ' — ' || coalesce(x.description, ''), 's', x.status, 'a', x.owner_id) from public.communities x where x.id = r.target_id)
          when 'topic' then (select jsonb_build_object('b', x.title || ' — ' || x.body, 's', x.status, 'a', x.author_id) from public.community_topics x where x.id = r.target_id)
          when 'reply' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.topic_replies x where x.id = r.target_id)
          when 'scrap' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.scraps x where x.id = r.target_id)
          when 'testimonial' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.testimonials x where x.id = r.target_id)
        end as info
      from public.content_reports r
      where _status is null or r.status = _status
      order by r.created_at
      limit 200)
    select c.id, c.target_type, c.target_id, c.reason, c.details, c.status, c.created_at, u.email::text,
           coalesce(c.info->>'b', ''), coalesce(c.info->>'s', 'published'), (c.info->>'a')::uuid, sp.handle,
           (select count(*) from public.content_reports x where x.target_type = c.target_type and x.target_id = c.target_id and x.status = 'open')
      from c
      left join auth.users u on u.id = c.reporter_id
      left join public.social_profiles sp on sp.user_id = (c.info->>'a')::uuid
     order by c.created_at;
end $$;

-- moderadores da comunidade ocultam/restauram tópicos e respostas dela (com auditoria)
create or replace function public.community_moderate_content(_type text, _id uuid, _hide boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if _type = 'topic' then select community_id into cid from public.community_topics where id = _id;
  elsif _type = 'reply' then select t.community_id into cid from public.topic_replies r join public.community_topics t on t.id = r.topic_id where r.id = _id;
  else raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  if cid is null or not public.is_community_mod(cid) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.community_mod');
  perform private.set_content_status(_type, _id, case when _hide then 'hidden' else 'published' end);
  perform private.audit('community.' || case when _hide then 'hide_' else 'restore_' end || _type, 'communities', cid::text, jsonb_build_object('id', _id));
end $$;

-- ---------- RLS ----------
alter table public.friendships enable row level security;
alter table public.scraps enable row level security;
alter table public.testimonials enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_topics enable row level security;
alter table public.topic_replies enable row level security;
alter table public.community_polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

-- amizades: participantes; aceitas aparecem para todos se ambos mostram conexões
create policy friendships_select on public.friendships for select to anon, authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid())
         or (status = 'accepted'
             and exists (select 1 from public.social_profiles p where p.user_id = requester_id and p.show_connections)
             and exists (select 1 from public.social_profiles p where p.user_id = addressee_id and p.show_connections)));
create policy friendships_insert on public.friendships for insert to authenticated with check (requester_id = (select auth.uid()));
create policy friendships_update on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid())) with check (addressee_id = (select auth.uid()));
create policy friendships_delete on public.friendships for delete to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

create policy scraps_select on public.scraps for select to anon, authenticated
  using (author_id = (select auth.uid()) or owner_id = (select auth.uid())
         or (status = 'published' and public.can_see_wall(owner_id) and not public.is_blocked_between(author_id, (select auth.uid()))));
create policy scraps_insert on public.scraps for insert to authenticated with check (author_id = (select auth.uid()));
create policy scraps_delete on public.scraps for delete to authenticated
  using (author_id = (select auth.uid()) or owner_id = (select auth.uid()));

create policy testimonials_select on public.testimonials for select to anon, authenticated
  using (author_id = (select auth.uid()) or recipient_id = (select auth.uid())
         or (status = 'approved' and not public.is_blocked_between(recipient_id, (select auth.uid()))));
create policy testimonials_insert on public.testimonials for insert to authenticated with check (author_id = (select auth.uid()));
create policy testimonials_update on public.testimonials for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy testimonials_delete on public.testimonials for delete to authenticated
  using (author_id = (select auth.uid()) or recipient_id = (select auth.uid()));

-- comunidades: visíveis na busca (inclusive privadas, sem o conteúdo); dona edita
create policy communities_select on public.communities for select to anon, authenticated
  using (status = 'active' or owner_id = (select auth.uid()));
create policy communities_insert on public.communities for insert to authenticated with check (owner_id = (select auth.uid()));
create policy communities_update on public.communities for update to authenticated
  using (public.community_role(id) = 'owner') with check (public.community_role(id) = 'owner');
create policy communities_delete on public.communities for delete to authenticated
  using (owner_id = (select auth.uid()));

-- membros: de comunidade aberta, todos veem os ativos; de fechada, só membros; cada um vê o próprio pedido;
-- moderadores veem pendentes e banidos
create policy members_select on public.community_members for select to anon, authenticated
  using (user_id = (select auth.uid())
         or public.is_community_mod(community_id)
         or (status = 'active' and public.can_read_community(community_id)));
create policy members_insert on public.community_members for insert to authenticated with check (user_id = (select auth.uid()));
-- sair: o próprio membro (a dona não sai sem transferir); banido não apaga o banimento
create policy members_delete on public.community_members for delete to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner' and status <> 'banned');

create policy topics_select on public.community_topics for select to anon, authenticated
  using (public.can_read_community(community_id)
         and (status = 'published' or author_id = (select auth.uid()) or public.is_community_mod(community_id)));
create policy topics_insert on public.community_topics for insert to authenticated with check (author_id = (select auth.uid()));
create policy topics_update on public.community_topics for update to authenticated
  using (author_id = (select auth.uid()) or public.is_community_mod(community_id))
  with check (author_id = (select auth.uid()) or public.is_community_mod(community_id));
create policy topics_delete on public.community_topics for delete to authenticated
  using (author_id = (select auth.uid()));

create policy replies_select on public.topic_replies for select to anon, authenticated
  using (exists (select 1 from public.community_topics t where t.id = topic_id)
         and (status = 'published' or author_id = (select auth.uid())
              or exists (select 1 from public.community_topics t where t.id = topic_id and public.is_community_mod(t.community_id))));
create policy replies_insert on public.topic_replies for insert to authenticated with check (author_id = (select auth.uid()));
create policy replies_update on public.topic_replies for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy replies_delete on public.topic_replies for delete to authenticated using (author_id = (select auth.uid()));

create policy polls_select on public.community_polls for select to anon, authenticated using (public.can_read_community(community_id));
create policy poll_options_select on public.poll_options for select to anon, authenticated
  using (exists (select 1 from public.community_polls p where p.id = poll_id));
create policy poll_votes_select on public.poll_votes for select to authenticated using (user_id = (select auth.uid()));
create policy poll_votes_insert on public.poll_votes for insert to authenticated with check (user_id = (select auth.uid()));
create policy poll_votes_delete on public.poll_votes for delete to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.community_polls p where p.id = poll_id and p.closes_at > now()));

-- ---------- privilégios ----------
revoke all on public.friendships, public.scraps, public.testimonials, public.communities, public.community_members,
  public.community_topics, public.topic_replies, public.community_polls, public.poll_options, public.poll_votes
  from public, anon, authenticated;
grant select on public.friendships, public.scraps, public.testimonials, public.communities, public.community_members,
  public.community_topics, public.topic_replies, public.community_polls, public.poll_options to anon, authenticated;
grant select on public.poll_votes to authenticated;
grant insert (requester_id, addressee_id), delete on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;
grant insert (owner_id, author_id, parent_id, body), delete on public.scraps to authenticated;
grant insert (recipient_id, author_id, body), delete on public.testimonials to authenticated;
grant update (status) on public.testimonials to authenticated;
grant insert (name, description, rules, category, city_id, is_private, avatar_url, cover_url, business_id, owner_id), delete
  on public.communities to authenticated;
grant update (description, rules, category, city_id, is_private, avatar_url, cover_url) on public.communities to authenticated;
grant insert (community_id, user_id), delete on public.community_members to authenticated;
grant insert (community_id, author_id, title, body), delete on public.community_topics to authenticated;
grant update (title, body, is_pinned, is_locked) on public.community_topics to authenticated;
grant insert (topic_id, author_id, body), delete on public.topic_replies to authenticated;
grant update (body) on public.topic_replies to authenticated;
grant insert (poll_id, option_id, user_id), delete on public.poll_votes to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'private.internal_on()', 'private.notify_link(uuid, text, uuid, text, text)', 'private.friendships_before_insert()', 'private.friendships_before_update()',
    'private.friendships_after_change()', 'private.blocks_after_insert()', 'private.scraps_before_insert()', 'private.scraps_after_insert()',
    'private.testimonials_before_insert()', 'private.testimonials_before_update()', 'private.testimonials_after_insert()',
    'private.communities_before_insert()', 'private.communities_after_insert()', 'private.members_before_insert()',
    'private.members_after_change()', 'private.topics_before_insert()', 'private.topics_before_update()', 'private.topics_after_insert()',
    'private.replies_before_insert()', 'private.replies_after_change()', 'private.replies_before_update()',
    'private.votes_before_insert()', 'private.votes_after_change()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.are_friends(uuid, uuid)', 'public.can_see_wall(uuid)', 'public.community_role(uuid)',
                           'public.is_community_mod(uuid)', 'public.can_read_community(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.community_manage_member(uuid, uuid, text)', 'public.create_poll(uuid, text, text[], integer)',
    'public.community_moderate_content(text, uuid, boolean)', 'public.report_content(text, uuid, text, text)',
    'public.appeal_moderation(text, uuid, text)', 'public.admin_moderate(uuid, text, text)', 'public.admin_list_reports(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- LGPD: novos dados na exportação e na exclusão ----------
create or replace function private.anonymize_user(_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set full_name = null, phone = null, preferred_city_id = null where id = _user;
  update public.reviews set author_name = null where user_id = _user;
  -- comunidades da pessoa passam para um moderador ativo, se houver; senão são removidas
  update public.communities c set owner_id = m.user_id
    from (select distinct on (community_id) community_id, user_id from public.community_members
           where role = 'moderator' and status = 'active' and user_id <> _user order by community_id, joined_at) m
   where c.id = m.community_id and c.owner_id = _user;
  update public.community_members cm set role = 'owner'
    from public.communities c where c.id = cm.community_id and cm.user_id = c.owner_id and c.owner_id <> _user and cm.role = 'moderator';
  delete from public.communities where owner_id = _user;
  delete from public.couriers where user_id = _user;
  delete from public.social_profiles where user_id = _user;
  delete from public.notifications where user_id = _user;
end $$;
revoke all on function private.anonymize_user(uuid) from public, anon, authenticated;

create or replace function private.conectuai_export(_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(sp.handle) from public.friendships f
                          join public.social_profiles sp on sp.user_id = case when f.requester_id = _uid then f.addressee_id else f.requester_id end
                         where f.status = 'accepted' and _uid in (f.requester_id, f.addressee_id)), '[]'::jsonb),
    'scraps_written', coalesce((select jsonb_agg(jsonb_build_object('body', body, 'created_at', created_at)) from public.scraps where author_id = _uid), '[]'::jsonb),
    'testimonials_written', coalesce((select jsonb_agg(jsonb_build_object('body', body, 'status', status)) from public.testimonials where author_id = _uid), '[]'::jsonb),
    'communities', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'role', m.role, 'status', m.status))
                              from public.community_members m join public.communities c on c.id = m.community_id where m.user_id = _uid), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'body', body, 'created_at', created_at)) from public.community_topics where author_id = _uid), '[]'::jsonb),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('body', body, 'created_at', created_at)) from public.topic_replies where author_id = _uid), '[]'::jsonb),
    'courier', (select to_jsonb(c) - 'user_id' - 'reviewed_by' from public.couriers c where c.user_id = _uid))
$$;
revoke all on function private.conectuai_export(uuid) from public, anon, authenticated;

-- exportação: acrescenta comunidades, amizades, recados, depoimentos e cadastro de entregador
do $$
declare src text;
begin
  select pg_get_functiondef('public.my_data_export()'::regprocedure) into src;
  if strpos(src, '''notes'', jsonb_build_array(') = 0 then raise exception 'my_data_export: ponto de extensão não encontrado'; end if;
  src := replace(src, '''notes'', jsonb_build_array(', '''conectuai_extra'', private.conectuai_export(uid),
    ''notes'', jsonb_build_array(');
  execute src;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0010', '0010_conectuai_comunidades.sql', 'applied');
    raise notice 'Tucaí 0010: aplicada agora';
  end if;
end $tucai_0010$;

-- ===================== supabase/migrations/0011_orders.sql =====================
do $tucai_0011$
begin
  if exists (select 1 from private.tucai_migrations where version = '0011') then
    raise notice 'Tucaí 0011: já aplicada';
  else
    execute $tucai_sql$
-- 0011_orders: pedidos reais (delivery e retirada) com preço calculado no servidor.
--  * O navegador envia só ids e quantidades; preços, adicionais, frete e comissão saem do banco
--    e da configuração de preços versionada (pricing_configs), gravados como snapshot imutável.
--  * Idempotência por chave do cliente (evita pedido duplicado em clique duplo ou rede instável).
--  * Verifica loja ativa e aberta, disponibilidade, grupos de adicionais, pedido mínimo e modalidade.
--  * Pagamento na entrega ou na retirada (dinheiro, Pix ou cartão na maquininha do estabelecimento):
--    nenhum pagamento online é simulado enquanto o provedor não for contratado.
--  * Transições de status autorizadas por papel, com histórico e notificações.
--  * Avaliação verificada: só quem recebeu o pedido avalia, uma vez por pedido; o estabelecimento responde.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('order.place', 10, 600), ('order.status', 300, 600), ('order.review', 10, 86400), ('order.reply', 60, 600);

create type public.order_status as enum
  ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up', 'rejected', 'cancelled');
create type public.order_fulfillment as enum ('delivery_own', 'delivery_partner', 'pickup');
create type public.order_payment as enum ('cash', 'pix_on_delivery', 'card_on_delivery');

-- notificações de pedidos
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply',
  'order_new', 'order_update', 'delivery_offer'));
alter table public.notifications drop constraint notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or link ~ '^/(conectuai|pedidos|painel|entregador)/[A-Za-z0-9/_-]*$');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  customer_id uuid not null references auth.users(id),
  business_id uuid not null references public.businesses(id),
  status public.order_status not null default 'placed',
  fulfillment public.order_fulfillment not null,
  payment_method public.order_payment not null,
  change_for_cents integer check (change_for_cents is null or change_for_cents > 0),
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  customer_phone text not null check (customer_phone ~ '^[0-9+() -]{8,20}$'),
  delivery_address text check (delivery_address is null or char_length(delivery_address) between 5 and 300),
  delivery_reference text check (delivery_reference is null or char_length(delivery_reference) <= 200),
  notes text check (notes is null or char_length(notes) <= 500),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  commission_cents integer not null default 0 check (commission_cents >= 0),
  merchant_delivery_contribution_cents integer not null default 0 check (merchant_delivery_contribution_cents >= 0),
  courier_pay_cents integer not null default 0 check (courier_pay_cents >= 0),
  platform_delivery_fee_cents integer not null default 0 check (platform_delivery_fee_cents >= 0),
  pricing_config_id uuid not null references public.pricing_configs(id),
  pricing_snapshot jsonb not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, idempotency_key),
  check (total_cents = subtotal_cents + delivery_fee_cents - discount_cents),
  check ((fulfillment = 'pickup') = (delivery_address is null)),
  check (change_for_cents is null or payment_method = 'cash')
);
create index orders_customer_idx on public.orders(customer_id, created_at desc);
create index orders_business_idx on public.orders(business_id, status, created_at desc);
create index orders_pricing_idx on public.orders(pricing_config_id);
create trigger orders_updated before update on public.orders for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity smallint not null check (quantity between 1 and 50),
  options jsonb not null default '[]'::jsonb,
  line_total_cents integer not null check (line_total_cents >= 0),
  notes text check (notes is null or char_length(notes) <= 200)
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  actor_id uuid references auth.users(id),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events(order_id, created_at);
create index order_events_actor_idx on public.order_events(actor_id);

-- quem pode ver um pedido (cliente, equipe do estabelecimento, equipe da plataforma; entregador na 0012)
create or replace function public.can_view_order(_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = _order and (
    o.customer_id = auth.uid()
    or public.has_business_permission(o.business_id, 'orders.view')
    or public.has_platform_permission('orders.view')))
$$;

create or replace function private.notify_order_staff(_order public.orders, _kind text, _message text)
returns void language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin
  for m in select bm.user_id from public.business_members bm
             join public.role_permissions rp on rp.member_role = bm.member_role and rp.permission = 'orders.view'
            where bm.business_id = _order.business_id loop
    perform private.notify_link(m, _kind, _order.customer_id, '/painel/' || _order.business_id || '/pedidos', _message);
  end loop;
end $$;

-- ---------- criar pedido ----------
create or replace function public.place_order(
  _business uuid,
  _items jsonb,
  _fulfillment public.order_fulfillment,
  _payment public.order_payment,
  _customer_name text,
  _customer_phone text,
  _delivery_address text default null,
  _delivery_reference text default null,
  _notes text default null,
  _change_for_cents integer default null,
  _idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  existing uuid;
  b public.businesses%rowtype;
  cfg public.pricing_configs%rowtype;
  item jsonb;
  p public.products%rowtype;
  qty int;
  opt_ids uuid[];
  opt record;
  grp record;
  unit int;
  sub int := 0;
  lines jsonb := '[]'::jsonb;
  opts jsonb;
  fee int := 0; merchant_contrib int := 0; courier_pay int := 0; platform_fee int := 0; commission int := 0;
  new_id uuid;
  o public.orders%rowtype;
begin
  if uid is null then raise exception 'Entre na sua conta para fazer o pedido.' using errcode = '42501'; end if;
  if _idempotency_key is null or char_length(_idempotency_key) not between 8 and 80 then
    raise exception 'Chave de pedido inválida.' using errcode = 'P0001';
  end if;
  select id into existing from public.orders where customer_id = uid and idempotency_key = _idempotency_key;
  if existing is not null then return existing; end if;  -- mesmo pedido reenviado
  perform private.limit_for('order.place');

  select * into b from public.businesses where id = _business;
  if not found or b.status <> 'active' or b.is_demo then raise exception 'Estabelecimento indisponível.' using errcode = 'P0001'; end if;
  if not private.is_open(b.id, now()) then raise exception 'O estabelecimento está fechado agora.' using errcode = 'P0001'; end if;
  if (_fulfillment = 'delivery_own' and b.delivery_offer <> 'own')
     or (_fulfillment = 'delivery_partner' and b.delivery_offer <> 'partner')
     or (_fulfillment = 'pickup' and not b.accepts_pickup) then
    raise exception 'Modalidade de entrega indisponível neste estabelecimento.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(_customer_name, ''))) < 2 or coalesce(_customer_phone, '') !~ '^[0-9+() -]{8,20}$' then
    raise exception 'Informe nome e telefone para contato.' using errcode = 'P0001';
  end if;
  if _fulfillment <> 'pickup' and char_length(btrim(coalesce(_delivery_address, ''))) < 5 then
    raise exception 'Informe o endereço de entrega.' using errcode = 'P0001';
  end if;
  if _change_for_cents is not null and _payment <> 'cash' then
    raise exception 'Troco só para pagamento em dinheiro.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) not between 1 and 50 then
    raise exception 'O pedido precisa ter de 1 a 50 itens.' using errcode = 'P0001';
  end if;

  for item in select * from jsonb_array_elements(_items) loop
    select * into p from public.products where id = (item->>'product_id')::uuid and business_id = b.id;
    if not found or p.is_demo then raise exception 'Produto indisponível.' using errcode = 'P0001'; end if;
    if not p.is_available or not exists (select 1 from public.menu_categories c where c.id = p.category_id and c.is_active) then
      raise exception '% está indisponível no momento.', p.name using errcode = 'P0001';
    end if;
    qty := coalesce((item->>'quantity')::int, 0);
    if qty not between 1 and 50 then raise exception 'Quantidade inválida para %.', p.name using errcode = 'P0001'; end if;
    select coalesce(array_agg(distinct x::uuid), '{}') into opt_ids
      from jsonb_array_elements_text(coalesce(item->'option_ids', '[]'::jsonb)) x;
    unit := p.price_cents;
    opts := '[]'::jsonb;
    -- cada adicional pertence a um grupo do produto e está disponível
    for opt in
      select o2.id, o2.name, o2.price_delta_cents, o2.is_available, g.id as group_id, g.name as group_name
        from public.options o2 join public.option_groups g on g.id = o2.group_id
       where o2.id = any(opt_ids) and g.product_id = p.id and o2.business_id = b.id loop
      if not opt.is_available then raise exception '% está indisponível.', opt.name using errcode = 'P0001'; end if;
      unit := unit + opt.price_delta_cents;
      opts := opts || jsonb_build_object('group', opt.group_name, 'option', opt.name, 'price_delta_cents', opt.price_delta_cents);
    end loop;
    if jsonb_array_length(opts) <> coalesce(array_length(opt_ids, 1), 0) then
      raise exception 'Adicional inválido para %.', p.name using errcode = 'P0001';
    end if;
    -- mínimos e máximos de cada grupo
    for grp in
      select g.name, g.min_select, g.max_select,
             (select count(*) from public.options o3 where o3.group_id = g.id and o3.id = any(opt_ids)) as chosen
        from public.option_groups g where g.product_id = p.id loop
      if grp.chosen < grp.min_select or grp.chosen > grp.max_select then
        raise exception 'Escolha entre % e % opção(ões) em "%".', grp.min_select, grp.max_select, grp.name using errcode = 'P0001';
      end if;
    end loop;
    sub := sub + unit * qty;
    lines := lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', unit, 'qty', qty, 'options', opts,
                                         'notes', nullif(left(btrim(coalesce(item->>'notes', '')), 200), ''));
  end loop;

  if sub < b.min_order_cents then
    raise exception 'Pedido mínimo deste estabelecimento: R$ %.', to_char(b.min_order_cents / 100.0, 'FM999990D00') using errcode = 'P0001';
  end if;

  select * into cfg from public.pricing_configs where is_current;
  if not found then raise exception 'Configuração de preços indisponível.' using errcode = 'P0001'; end if;
  if sub > (cfg.config->>'commissionThresholdCents')::int then
    commission := round(sub * (cfg.config->>'commissionBps')::numeric / 10000);
  end if;
  if _fulfillment = 'delivery_own' then
    fee := b.own_delivery_fee_cents;
    platform_fee := (cfg.config->'ownDelivery'->>'platformFeeCents')::int;
  elsif _fulfillment = 'delivery_partner' then
    fee := (cfg.config->'partnerDelivery'->>'customerFeeCents')::int;
    merchant_contrib := (cfg.config->'partnerDelivery'->>'merchantContributionCents')::int;
    courier_pay := (cfg.config->'partnerDelivery'->>'courierPayCents')::int;
    platform_fee := (cfg.config->'partnerDelivery'->>'platformFeeCents')::int;
  end if;
  if _change_for_cents is not null and _change_for_cents < sub + fee then
    raise exception 'O valor para troco precisa ser maior que o total.' using errcode = 'P0001';
  end if;

  insert into public.orders(customer_id, business_id, fulfillment, payment_method, change_for_cents, customer_name, customer_phone,
                            delivery_address, delivery_reference, notes, subtotal_cents, delivery_fee_cents, total_cents,
                            commission_cents, merchant_delivery_contribution_cents, courier_pay_cents, platform_delivery_fee_cents,
                            pricing_config_id, pricing_snapshot, idempotency_key)
  values (uid, b.id, _fulfillment, _payment, _change_for_cents, btrim(_customer_name), btrim(_customer_phone),
          case when _fulfillment = 'pickup' then null else btrim(_delivery_address) end,
          case when _fulfillment = 'pickup' then null else nullif(btrim(coalesce(_delivery_reference, '')), '') end,
          nullif(btrim(coalesce(_notes, '')), ''), sub, fee, sub + fee, commission, merchant_contrib, courier_pay, platform_fee,
          cfg.id, jsonb_build_object('version', cfg.version, 'config', cfg.config), _idempotency_key)
  returning * into o;
  new_id := o.id;
  insert into public.order_items(order_id, product_id, name, unit_price_cents, quantity, options, line_total_cents, notes)
  select new_id, (l->>'product_id')::uuid, l->>'name', (l->>'unit')::int, (l->>'qty')::int, l->'options',
         (l->>'unit')::int * (l->>'qty')::int, l->>'notes'
    from jsonb_array_elements(lines) l;
  insert into public.order_events(order_id, status, actor_id) values (new_id, 'placed', uid);
  perform private.mark_pricing_config_used(cfg.id);
  perform private.notify_order_staff(o, 'order_new', 'Novo pedido #' || o.code || '.');
  return new_id;
end $$;

-- ---------- mudar status ----------
-- Estabelecimento (orders.update_status): placed->accepted|rejected; accepted->preparing; preparing->ready;
--   ready->out_for_delivery (entrega própria) | picked_up (retirada); out_for_delivery->delivered (entrega própria);
--   accepted|preparing|ready -> cancelled (com motivo). Entrega parceira segue pelas funções do entregador (0012).
-- Cliente: placed -> cancelled (antes do aceite).
create or replace function public.update_order_status(_order uuid, _status public.order_status, _note text default null)
returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; staff boolean; ok boolean := false; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('order.status');
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  staff := public.has_business_permission(o.business_id, 'orders.update_status');
  if not staff and o.customer_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;

  if staff then
    ok := (o.status = 'placed' and _status in ('accepted', 'rejected'))
       or (o.status = 'accepted' and _status = 'preparing')
       or (o.status = 'preparing' and _status = 'ready')
       or (o.status = 'ready' and o.fulfillment = 'delivery_own' and _status = 'out_for_delivery')
       or (o.status = 'ready' and o.fulfillment = 'pickup' and _status = 'picked_up')
       or (o.status = 'out_for_delivery' and o.fulfillment = 'delivery_own' and _status = 'delivered')
       or (o.status in ('accepted', 'preparing', 'ready') and _status = 'cancelled');
  end if;
  if not ok and o.customer_id = auth.uid() then
    ok := o.status = 'placed' and _status = 'cancelled';
  end if;
  if not ok then raise exception 'Mudança de status não permitida (% → %).', o.status, _status using errcode = 'P0001'; end if;
  if _status in ('rejected') and note is null then raise exception 'Informe o motivo da recusa.' using errcode = 'P0001'; end if;
  if _status = 'cancelled' and staff and note is null then raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001'; end if;

  update public.orders set status = _status, rejection_reason = case when _status in ('rejected', 'cancelled') then note else rejection_reason end
   where id = o.id;
  insert into public.order_events(order_id, status, actor_id, note) values (o.id, _status, auth.uid(), note);
  if staff then
    perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id,
      'Pedido #' || o.code || ': ' || case _status
        when 'accepted' then 'aceito pelo estabelecimento.'
        when 'rejected' then 'recusado. ' || coalesce(note, '')
        when 'preparing' then 'em preparo.'
        when 'ready' then case when o.fulfillment = 'pickup' then 'pronto para retirada.' else 'pronto, aguardando entrega.' end
        when 'out_for_delivery' then 'saiu para entrega.'
        when 'delivered' then 'entregue. Bom apetite!'
        when 'picked_up' then 'retirado.'
        when 'cancelled' then 'cancelado pelo estabelecimento. ' || coalesce(note, '')
        else _status::text end);
  else
    perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' cancelado pelo cliente.');
  end if;
  return _status;
end $$;

-- ---------- avaliação verificada ----------
alter table public.reviews
  add column reply text check (reply is null or char_length(reply) <= 1000),
  add column replied_at timestamptz;
create unique index reviews_order_unique_idx on public.reviews(order_id);
alter table public.reviews add constraint reviews_order_fk foreign key (order_id) references public.orders(id) on delete set null;
revoke select on public.reviews from anon, authenticated;
grant select (id, business_id, rating, comment, author_name, created_at, reply, replied_at) on public.reviews to anon, authenticated;

create or replace function public.submit_review(_order uuid, _rating integer, _comment text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; rid uuid; author text;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('order.review');
  select * into o from public.orders where id = _order and customer_id = auth.uid();
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  if o.status not in ('delivered', 'picked_up') then raise exception 'Avalie depois de receber o pedido.' using errcode = 'P0001'; end if;
  if _rating not between 1 and 5 then raise exception 'Nota de 1 a 5.' using errcode = 'P0001'; end if;
  if char_length(coalesce(_comment, '')) > 1000 then raise exception 'Comentário muito longo.' using errcode = 'P0001'; end if;
  select split_part(btrim(o.customer_name), ' ', 1) into author;
  insert into public.reviews(business_id, user_id, order_id, rating, comment, author_name)
  values (o.business_id, auth.uid(), o.id, _rating, nullif(btrim(coalesce(_comment, '')), ''), author)
  returning id into rid;
  return rid;
exception when unique_violation then
  raise exception 'Este pedido já foi avaliado.' using errcode = 'P0001';
end $$;

create or replace function public.reply_review(_review uuid, _reply text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reviews%rowtype;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('order.reply');
  select * into r from public.reviews where id = _review;
  if not found or not (public.has_business_permission(r.business_id, 'store.customize') or public.has_business_permission(r.business_id, 'settings.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(_reply, ''))) not between 1 and 1000 then raise exception 'Resposta de 1 a 1000 caracteres.' using errcode = 'P0001'; end if;
  update public.reviews set reply = btrim(_reply), replied_at = now() where id = r.id;
end $$;

create or replace function public.my_order_review(_order uuid) returns table (rating smallint, comment text, reply text)
language sql stable security definer set search_path = '' as $$
  select v.rating, v.comment, v.reply from public.reviews v join public.orders o on o.id = v.order_id
   where v.order_id = _order and o.customer_id = auth.uid()
$$;

-- ---------- painel: vendas ----------
create or replace function public.business_sales_summary(_business uuid, _days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with o as (select * from public.orders where business_id = _business and created_at > now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 366)))
    select jsonb_build_object(
      'orders_total', (select count(*) from o),
      'orders_completed', (select count(*) from o where status in ('delivered', 'picked_up')),
      'orders_cancelled', (select count(*) from o where status in ('rejected', 'cancelled')),
      'gross_cents', coalesce((select sum(subtotal_cents) from o where status in ('delivered', 'picked_up')), 0),
      'commission_cents', coalesce((select sum(commission_cents) from o where status in ('delivered', 'picked_up')), 0),
      'delivery_costs_cents', coalesce((select sum(merchant_delivery_contribution_cents + platform_delivery_fee_cents) from o where status in ('delivered', 'picked_up')), 0),
      'top_products', coalesce((select jsonb_agg(t) from (
          select i.name, sum(i.quantity)::int as qty, sum(i.line_total_cents)::int as total_cents
            from public.order_items i join o on o.id = i.order_id where o.status in ('delivered', 'picked_up')
           group by i.name order by qty desc limit 5) t), '[]'::jsonb)));
end $$;

-- ---------- RLS ----------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
create policy orders_select on public.orders for select to authenticated using (public.can_view_order(id));
create policy order_items_select on public.order_items for select to authenticated using (public.can_view_order(order_id));
create policy order_events_select on public.order_events for select to authenticated using (public.can_view_order(order_id));
revoke all on public.orders, public.order_items, public.order_events from public, anon, authenticated;
grant select on public.orders, public.order_items, public.order_events to authenticated;

do $$
declare f text;
begin
  revoke all on function private.notify_order_staff(public.orders, text, text) from public, anon, authenticated;
  foreach f in array array[
    'public.can_view_order(uuid)',
    'public.place_order(uuid, jsonb, public.order_fulfillment, public.order_payment, text, text, text, text, text, integer, text)',
    'public.update_order_status(uuid, public.order_status, text)',
    'public.submit_review(uuid, integer, text)', 'public.reply_review(uuid, text)', 'public.my_order_review(uuid)',
    'public.business_sales_summary(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0011', '0011_orders.sql', 'applied');
    raise notice 'Tucaí 0011: aplicada agora';
  end if;
end $tucai_0011$;

-- ===================== supabase/migrations/0012_deliveries.sql =====================
do $tucai_0012$
begin
  if exists (select 1 from private.tucai_migrations where version = '0012') then
    raise notice 'Tucaí 0012: já aplicada';
  else
    execute $tucai_sql$
-- 0012_deliveries: distribuição de entregas para entregadores parceiros.
--  * Pedido com entrega parceira marcado "pronto" vira oferta para entregadores aprovados,
--    disponíveis e da mesma cidade do estabelecimento.
--  * Aceite atômico: um único UPDATE condicional garante que só um entregador fica com a entrega.
--  * Coleta e entrega confirmadas pelo entregador; a entrega exige o código de 4 dígitos que só o
--    cliente vê. Liberar a entrega antes da coleta devolve a oferta.
--  * Ganho do entregador = courier_pay_cents do snapshot do pedido (regra aprovada, sem valor fictício).
--  * Distância e tempo não são estimados: não há serviço de rotas contratado.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('delivery.action', 120, 600), ('delivery.code', 10, 600);

create type public.delivery_status as enum ('offered', 'accepted', 'picked_up', 'delivered', 'cancelled');

create table public.deliveries (
  order_id uuid primary key references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id),
  city_id uuid references public.cities(id),
  status public.delivery_status not null default 'offered',
  -- referência à conta (não ao cadastro): a anonimização apaga o cadastro e mantém o histórico
  courier_id uuid references auth.users(id),
  courier_pay_cents integer not null check (courier_pay_cents >= 0),
  confirmation_code text not null default lpad((floor(random() * 10000))::int::text, 4, '0') check (confirmation_code ~ '^[0-9]{4}$'),
  failed_code_attempts smallint not null default 0,
  offered_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  check (status <> 'offered' or courier_id is null),
  check (status not in ('accepted', 'picked_up') or courier_id is not null)
);
create index deliveries_offer_idx on public.deliveries(city_id, status, offered_at);
create index deliveries_courier_idx on public.deliveries(courier_id, status);
create index deliveries_business_idx on public.deliveries(business_id);

-- pronto + entrega parceira -> oferta; cancelado/recusado -> cancela a entrega
create or replace function private.orders_delivery_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid; cour uuid;
begin
  if new.fulfillment = 'delivery_partner' and new.status = 'ready' and old.status <> 'ready' then
    select city_id into c from public.businesses where id = new.business_id;
    insert into public.deliveries(order_id, business_id, city_id, courier_pay_cents)
    values (new.id, new.business_id, c, new.courier_pay_cents) on conflict (order_id) do nothing;
    for cour in select user_id from public.couriers where status = 'approved' and is_online and city_id = c loop
      perform private.notify_link(cour, 'delivery_offer', null, '/entregador/ofertas', 'Nova entrega disponível perto de você.');
    end loop;
  elsif new.status in ('cancelled', 'rejected') and old.status <> new.status then
    update public.deliveries set status = 'cancelled' where order_id = new.id and status in ('offered', 'accepted');
  end if;
  return null;
end $$;
create trigger orders_delivery_sync after update of status on public.orders
  for each row execute function private.orders_delivery_sync();

-- entregador vê o pedido que está entregando
create or replace function public.can_view_order(_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = _order and (
    o.customer_id = auth.uid()
    or public.has_business_permission(o.business_id, 'orders.view')
    or public.has_platform_permission('orders.view')
    or exists (select 1 from public.deliveries d where d.order_id = o.id and d.courier_id = auth.uid())))
$$;

create or replace function private.require_active_courier() returns public.couriers
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype;
begin
  select * into c from public.couriers where user_id = auth.uid();
  if not found or c.status <> 'approved' then raise exception 'Cadastro de entregador não aprovado.' using errcode = '42501'; end if;
  return c;
end $$;

-- ofertas abertas na cidade do entregador (sem dados do cliente antes do aceite)
create or replace function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  if not c.is_online then return; end if;
  return query
    select d.order_id, b.name, b.address_line, d.courier_pay_cents, d.offered_at,
           -- só a parte final do endereço (bairro/cidade) antes do aceite
           nullif(btrim(split_part(o.delivery_address, ',', -1)), ''),
           (select count(*) from public.order_items i where i.order_id = o.id)
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      join public.businesses b on b.id = d.business_id
     where d.status = 'offered' and d.city_id = c.city_id
     order by d.offered_at;
end $$;

create or replace function public.courier_accept_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int;
begin
  perform private.limit_for('delivery.action');
  if not c.is_online then raise exception 'Fique disponível para aceitar entregas.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.deliveries where courier_id = c.user_id and status in ('accepted', 'picked_up')) then
    raise exception 'Conclua a entrega atual antes de aceitar outra.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'accepted', courier_id = c.user_id, accepted_at = now()
   where order_id = _order and status = 'offered' and courier_id is null and city_id = c.city_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Esta entrega já foi aceita por outro entregador ou não está mais disponível.' using errcode = 'P0001'; end if;
  perform private.audit('delivery.accept', 'deliveries', _order::text, '{}'::jsonb);
end $$;

create or replace function public.courier_release_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int;
begin
  perform private.limit_for('delivery.action');
  update public.deliveries set status = 'offered', courier_id = null, accepted_at = null
   where order_id = _order and courier_id = c.user_id and status = 'accepted';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Só é possível liberar antes da coleta.' using errcode = 'P0001'; end if;
  perform private.audit('delivery.release', 'deliveries', _order::text, '{}'::jsonb);
end $$;

create or replace function public.courier_pickup_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); o public.orders%rowtype;
begin
  perform private.limit_for('delivery.action');
  update public.deliveries set status = 'picked_up', picked_up_at = now()
   where order_id = _order and courier_id = c.user_id and status = 'accepted';
  if not found then raise exception 'Entrega não está aceita por você.' using errcode = 'P0001'; end if;
  update public.orders set status = 'out_for_delivery' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'out_for_delivery', c.user_id, 'Coletado pelo entregador parceiro');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' saiu para entrega.');
end $$;

create or replace function public.courier_complete_delivery(_order uuid, _code text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype; o public.orders%rowtype;
begin
  perform private.limit_for('delivery.code');
  select * into d from public.deliveries where order_id = _order and courier_id = c.user_id and status = 'picked_up' for update;
  if not found then raise exception 'Entrega não está em rota com você.' using errcode = 'P0001'; end if;
  if d.failed_code_attempts >= 5 then raise exception 'Muitas tentativas de código. Fale com o suporte.' using errcode = 'P0001'; end if;
  if coalesce(btrim(_code), '') <> d.confirmation_code then
    update public.deliveries set failed_code_attempts = failed_code_attempts + 1 where order_id = _order;
    return;  -- registra a tentativa; a interface informa código incorreto
  end if;
  update public.deliveries set status = 'delivered', delivered_at = now() where order_id = _order;
  update public.orders set status = 'delivered' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'delivered', c.user_id, 'Entregue com código de confirmação');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' entregue. Bom apetite!');
  perform private.audit('delivery.complete', 'deliveries', _order::text, jsonb_build_object('pay_cents', d.courier_pay_cents));
end $$;

-- entrega do próprio entregador (ativa e histórico) com o necessário para entregar
create or replace function public.courier_my_deliveries(_active boolean default true)
returns table (order_id uuid, order_code text, status public.delivery_status, business_name text, business_address text,
               business_phone text, customer_name text, customer_phone text, delivery_address text, delivery_reference text,
               payment_method public.order_payment, total_cents integer, change_for_cents integer, courier_pay_cents integer,
               accepted_at timestamptz, delivered_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  return query
    select d.order_id, o.code, d.status, b.name, b.address_line, b.phone,
           o.customer_name, o.customer_phone, o.delivery_address, o.delivery_reference,
           o.payment_method, o.total_cents, o.change_for_cents, d.courier_pay_cents, d.accepted_at, d.delivered_at
      from public.deliveries d join public.orders o on o.id = d.order_id join public.businesses b on b.id = d.business_id
     where d.courier_id = c.user_id
       and ((_active and d.status in ('accepted', 'picked_up')) or (not _active and d.status = 'delivered'))
     order by coalesce(d.delivered_at, d.accepted_at) desc
     limit 100;
end $$;

create or replace function public.courier_earnings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  return jsonb_build_object(
    'today_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'
                               and delivered_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0),
    'week_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'
                              and delivered_at >= now() - interval '7 days'), 0),
    'total_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'), 0),
    'deliveries', (select count(*) from public.deliveries where courier_id = c.user_id and status = 'delivered'));
end $$;

-- cliente: andamento da entrega e código de confirmação
create or replace function public.my_delivery(_order uuid)
returns table (status public.delivery_status, confirmation_code text, courier_first_name text, courier_vehicle public.courier_vehicle)
language sql stable security definer set search_path = '' as $$
  select d.status, case when d.status in ('accepted', 'picked_up') then d.confirmation_code end,
         split_part(c.full_name, ' ', 1), c.vehicle
    from public.deliveries d join public.orders o on o.id = d.order_id left join public.couriers c on c.user_id = d.courier_id
   where d.order_id = _order and o.customer_id = auth.uid()
$$;

-- ---------- RLS ----------
alter table public.deliveries enable row level security;
-- leitura direta só pela equipe do estabelecimento (sem o código); entregador e cliente usam as funções
create policy deliveries_select on public.deliveries for select to authenticated
  using (public.has_business_permission(business_id, 'orders.view') or public.has_platform_permission('orders.view'));
revoke all on public.deliveries from public, anon, authenticated;
grant select (order_id, business_id, city_id, status, courier_id, courier_pay_cents, offered_at, accepted_at, picked_up_at, delivered_at)
  on public.deliveries to authenticated;

do $$
declare f text;
begin
  revoke all on function private.orders_delivery_sync() from public, anon, authenticated;
  revoke all on function private.require_active_courier() from public, anon, authenticated;
  foreach f in array array[
    'public.can_view_order(uuid)', 'public.courier_list_offers()', 'public.courier_accept_delivery(uuid)',
    'public.courier_release_delivery(uuid)', 'public.courier_pickup_delivery(uuid)', 'public.courier_complete_delivery(uuid, text)',
    'public.courier_my_deliveries(boolean)', 'public.courier_earnings()', 'public.my_delivery(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0012', '0012_deliveries.sql', 'applied');
    raise notice 'Tucaí 0012: aplicada agora';
  end if;
end $tucai_0012$;

-- ===================== supabase/migrations/0013_jobs.sql =====================
do $tucai_0013$
begin
  if exists (select 1 from private.tucai_migrations where version = '0013') then
    raise notice 'Tucaí 0013: já aplicada';
  else
    execute $tucai_sql$
-- 0013_jobs: vagas de emprego publicadas por estabelecimentos ativos e candidaturas.
--  * Publicação e gestão exigem a permissão de empresa jobs.manage (dono e gerente).
--  * Vaga pública só enquanto aberta, dentro da validade e de estabelecimento ativo.
--  * Candidatura única por vaga; a pessoa acompanha o andamento e pode desistir.
--  * Equipe da plataforma com jobs.manage pode encerrar vagas irregulares.
--  * Currículo em texto (sem upload de arquivo: armazenamento de arquivos ainda não contratado).
--  * LGPD: pedidos, entregas e candidaturas entram na exportação; a anonimização apaga contato e endereço.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('job.save', 30, 3600), ('job.apply', 20, 3600), ('job.application_update', 200, 600);

insert into public.permissions(code) values ('jobs.manage') on conflict do nothing;
insert into public.role_permissions(member_role, permission) values ('owner', 'jobs.manage'), ('manager', 'jobs.manage')
  on conflict do nothing;

create type public.job_employment as enum ('clt', 'pj', 'temporario', 'estagio', 'freelancer', 'meio_periodo');
create type public.job_work_mode as enum ('presencial', 'hibrido', 'remoto');
create type public.job_status as enum ('open', 'paused', 'closed');
create type public.job_application_status as enum ('submitted', 'reviewing', 'interview', 'rejected', 'hired', 'withdrawn');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  city_id uuid references public.cities(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  area text not null check (area in ('atendimento', 'cozinha', 'entregas', 'vendas', 'administrativo', 'servicos_gerais', 'tecnologia', 'outros')),
  description text not null check (char_length(btrim(description)) between 20 and 4000),
  requirements text check (requirements is null or char_length(requirements) <= 2000),
  benefits text check (benefits is null or char_length(benefits) <= 1000),
  employment_type public.job_employment not null,
  work_mode public.job_work_mode not null default 'presencial',
  salary_min_cents integer check (salary_min_cents is null or salary_min_cents > 0),
  salary_max_cents integer check (salary_max_cents is null or salary_max_cents > 0),
  openings smallint not null default 1 check (openings between 1 and 100),
  status public.job_status not null default 'open',
  expires_at timestamptz not null default now() + interval '30 days',
  created_by uuid references auth.users(id) on delete set null,
  closed_reason text check (closed_reason is null or char_length(closed_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (salary_max_cents is null or salary_min_cents is null or salary_max_cents >= salary_min_cents)
);
create index jobs_public_idx on public.jobs(city_id, status, created_at desc);
create index jobs_business_idx on public.jobs(business_id, created_at desc);
create index jobs_created_by_idx on public.jobs(created_by);
create trigger jobs_updated before update on public.jobs for each row execute function public.set_updated_at();

create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 3 and 120),
  phone text not null check (phone ~ '^[0-9+() -]{8,20}$'),
  message text check (message is null or char_length(message) <= 1500),
  experience text check (experience is null or char_length(experience) <= 3000),
  status public.job_application_status not null default 'submitted',
  employer_note text check (employer_note is null or char_length(employer_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);
create index job_applications_applicant_idx on public.job_applications(applicant_id, created_at desc);
create trigger job_applications_updated before update on public.job_applications for each row execute function public.set_updated_at();

-- notificações de vagas
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply',
  'order_new', 'order_update', 'delivery_offer', 'job_application', 'job_update'));
alter table public.notifications drop constraint notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or link ~ '^/(conectuai|pedidos|painel|entregador|vagas)/[A-Za-z0-9/_-]*$');

create or replace function public.job_is_public(_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j where j.id = _job and j.status = 'open' and j.expires_at > now()
                   and public.is_active_business(j.business_id))
$$;

-- criar/editar vaga
create or replace function public.save_job(
  _business uuid, _title text, _area text, _description text, _employment public.job_employment,
  _work_mode public.job_work_mode default 'presencial', _requirements text default null, _benefits text default null,
  _salary_min_cents integer default null, _salary_max_cents integer default null, _openings integer default 1,
  _days integer default 30, _job uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b public.businesses%rowtype; jid uuid;
begin
  if not public.has_business_permission(_business, 'jobs.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('job.save');
  select * into b from public.businesses where id = _business;
  if b.status <> 'active' then raise exception 'Só estabelecimentos ativos publicam vagas.' using errcode = 'P0001'; end if;
  if coalesce(_days, 30) not between 1 and 90 then raise exception 'Validade de 1 a 90 dias.' using errcode = 'P0001'; end if;
  if _job is null then
    insert into public.jobs(business_id, city_id, title, area, description, requirements, benefits, employment_type, work_mode,
                            salary_min_cents, salary_max_cents, openings, expires_at, created_by)
    values (b.id, b.city_id, btrim(_title), _area, btrim(_description), nullif(btrim(coalesce(_requirements, '')), ''),
            nullif(btrim(coalesce(_benefits, '')), ''), _employment, coalesce(_work_mode, 'presencial'), _salary_min_cents, _salary_max_cents,
            coalesce(_openings, 1), now() + make_interval(days => coalesce(_days, 30)), auth.uid())
    returning id into jid;
  else
    update public.jobs set title = btrim(_title), area = _area, description = btrim(_description),
           requirements = nullif(btrim(coalesce(_requirements, '')), ''), benefits = nullif(btrim(coalesce(_benefits, '')), ''),
           employment_type = _employment, work_mode = coalesce(_work_mode, 'presencial'),
           salary_min_cents = _salary_min_cents, salary_max_cents = _salary_max_cents, openings = coalesce(_openings, 1),
           expires_at = now() + make_interval(days => coalesce(_days, 30)), city_id = b.city_id
     where id = _job and business_id = b.id and status <> 'closed'
    returning id into jid;
    if jid is null then raise exception 'Vaga não encontrada ou encerrada.' using errcode = 'P0001'; end if;
  end if;
  perform private.audit('job.save', 'jobs', jid::text, jsonb_build_object('business', b.id));
  return jid;
end $$;

create or replace function public.set_job_status(_job uuid, _status public.job_status, _reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs%rowtype; platform boolean;
begin
  select * into j from public.jobs where id = _job;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  platform := public.has_platform_permission('jobs.manage');
  if not public.has_business_permission(j.business_id, 'jobs.manage') and not (platform and _status = 'closed') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.limit_for('job.save');
  if j.status = 'closed' then raise exception 'Vaga encerrada não pode ser reaberta. Publique uma nova.' using errcode = 'P0001'; end if;
  update public.jobs set status = _status, closed_reason = case when _status = 'closed' then nullif(btrim(coalesce(_reason, '')), '') end
   where id = j.id;
  perform private.audit('job.status', 'jobs', j.id::text, jsonb_build_object('status', _status, 'platform', platform));
end $$;

-- candidatar-se
create or replace function public.apply_to_job(_job uuid, _full_name text, _phone text, _message text default null, _experience text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare j public.jobs%rowtype; aid uuid; m uuid;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para se candidatar.' using errcode = '42501'; end if;
  perform private.limit_for('job.apply');
  if not public.job_is_public(_job) then raise exception 'Vaga indisponível.' using errcode = 'P0001'; end if;
  select * into j from public.jobs where id = _job;
  if public.has_business_permission(j.business_id, 'orders.view') then
    raise exception 'A equipe do estabelecimento não pode se candidatar à própria vaga.' using errcode = 'P0001';
  end if;
  insert into public.job_applications(job_id, applicant_id, full_name, phone, message, experience)
  values (_job, auth.uid(), btrim(_full_name), btrim(_phone), nullif(btrim(coalesce(_message, '')), ''), nullif(btrim(coalesce(_experience, '')), ''))
  returning id into aid;
  for m in select bm.user_id from public.business_members bm join public.role_permissions rp on rp.member_role = bm.member_role and rp.permission = 'jobs.manage'
            where bm.business_id = j.business_id loop
    perform private.notify_link(m, 'job_application', null, '/painel/' || j.business_id || '/vagas', 'Nova candidatura para "' || left(j.title, 60) || '".');
  end loop;
  return aid;
exception when unique_violation then
  raise exception 'Você já se candidatou a esta vaga.' using errcode = 'P0001';
end $$;

create or replace function public.withdraw_application(_application uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.job_applications set status = 'withdrawn'
   where id = _application and applicant_id = auth.uid() and status not in ('hired', 'rejected', 'withdrawn');
  if not found then raise exception 'Candidatura não pode ser retirada.' using errcode = 'P0001'; end if;
end $$;

create or replace function public.update_application_status(_application uuid, _status public.job_application_status, _note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.job_applications%rowtype; j public.jobs%rowtype;
begin
  select * into a from public.job_applications where id = _application;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from public.jobs where id = a.job_id;
  if not public.has_business_permission(j.business_id, 'jobs.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('job.application_update');
  if _status in ('submitted', 'withdrawn') then raise exception 'Status inválido.' using errcode = 'P0001'; end if;
  if a.status = 'withdrawn' then raise exception 'A pessoa retirou a candidatura.' using errcode = 'P0001'; end if;
  update public.job_applications set status = _status, employer_note = nullif(btrim(coalesce(_note, '')), '') where id = a.id;
  perform private.notify_link(a.applicant_id, 'job_update', null, '/vagas/' || j.id,
    'Sua candidatura para "' || left(j.title, 60) || '": ' || case _status
      when 'reviewing' then 'em análise.' when 'interview' then 'chamada para entrevista.'
      when 'rejected' then 'não seguiu no processo.' when 'hired' then 'aprovada!' else _status::text end);
end $$;

-- ---------- RLS ----------
alter table public.jobs enable row level security;
alter table public.job_applications enable row level security;
create policy jobs_select_public on public.jobs for select to anon using (public.job_is_public(id));
create policy jobs_select on public.jobs for select to authenticated
  using (public.job_is_public(id) or public.has_business_permission(business_id, 'jobs.manage') or public.has_platform_permission('jobs.manage'));
create policy job_applications_select on public.job_applications for select to authenticated
  using (applicant_id = (select auth.uid())
         or exists (select 1 from public.jobs j where j.id = job_id and public.has_business_permission(j.business_id, 'jobs.manage')));
revoke all on public.jobs, public.job_applications from public, anon, authenticated;
grant select on public.jobs to anon, authenticated;
grant select on public.job_applications to authenticated;

-- ---------- LGPD ----------
create or replace function private.commerce_export(_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'status', o.status, 'created_at', o.created_at,
                          'total_cents', o.total_cents, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
                          'delivery_address', o.delivery_address,
                          'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.quantity)) from public.order_items i where i.order_id = o.id))
                          order by o.created_at) from public.orders o where o.customer_id = _uid), '[]'::jsonb),
    'deliveries_made', (select count(*) from public.deliveries d where d.courier_id = _uid and d.status = 'delivered'),
    'job_applications', coalesce((select jsonb_agg(jsonb_build_object('job', j.title, 'status', a.status, 'created_at', a.created_at,
                          'full_name', a.full_name, 'phone', a.phone, 'message', a.message, 'experience', a.experience))
                          from public.job_applications a join public.jobs j on j.id = a.job_id where a.applicant_id = _uid), '[]'::jsonb))
$$;
revoke all on function private.commerce_export(uuid) from public, anon, authenticated;

do $$
declare src text;
begin
  select pg_get_functiondef('public.my_data_export()'::regprocedure) into src;
  if strpos(src, '''notes'', jsonb_build_array(') = 0 then raise exception 'my_data_export: ponto de extensão não encontrado'; end if;
  src := replace(src, '''notes'', jsonb_build_array(', '''commerce'', private.commerce_export(uid),
    ''notes'', jsonb_build_array(');
  execute src;

  select pg_get_functiondef('private.anonymize_user(uuid)'::regprocedure) into src;
  if strpos(src, 'delete from public.notifications where user_id = _user;') = 0 then raise exception 'anonymize_user: ponto de extensão não encontrado'; end if;
  src := replace(src, 'delete from public.notifications where user_id = _user;', 'delete from public.notifications where user_id = _user;
  -- pedidos ficam para a contabilidade do estabelecimento, sem dados pessoais
  update public.orders set customer_name = ''Cliente removido'', customer_phone = ''00000000'', notes = null,
         delivery_address = case when delivery_address is null then null else ''Endereço removido'' end, delivery_reference = null
   where customer_id = _user;
  delete from public.job_applications where applicant_id = _user;');
  execute src;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.job_is_public(uuid)',
    'public.save_job(uuid, text, text, text, public.job_employment, public.job_work_mode, text, text, integer, integer, integer, integer, uuid)',
    'public.set_job_status(uuid, public.job_status, text)',
    'public.apply_to_job(uuid, text, text, text, text)', 'public.withdraw_application(uuid)',
    'public.update_application_status(uuid, public.job_application_status, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  grant execute on function public.job_is_public(uuid) to anon;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0013', '0013_jobs.sql', 'applied');
    raise notice 'Tucaí 0013: aplicada agora';
  end if;
end $tucai_0013$;

-- ===================== supabase/migrations/0014_cidades_regiao_itau.sql =====================
do $tucai_0014$
begin
  if exists (select 1 from private.tucai_migrations where version = '0014') then
    raise notice 'Tucaí 0014: já aplicada';
  else
    execute $tucai_sql$
-- 0014_cidades_regiao_itau: cidades atendidas num raio de ~100 km de Itaú de Minas (MG).
-- Idempotente: cidades já cadastradas (por nome+UF ou slug) são mantidas como estão.
-- Coordenadas ficam para o Master definir depois. Estabelecimentos de cada cidade aparecem
-- quando a pessoa escolhe a cidade no seletor do topo.

insert into public.cities (name, state, slug) values
  ('Alpinópolis', 'MG', 'alpinopolis-mg'),
  ('Alterosa', 'MG', 'alterosa-mg'),
  ('Arceburgo', 'MG', 'arceburgo-mg'),
  ('Areado', 'MG', 'areado-mg'),
  ('Bom Jesus da Penha', 'MG', 'bom-jesus-da-penha-mg'),
  ('Cabo Verde', 'MG', 'cabo-verde-mg'),
  ('Capetinga', 'MG', 'capetinga-mg'),
  ('Capitólio', 'MG', 'capitolio-mg'),
  ('Carmo do Rio Claro', 'MG', 'carmo-do-rio-claro-mg'),
  ('Cássia', 'MG', 'cassia-mg'),
  ('Claraval', 'MG', 'claraval-mg'),
  ('Conceição da Aparecida', 'MG', 'conceicao-da-aparecida-mg'),
  ('Delfinópolis', 'MG', 'delfinopolis-mg'),
  ('Fortaleza de Minas', 'MG', 'fortaleza-de-minas-mg'),
  ('Guapé', 'MG', 'guape-mg'),
  ('Guaranésia', 'MG', 'guaranesia-mg'),
  ('Guaxupé', 'MG', 'guaxupe-mg'),
  ('Ibiraci', 'MG', 'ibiraci-mg'),
  ('Ilicínea', 'MG', 'ilicinea-mg'),
  ('Itamogi', 'MG', 'itamogi-mg'),
  ('Itaú de Minas', 'MG', 'itau-de-minas-mg'),
  ('Jacuí', 'MG', 'jacui-mg'),
  ('Juruaia', 'MG', 'juruaia-mg'),
  ('Monte Belo', 'MG', 'monte-belo-mg'),
  ('Monte Santo de Minas', 'MG', 'monte-santo-de-minas-mg'),
  ('Muzambinho', 'MG', 'muzambinho-mg'),
  ('Nova Resende', 'MG', 'nova-resende-mg'),
  ('Passos', 'MG', 'passos-mg'),
  ('Piumhi', 'MG', 'piumhi-mg'),
  ('Pratápolis', 'MG', 'pratapolis-mg'),
  ('São João Batista do Glória', 'MG', 'sao-joao-batista-do-gloria-mg'),
  ('São José da Barra', 'MG', 'sao-jose-da-barra-mg'),
  ('São Pedro da União', 'MG', 'sao-pedro-da-uniao-mg'),
  ('São Roque de Minas', 'MG', 'sao-roque-de-minas-mg'),
  ('São Sebastião do Paraíso', 'MG', 'sao-sebastiao-do-paraiso-mg'),
  ('São Tomás de Aquino', 'MG', 'sao-tomas-de-aquino-mg'),
  ('Tapira', 'MG', 'tapira-mg'),
  ('Vargem Bonita', 'MG', 'vargem-bonita-mg'),
  ('Altinópolis', 'SP', 'altinopolis-sp'),
  ('Batatais', 'SP', 'batatais-sp'),
  ('Brodowski', 'SP', 'brodowski-sp'),
  ('Caconde', 'SP', 'caconde-sp'),
  ('Cajuru', 'SP', 'cajuru-sp'),
  ('Cássia dos Coqueiros', 'SP', 'cassia-dos-coqueiros-sp'),
  ('Cristais Paulista', 'SP', 'cristais-paulista-sp'),
  ('Franca', 'SP', 'franca-sp'),
  ('Itirapuã', 'SP', 'itirapua-sp'),
  ('Jeriquara', 'SP', 'jeriquara-sp'),
  ('Mococa', 'SP', 'mococa-sp'),
  ('Patrocínio Paulista', 'SP', 'patrocinio-paulista-sp'),
  ('Pedregulho', 'SP', 'pedregulho-sp'),
  ('Restinga', 'SP', 'restinga-sp'),
  ('Ribeirão Corrente', 'SP', 'ribeirao-corrente-sp'),
  ('Santa Cruz da Esperança', 'SP', 'santa-cruz-da-esperanca-sp'),
  ('Santo Antônio da Alegria', 'SP', 'santo-antonio-da-alegria-sp'),
  ('São José da Bela Vista', 'SP', 'sao-jose-da-bela-vista-sp'),
  ('São José do Rio Pardo', 'SP', 'sao-jose-do-rio-pardo-sp'),
  ('Tapiratiba', 'SP', 'tapiratiba-sp')
on conflict do nothing;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0014', '0014_cidades_regiao_itau.sql', 'applied');
    raise notice 'Tucaí 0014: aplicada agora';
  end if;
end $tucai_0014$;

-- ===================== supabase/migrations/0015_test_data.sql =====================
do $tucai_0015$
begin
  if exists (select 1 from private.tucai_migrations where version = '0015') then
    raise notice 'Tucaí 0015: já aplicada';
  else
    execute $tucai_sql$
-- 0015_test_data: gerador de DADOS DE TESTE para o Master validar o sistema numa cidade.
--  * Só platform_master (com MFA quando exigido) cria ou remove.
--  * Cria, na cidade escolhida: 2 estabelecimentos ativos marcados "[Teste]" com horários,
--    cardápio e modalidades de entrega (um com entregador parceiro, outro com entrega própria),
--    1 vaga, 1 entregador aprovado e 5 logins (2 lojistas, 1 entregador, 2 clientes).
--  * A senha dos logins é gerada no servidor e devolvida UMA vez (não é guardada em texto).
--  * Tudo fica registrado em private.test_data_runs e pode ser removido por completo.
--  * E-mails em example.com (domínio reservado, RFC 2606): nenhum e-mail real é usado.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.test_data', 10, 3600);

create table private.test_data_runs (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references public.cities(id) on delete set null,
  created_by uuid,
  user_ids uuid[] not null default '{}',
  business_ids uuid[] not null default '{}',
  logins jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
revoke all on private.test_data_runs from public, anon, authenticated;

-- conta confirmada no Supabase Auth (mesmo formato do painel "Add user" com Auto Confirm)
create or replace function private.create_auth_user(_email text, _password text, _full_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                         raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
                         email_change, email_change_token_new, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', lower(_email),
          extensions.crypt(_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', _full_name),
          '', '', '', '', now(), now());
  insert into auth.identities(id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', lower(_email), 'email_verified', true),
          'email', uid::text, now(), now(), now());
  return uid;
end $$;
revoke all on function private.create_auth_user(text, text, text) from public, anon, authenticated;

create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cities%rowtype;
  sfx text := substr(md5(gen_random_uuid()::text), 1, 6);
  pwd text := 'Teste-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)) || '!';
  u_l1 uuid; u_l2 uuid; u_ent uuid; u_c1 uuid; u_c2 uuid;
  b1 uuid; b2 uuid; cat uuid; mc uuid; p uuid; g uuid;
  logins jsonb;
  run uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  select * into c from public.cities where id = _city and is_active;
  if not found then raise exception 'Cidade não encontrada ou inativa.' using errcode = 'P0001'; end if;

  u_l1 := private.create_auth_user('lojista1-' || sfx || '@teste.example.com', pwd, 'Lojista Teste 1');
  u_l2 := private.create_auth_user('lojista2-' || sfx || '@teste.example.com', pwd, 'Lojista Teste 2');
  u_ent := private.create_auth_user('entregador-' || sfx || '@teste.example.com', pwd, 'Entregador Teste');
  u_c1 := private.create_auth_user('cliente1-' || sfx || '@teste.example.com', pwd, 'Cliente Teste 1');
  u_c2 := private.create_auth_user('cliente2-' || sfx || '@teste.example.com', pwd, 'Cliente Teste 2');
  update public.profiles set phone = '(35) 99999-0000' where id in (u_c1, u_c2, u_l1, u_l2, u_ent);

  -- estabelecimento 1: restaurante com entregador parceiro e retirada
  select id into cat from public.categories where kind = 'restaurante' and not is_demo order by sort_order limit 1;
  insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                delivery_offer, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
  values ('[Teste] Lanchonete do Tuca', private.unique_business_slug('teste lanchonete ' || sfx), u_l1, 'active', 'restaurante', cat, c.id,
          'Estabelecimento de TESTE criado pelo Painel Master para validar pedidos com entregador parceiro.',
          'Rua de Teste, 100 - Centro', '(35) 99999-0001', '(35) 99999-0001', 'partner', true, 1000, 30, 45)
  returning id into b1;
  insert into public.business_members(business_id, user_id, member_role) values (b1, u_l1, 'owner') on conflict do nothing;

  insert into public.menu_categories(business_id, name, sort_order) values (b1, 'Lanches', 10) returning id into mc;
  insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
  values (b1, mc, 'X-Burger', 'Pão, hambúrguer, queijo e molho da casa.', 2500, 10) returning id into p;
  insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
  values (b1, p, 'Ponto da carne', 1, 1, 10) returning id into g;
  insert into public.options(business_id, group_id, name, sort_order) values (b1, g, 'Ao ponto', 10), (b1, g, 'Bem passado', 20);
  insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
  values (b1, p, 'Adicionais', 0, 2, 20) returning id into g;
  insert into public.options(business_id, group_id, name, price_delta_cents, sort_order) values (b1, g, 'Bacon', 500, 10), (b1, g, 'Ovo', 300, 20);
  insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
  values (b1, mc, 'X-Salada', 'Hambúrguer, queijo, alface e tomate.', 2800, 20);
  insert into public.menu_categories(business_id, name, sort_order) values (b1, 'Bebidas', 20) returning id into mc;
  insert into public.products(business_id, category_id, name, price_cents, sort_order)
  values (b1, mc, 'Refrigerante lata', 600, 10), (b1, mc, 'Suco natural 500 ml', 900, 20);

  -- estabelecimento 2: loja com entrega própria e retirada
  select id into cat from public.categories where kind = 'loja' and not is_demo order by sort_order limit 1;
  insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                delivery_offer, own_delivery_fee_cents, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
  values ('[Teste] Mercadinho Teste', private.unique_business_slug('teste mercadinho ' || sfx), u_l2, 'active', 'loja', cat, c.id,
          'Estabelecimento de TESTE criado pelo Painel Master para validar pedidos com entrega própria.',
          'Avenida de Teste, 200 - Centro', '(35) 99999-0002', '(35) 99999-0002', 'own', 500, true, 0, 40, 60)
  returning id into b2;
  insert into public.business_members(business_id, user_id, member_role) values (b2, u_l2, 'owner') on conflict do nothing;
  insert into public.menu_categories(business_id, name, sort_order) values (b2, 'Mercearia', 10) returning id into mc;
  insert into public.products(business_id, category_id, name, price_cents, sort_order)
  values (b2, mc, 'Arroz 5 kg', 2990, 10), (b2, mc, 'Feijão 1 kg', 899, 20), (b2, mc, 'Café 500 g', 1690, 30);
  insert into public.menu_categories(business_id, name, sort_order) values (b2, 'Hortifrúti', 20) returning id into mc;
  insert into public.products(business_id, category_id, name, price_cents, sort_order) values (b2, mc, 'Banana (dúzia)', 700, 10);

  -- abertos todos os dias, o dia inteiro, para testar a qualquer hora
  insert into public.business_hours(business_id, weekday, opens, closes)
  select b, d, '00:00', '24:00' from unnest(array[b1, b2]) b, generate_series(0, 6) d;

  -- entregador aprovado na cidade
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category, status,
                              terms_version, terms_accepted_at, reviewed_by, reviewed_at, review_note)
  values (u_ent, 'Entregador Teste', '(35) 99999-0003', c.id, 'moto', 'TST1A23', 'A', 'approved',
          'teste', now(), auth.uid(), now(), 'Cadastro de teste gerado pelo Painel Master.');
  insert into public.user_roles(user_id, role, granted_by) values (u_ent, 'courier_partner', auth.uid()) on conflict do nothing;

  -- vaga
  insert into public.jobs(business_id, city_id, title, area, description, employment_type, created_by)
  values (b1, c.id, '[Teste] Atendente', 'atendimento', 'Vaga de TESTE para validar candidaturas: atendimento ao público no balcão.', 'clt', u_l1);

  logins := jsonb_build_array(
    jsonb_build_object('role', 'lojista', 'label', 'Lojista — [Teste] Lanchonete do Tuca (entregador parceiro)', 'email', 'lojista1-' || sfx || '@teste.example.com'),
    jsonb_build_object('role', 'lojista', 'label', 'Lojista — [Teste] Mercadinho Teste (entrega própria)', 'email', 'lojista2-' || sfx || '@teste.example.com'),
    jsonb_build_object('role', 'entregador', 'label', 'Entregador aprovado', 'email', 'entregador-' || sfx || '@teste.example.com'),
    jsonb_build_object('role', 'cliente', 'label', 'Cliente 1', 'email', 'cliente1-' || sfx || '@teste.example.com'),
    jsonb_build_object('role', 'cliente', 'label', 'Cliente 2', 'email', 'cliente2-' || sfx || '@teste.example.com'));

  insert into private.test_data_runs(city_id, created_by, user_ids, business_ids, logins)
  values (c.id, auth.uid(), array[u_l1, u_l2, u_ent, u_c1, u_c2], array[b1, b2], logins)
  returning id into run;
  perform private.audit('test_data.create', 'test_data_runs', run::text, jsonb_build_object('city', c.id));
  return jsonb_build_object('run_id', run, 'city', c.name || ' - ' || c.state, 'password', pwd, 'logins', logins);
end $$;

create or replace function public.admin_list_test_data()
returns table (run_id uuid, city_name text, created_at timestamptz, logins jsonb, businesses bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select r.id, c.name || ' - ' || c.state, r.created_at, r.logins,
           (select count(*) from public.businesses b where b.id = any(r.business_ids))
      from private.test_data_runs r left join public.cities c on c.id = r.city_id
     where r.removed_at is null
     order by r.created_at desc;
end $$;

create or replace function public.admin_remove_test_data(_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r private.test_data_runs%rowtype; u uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  select * into r from private.test_data_runs where id = _run and removed_at is null for update;
  if not found then raise exception 'Lote de teste não encontrado.' using errcode = 'P0001'; end if;
  perform set_config('tucai.internal', 'on', true);
  delete from public.orders where business_id = any(r.business_ids) or customer_id = any(r.user_ids);
  delete from public.businesses where id = any(r.business_ids);
  delete from public.couriers where user_id = any(r.user_ids);
  foreach u in array r.user_ids loop
    begin
      delete from auth.users where id = u;
    exception when foreign_key_violation then
      -- conta citada em registros que devem ser preservados (ex.: auditoria): bloqueia e anonimiza
      perform private.anonymize_user(u);
      update auth.users set banned_until = 'infinity', email = 'removido-' || u::text || '@teste.example.com' where id = u;
    end;
  end loop;
  update private.test_data_runs set removed_at = now() where id = r.id;
  perform private.audit('test_data.remove', 'test_data_runs', r.id::text, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_create_test_data(uuid)', 'public.admin_list_test_data()', 'public.admin_remove_test_data(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0015', '0015_test_data.sql', 'applied');
    raise notice 'Tucaí 0015: aplicada agora';
  end if;
end $tucai_0015$;

-- ===================== supabase/migrations/0016_usernames.sql =====================
do $tucai_0016$
begin
  if exists (select 1 from private.tucai_migrations where version = '0016') then
    raise notice 'Tucaí 0016: já aplicada';
  else
    execute $tucai_sql$
-- 0016_usernames: login com e-mail OU nome de usuário.
--  * profiles.username: opcional, único, sem diferenciar maiúsculas (guardado em minúsculas).
--    É só para entrar na conta; não é exibido publicamente (o @ do Conectuaí é outro campo).
--  * resolve_login(usuário, senha): devolve o e-mail da conta SOMENTE se a senha conferir.
--    Assim ninguém descobre o e-mail de outra pessoa testando nomes de usuário.
--    Tentativas limitadas por nome de usuário; a senha continua sendo conferida de novo pelo Supabase Auth.
--  * Nomes reservados (admin, suporte...) não podem ser escolhidos pelo app; só via SQL.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('account.username', 20, 3600);

alter table public.profiles add column username text check (username is null or username ~ '^[a-z0-9._]{3,30}$');
create unique index profiles_username_idx on public.profiles(username);

create or replace function private.username_reserved(_u text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(_u) = any(array['admin', 'administrador', 'administracao', 'root', 'suporte', 'ajuda', 'tucai', 'equipe',
                               'master', 'sistema', 'moderacao', 'moderador', 'contato', 'seguranca'])
$$;
revoke all on function private.username_reserved(text) from public, anon, authenticated;

create or replace function public.resolve_login(_username text, _password text) returns text
language plpgsql security definer set search_path = '' as $$
declare u text := lower(btrim(coalesce(_username, ''))); mail text; hash text;
begin
  if u !~ '^[a-z0-9._]{3,30}$' or coalesce(_password, '') = '' then return null; end if;
  perform private.rate_limit('login.username:' || u, 10, 900);
  select au.email, au.encrypted_password into mail, hash
    from public.profiles p join auth.users au on au.id = p.id
   where p.username = u and (au.banned_until is null or au.banned_until < now());
  if hash is null then
    perform extensions.crypt(_password, extensions.gen_salt('bf'));  -- mesmo custo com ou sem conta
    return null;
  end if;
  if hash = extensions.crypt(_password, hash) then return mail; end if;
  return null;
end $$;

-- disponibilidade (não revela e-mail nem nada da conta)
create or replace function public.username_available(_username text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare u text := lower(btrim(coalesce(_username, '')));
begin
  if u !~ '^[a-z0-9._]{3,30}$' or private.username_reserved(u) then return false; end if;
  return not exists (select 1 from public.profiles where username = u);
end $$;

create or replace function public.set_my_username(_username text) returns text
language plpgsql security definer set search_path = '' as $$
declare u text := nullif(lower(btrim(coalesce(_username, ''))), '');
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('account.username');
  if u is not null and u !~ '^[a-z0-9._]{3,30}$' then
    raise exception 'Use de 3 a 30 letras minúsculas, números, ponto ou sublinhado.' using errcode = 'P0001';
  end if;
  if u is not null and private.username_reserved(u) then raise exception 'Este nome de usuário é reservado.' using errcode = 'P0001'; end if;
  update public.profiles set username = u where id = auth.uid();
  return u;
exception when unique_violation then
  raise exception 'Este nome de usuário já está em uso.' using errcode = 'P0001';
end $$;

-- cadastro: aproveita o nome de usuário informado, se válido e livre (nunca impede a criação da conta)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u text := lower(btrim(coalesce(new.raw_user_meta_data->>'username', '')));
begin
  insert into public.profiles(id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120));
  insert into public.user_roles(user_id, role) values (new.id, 'customer');
  if u ~ '^[a-z0-9._]{3,30}$' and not private.username_reserved(u) then
    begin
      update public.profiles set username = u where id = new.id;
    exception when unique_violation then null;
    end;
  end if;
  return new;
end $$;

do $$
declare f text;
begin
  revoke all on function public.handle_new_user() from public, anon, authenticated;
  foreach f in array array['public.resolve_login(text, text)', 'public.username_available(text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  revoke all on function public.set_my_username(text) from public, anon;
  grant execute on function public.set_my_username(text) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0016', '0016_usernames.sql', 'applied');
    raise notice 'Tucaí 0016: aplicada agora';
  end if;
end $tucai_0016$;

-- ===================== supabase/migrations/0017_seo.sql =====================
do $tucai_0017$
begin
  if exists (select 1 from private.tucai_migrations where version = '0017') then
    raise notice 'Tucaí 0017: já aplicada';
  else
    execute $tucai_sql$
-- 0017_seo: dados públicos, só leitura, para títulos por página e sitemap.xml.
--  * Só estabelecimentos ativos e reais: fora demonstração (is_demo) e dados de teste do Painel Master.
--  * Cidades só aparecem com operação real (ao menos 1 estabelecimento indexável ou vaga aberta).
--  * Nada privado: sem contatos, sem dados de pessoas, sem pedidos.
--  * lastmod = data real de atualização do registro.

create or replace function private.test_business_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select unnest(business_ids) from private.test_data_runs where removed_at is null
$$;
revoke all on function private.test_business_ids() from public, anon, authenticated;

-- estabelecimentos indexáveis (base de tudo)
create or replace function private.indexable_businesses()
returns table (id uuid, slug text, business_type public.business_type, name text, description text, city_id uuid, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id, b.slug, b.business_type, b.name, b.description, b.city_id, b.updated_at
    from public.businesses b
   where b.status = 'active' and not b.is_demo
     and b.id not in (select private.test_business_ids())
$$;
revoke all on function private.indexable_businesses() from public, anon, authenticated;

create or replace function public.seo_business(_slug text)
returns table (name text, business_type public.business_type, description text, city_name text, city_state text, city_slug text,
               updated_at timestamptz, indexable boolean, address_line text, phone text, logo_url text, cover_url text)
language sql stable security definer set search_path = '' as $$
  select b.name, b.business_type, b.description, c.name, c.state, c.slug, b.updated_at,
         b.id not in (select private.test_business_ids()), b.address_line, b.phone, b.logo_url, b.cover_url
    from public.businesses b left join public.cities c on c.id = b.city_id and c.is_active
   where b.slug = _slug and b.status = 'active' and not b.is_demo
$$;

create or replace function public.seo_city(_slug text)
returns table (name text, state text, slug text, restaurantes integer, lojas integer, servicos integer, vagas integer)
language sql stable security definer set search_path = '' as $$
  select c.name, c.state, c.slug,
         (select count(*)::int from private.indexable_businesses() b where b.city_id = c.id and b.business_type = 'restaurante'),
         (select count(*)::int from private.indexable_businesses() b where b.city_id = c.id and b.business_type = 'loja'),
         (select count(*)::int from private.indexable_businesses() b where b.city_id = c.id and b.business_type = 'servico'),
         (select count(*)::int from public.jobs j join private.indexable_businesses() b on b.id = j.business_id
           where j.city_id = c.id and j.status = 'open' and j.expires_at > now())
    from public.cities c
   where c.slug = _slug and c.is_active
$$;

create or replace function public.seo_job(_id uuid)
returns table (title text, business_name text, city_name text, city_state text, indexable boolean,
               description text, employment_type public.job_employment, work_mode public.job_work_mode,
               salary_min_cents integer, salary_max_cents integer, created_at timestamptz, expires_at timestamptz,
               business_slug text, business_type public.business_type, address_line text)
language sql stable security definer set search_path = '' as $$
  select j.title, b.name, c.name, c.state, true, j.description, j.employment_type, j.work_mode,
         j.salary_min_cents, j.salary_max_cents, j.created_at, j.expires_at, b.slug, b.business_type, bb.address_line
    from public.jobs j
    join private.indexable_businesses() b on b.id = j.business_id
    join public.businesses bb on bb.id = b.id
    left join public.cities c on c.id = j.city_id
   where j.id = _id and j.status = 'open' and j.expires_at > now()
$$;

-- todas as URLs indexáveis com conteúdo real
create or replace function public.sitemap_entries()
returns table (path text, lastmod timestamptz)
language sql stable security definer set search_path = '' as $$
  with b as (select * from private.indexable_businesses()),
       j as (select j.id, j.city_id, coalesce(j.updated_at, j.created_at) as updated_at
               from public.jobs j join b on b.id = j.business_id
              where j.status = 'open' and j.expires_at > now()),
       sec as (select case b.business_type when 'restaurante' then 'restaurantes' when 'loja' then 'lojas' else 'servicos' end as section,
                      b.slug, b.city_id, b.updated_at from b),
       cities as (select c.id, c.slug from public.cities c where c.is_active
                   and (exists (select 1 from b where b.city_id = c.id) or exists (select 1 from j where j.city_id = c.id)))
  select '/' || s.section || '/' || s.slug, s.updated_at from sec s
  union all
  select '/' || s.section, max(s.updated_at) from sec s group by s.section
  union all
  select '/vagas/' || j.id, j.updated_at from j
  union all
  select '/vagas', max(j.updated_at) from j having count(*) > 0
  union all
  select '/cidades/' || c.slug,
         greatest((select max(updated_at) from b where b.city_id = c.id), (select max(updated_at) from j where j.city_id = c.id))
    from cities c
  union all
  select '/cidades/' || c.slug || '/' || s.section, max(s.updated_at) from cities c join sec s on s.city_id = c.id group by c.slug, s.section
  union all
  select '/cidades/' || c.slug || '/vagas', max(j.updated_at) from cities c join j on j.city_id = c.id group by c.slug
$$;

do $$
declare f text;
begin
  foreach f in array array['public.seo_business(text)', 'public.seo_city(text)', 'public.seo_job(uuid)', 'public.sitemap_entries()'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0017', '0017_seo.sql', 'applied');
    raise notice 'Tucaí 0017: aplicada agora';
  end if;
end $tucai_0017$;

-- ===================== supabase/migrations/0018_finance.sql =====================
do $tucai_0018$
begin
  if exists (select 1 from private.tucai_migrations where version = '0018') then
    raise notice 'Tucaí 0018: já aplicada';
  else
    execute $tucai_sql$
-- 0018_finance: financeiro do Painel Master (controle manual: não há cobrança online contratada).
--  * Planos aprovados (REGRAS_COMERCIAIS.md): Delivery R$ 79/mês; Presencial + Delivery R$ 99/mês.
--  * Assinatura por estabelecimento: plano, valor contratado (snapshot), início e vencimento.
--  * Cobranças (mensalidade, comissão dos pedidos ou outra): abertas, pagas ou canceladas.
--    "Recebido" = cobranças pagas; "a receber" = abertas; "vencido" = abertas com vencimento passado.
--  * Comissão e taxas da plataforma vêm dos pedidos concluídos (valores gravados no pedido).
--  * Ler: permissão finance.view (Master tem todas). Alterar: só Master. Tudo auditado.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.finance', 200, 600);

create table public.plans (
  code text primary key check (code ~ '^[a-z_]{3,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  price_cents integer not null check (price_cents > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0
);
insert into public.plans(code, name, price_cents, sort_order) values
  ('delivery', 'Delivery', 7900, 10),
  ('presencial_delivery', 'Presencial + Delivery', 9900, 20);

create type public.subscription_status as enum ('active', 'canceled');
create type public.charge_kind as enum ('plano', 'comissao', 'outro');
create type public.charge_status as enum ('aberta', 'paga', 'cancelada');

create table public.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan_code text not null references public.plans(code),
  price_cents integer not null check (price_cents >= 0),
  status public.subscription_status not null default 'active',
  started_on date not null default current_date,
  current_period_end date not null,
  notes text check (notes is null or char_length(notes) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end >= started_on)
);
-- uma assinatura ativa por estabelecimento
create unique index business_subscriptions_active_idx on public.business_subscriptions(business_id) where status = 'active';
create index business_subscriptions_business_idx on public.business_subscriptions(business_id);
create index business_subscriptions_plan_idx on public.business_subscriptions(plan_code);
create index business_subscriptions_created_by_idx on public.business_subscriptions(created_by);
create trigger business_subscriptions_updated before update on public.business_subscriptions for each row execute function public.set_updated_at();

create table public.platform_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subscription_id uuid references public.business_subscriptions(id) on delete set null,
  kind public.charge_kind not null,
  description text not null check (char_length(description) between 2 and 200),
  amount_cents integer not null check (amount_cents > 0),
  due_on date not null,
  -- mês de referência da comissão (evita cobrar o mesmo mês duas vezes)
  reference_month date check (reference_month is null or reference_month = date_trunc('month', reference_month)::date),
  status public.charge_status not null default 'aberta',
  paid_at timestamptz,
  paid_method text check (paid_method is null or paid_method in ('pix', 'dinheiro', 'cartao', 'boleto', 'transferencia', 'outro')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paga') = (paid_at is not null))
);
create unique index platform_charges_commission_month_idx on public.platform_charges(business_id, reference_month) where kind = 'comissao' and status <> 'cancelada';
create index platform_charges_business_idx on public.platform_charges(business_id, status);
create index platform_charges_subscription_idx on public.platform_charges(subscription_id);
create index platform_charges_created_by_idx on public.platform_charges(created_by);
create index platform_charges_status_due_idx on public.platform_charges(status, due_on);
create trigger platform_charges_updated before update on public.platform_charges for each row execute function public.set_updated_at();

alter table public.plans enable row level security;
alter table public.business_subscriptions enable row level security;
alter table public.platform_charges enable row level security;
-- planos: catálogo público (aparece na contratação); demais só pelas funções
create policy plans_select on public.plans for select to anon, authenticated using (is_active);
revoke all on public.plans, public.business_subscriptions, public.platform_charges from public, anon, authenticated;
grant select on public.plans to anon, authenticated;
-- o estabelecimento vê o próprio plano e as próprias cobranças
create policy business_subscriptions_member on public.business_subscriptions for select to authenticated
  using (public.has_business_permission(business_id, 'settings.manage') or public.has_business_permission(business_id, 'reports.view'));
create policy platform_charges_member on public.platform_charges for select to authenticated
  using (public.has_business_permission(business_id, 'settings.manage') or public.has_business_permission(business_id, 'reports.view'));
grant select on public.business_subscriptions, public.platform_charges to authenticated;

-- comissão + taxas de plataforma dos pedidos concluídos num período
create or replace function private.platform_fees(_business uuid, _from timestamptz, _to timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(o.commission_cents + o.platform_delivery_fee_cents), 0)::int
    from public.orders o
   where (_business is null or o.business_id = _business) and o.status in ('delivered', 'picked_up')
     and o.updated_at >= _from and o.updated_at < _to
$$;
revoke all on function private.platform_fees(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.admin_finance_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  perform private.require_permission('finance.view');
  return jsonb_build_object(
    'active_businesses', (select count(*) from public.businesses where status = 'active' and not is_demo),
    'active_subscriptions', (select count(*) from public.business_subscriptions s join public.businesses b on b.id = s.business_id where s.status = 'active' and b.status = 'active'),
    'mrr_cents', coalesce((select sum(s.price_cents) from public.business_subscriptions s join public.businesses b on b.id = s.business_id where s.status = 'active' and b.status = 'active'), 0),
    'received_month_cents', coalesce((select sum(amount_cents) from public.platform_charges where status = 'paga' and paid_at >= m), 0),
    'received_total_cents', coalesce((select sum(amount_cents) from public.platform_charges where status = 'paga'), 0),
    'open_cents', coalesce((select sum(amount_cents) from public.platform_charges where status = 'aberta'), 0),
    'overdue_cents', coalesce((select sum(amount_cents) from public.platform_charges where status = 'aberta' and due_on < current_date), 0),
    'fees_month_cents', private.platform_fees(null, m, now() + interval '1 second'),
    'due_soon', (select count(*) from public.business_subscriptions where status = 'active' and current_period_end <= current_date + 7)
  );
end $$;

create or replace function public.admin_finance_businesses()
returns table (business_id uuid, name text, slug text, business_type public.business_type, status public.business_status,
               city text, owner_name text, contact_phone text, whatsapp text,
               subscription_id uuid, plan_code text, plan_name text, price_cents integer, started_on date, current_period_end date,
               open_cents integer, overdue_cents integer, last_paid_at timestamptz, fees_month_cents integer)
language plpgsql stable security definer set search_path = '' as $$
declare m timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  perform private.require_permission('finance.view');
  return query
    select b.id, b.name, b.slug, b.business_type, b.status,
           case when c.id is null then null else c.name || ' - ' || c.state end,
           p.full_name, coalesce(b.phone, p.phone), coalesce(b.whatsapp, b.phone, p.phone),
           s.id, s.plan_code, pl.name, s.price_cents, s.started_on, s.current_period_end,
           coalesce((select sum(ch.amount_cents)::int from public.platform_charges ch where ch.business_id = b.id and ch.status = 'aberta'), 0),
           coalesce((select sum(ch.amount_cents)::int from public.platform_charges ch where ch.business_id = b.id and ch.status = 'aberta' and ch.due_on < current_date), 0),
           (select max(ch.paid_at) from public.platform_charges ch where ch.business_id = b.id and ch.status = 'paga'),
           private.platform_fees(b.id, m, now() + interval '1 second')
      from public.businesses b
      left join public.cities c on c.id = b.city_id
      left join public.profiles p on p.id = b.owner_id
      left join public.business_subscriptions s on s.business_id = b.id and s.status = 'active'
      left join public.plans pl on pl.code = s.plan_code
     where not b.is_demo and b.status in ('active', 'suspended')
     order by s.current_period_end nulls first, b.name;
end $$;

create or replace function public.admin_list_charges(_status public.charge_status default null, _business uuid default null)
returns table (id uuid, business_id uuid, business_name text, kind public.charge_kind, description text, amount_cents integer,
               due_on date, reference_month date, status public.charge_status, paid_at timestamptz, paid_method text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  return query
    select ch.id, ch.business_id, b.name, ch.kind, ch.description, ch.amount_cents, ch.due_on, ch.reference_month, ch.status,
           ch.paid_at, ch.paid_method, ch.created_at
      from public.platform_charges ch join public.businesses b on b.id = ch.business_id
     where (_status is null or ch.status = _status) and (_business is null or ch.business_id = _business)
     order by (ch.status = 'aberta') desc, ch.due_on, ch.created_at desc
     limit 300;
end $$;

-- definir/trocar plano (encerra o anterior)
create or replace function public.admin_set_subscription(_business uuid, _plan text, _started_on date, _period_end date, _price_cents integer default null, _notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pl public.plans%rowtype; sid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  select * into pl from public.plans where code = _plan and is_active;
  if not found then raise exception 'Plano inválido.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.businesses where id = _business and not is_demo) then raise exception 'Estabelecimento não encontrado.' using errcode = 'P0001'; end if;
  if _period_end < _started_on then raise exception 'O vencimento não pode ser antes do início.' using errcode = 'P0001'; end if;
  update public.business_subscriptions set status = 'canceled' where business_id = _business and status = 'active';
  insert into public.business_subscriptions(business_id, plan_code, price_cents, started_on, current_period_end, notes, created_by)
  values (_business, pl.code, coalesce(_price_cents, pl.price_cents), _started_on, _period_end, nullif(btrim(coalesce(_notes, '')), ''), auth.uid())
  returning id into sid;
  perform private.audit('finance.subscription', 'business_subscriptions', sid::text, jsonb_build_object('business', _business, 'plan', pl.code, 'until', _period_end));
  return sid;
end $$;

create or replace function public.admin_cancel_subscription(_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  update public.business_subscriptions set status = 'canceled' where business_id = _business and status = 'active';
  if not found then raise exception 'Sem plano ativo.' using errcode = 'P0001'; end if;
  perform private.audit('finance.subscription_cancel', 'businesses', _business::text, '{}'::jsonb);
end $$;

-- cobrança da mensalidade do próximo período (vence no fim do período atual)
create or replace function public.admin_charge_subscription(_business uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.business_subscriptions%rowtype; pl public.plans%rowtype; cid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  select * into s from public.business_subscriptions where business_id = _business and status = 'active';
  if not found then raise exception 'Defina o plano antes de cobrar.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.platform_charges where subscription_id = s.id and kind = 'plano' and status = 'aberta') then
    raise exception 'Já existe mensalidade em aberto para este plano.' using errcode = 'P0001';
  end if;
  select * into pl from public.plans where code = s.plan_code;
  insert into public.platform_charges(business_id, subscription_id, kind, description, amount_cents, due_on, created_by)
  values (_business, s.id, 'plano', 'Mensalidade ' || pl.name || ' até ' || to_char((s.current_period_end + interval '1 month')::date, 'DD/MM/YYYY'),
          s.price_cents, s.current_period_end, auth.uid())
  returning id into cid;
  perform private.audit('finance.charge', 'platform_charges', cid::text, jsonb_build_object('kind', 'plano'));
  return cid;
end $$;

-- comissão e taxas de plataforma de um mês fechado (pedidos concluídos)
create or replace function public.admin_charge_commission(_business uuid, _month date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ref date := date_trunc('month', _month)::date; f timestamptz; t timestamptz; total int; cid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  if ref >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Gere a comissão só de meses já encerrados.' using errcode = 'P0001';
  end if;
  f := ref::timestamp at time zone 'America/Sao_Paulo';
  t := (ref + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';
  total := private.platform_fees(_business, f, t);
  if total <= 0 then raise exception 'Sem comissão ou taxas neste mês.' using errcode = 'P0001'; end if;
  insert into public.platform_charges(business_id, kind, description, amount_cents, due_on, reference_month, created_by)
  values (_business, 'comissao', 'Comissão e taxas de ' || to_char(ref, 'MM/YYYY'), total, current_date + 7, ref, auth.uid())
  returning id into cid;
  perform private.audit('finance.charge', 'platform_charges', cid::text, jsonb_build_object('kind', 'comissao', 'month', ref));
  return cid;
exception when unique_violation then
  raise exception 'A comissão deste mês já foi gerada.' using errcode = 'P0001';
end $$;

create or replace function public.admin_create_charge(_business uuid, _description text, _amount_cents integer, _due_on date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  insert into public.platform_charges(business_id, kind, description, amount_cents, due_on, created_by)
  values (_business, 'outro', btrim(_description), _amount_cents, _due_on, auth.uid())
  returning id into cid;
  perform private.audit('finance.charge', 'platform_charges', cid::text, jsonb_build_object('kind', 'outro'));
  return cid;
end $$;

-- pagamento recebido: mensalidade paga renova o plano por 1 mês
create or replace function public.admin_mark_charge_paid(_charge uuid, _method text, _paid_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare ch public.platform_charges%rowtype;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  update public.platform_charges set status = 'paga', paid_at = coalesce(_paid_at, now()), paid_method = _method
   where id = _charge and status = 'aberta' returning * into ch;
  if not found then raise exception 'Cobrança não está em aberto.' using errcode = 'P0001'; end if;
  if ch.kind = 'plano' and ch.subscription_id is not null then
    update public.business_subscriptions set current_period_end = (current_period_end + interval '1 month')::date
     where id = ch.subscription_id and status = 'active';
  end if;
  perform private.audit('finance.paid', 'platform_charges', ch.id::text, jsonb_build_object('amount', ch.amount_cents, 'method', _method));
end $$;

create or replace function public.admin_cancel_charge(_charge uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  update public.platform_charges set status = 'cancelada' where id = _charge and status = 'aberta';
  if not found then raise exception 'Só cobranças em aberto podem ser canceladas.' using errcode = 'P0001'; end if;
  perform private.audit('finance.charge_cancel', 'platform_charges', _charge::text, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_finance_summary()', 'public.admin_finance_businesses()', 'public.admin_list_charges(public.charge_status, uuid)',
    'public.admin_set_subscription(uuid, text, date, date, integer, text)', 'public.admin_cancel_subscription(uuid)',
    'public.admin_charge_subscription(uuid)', 'public.admin_charge_commission(uuid, date)',
    'public.admin_create_charge(uuid, text, integer, date)', 'public.admin_mark_charge_paid(uuid, text, timestamptz)',
    'public.admin_cancel_charge(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0018', '0018_finance.sql', 'applied');
    raise notice 'Tucaí 0018: aplicada agora';
  end if;
end $tucai_0018$;

-- ===================== supabase/migrations/0019_payment_gateway.sql =====================
do $tucai_0019$
begin
  if exists (select 1 from private.tucai_migrations where version = '0019') then
    raise notice 'Tucaí 0019: já aplicada';
  else
    execute $tucai_sql$
-- 0019_payment_gateway: Mercado Pago para pagar mensalidades e cobranças da plataforma.
--  * Credenciais ficam em private.payment_gateway (schema privado: nenhum papel da API lê a tabela).
--    O Master grava pelo painel e só vê os 4 últimos dígitos do Access Token.
--  * O Worker (servidor) busca a configuração e confirma pagamentos com uma CHAVE DE INTEGRAÇÃO:
--    gerada pelo Master (mostrada uma vez), salva só como hash aqui e como segredo no Cloudflare.
--  * A confirmação só dá baixa se o valor bater com a cobrança; repetir a mesma confirmação não duplica.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('worker.payments', 600, 600), ('payments.checkout', 30, 600);

create table private.payment_gateway (
  id boolean primary key default true check (id),
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  public_key text check (public_key is null or (public_key ~ '^(TEST|APP_USR)-[A-Za-z0-9-]+$' and char_length(public_key) between 15 and 200)),
  access_token text check (access_token is null or (access_token ~ '^(TEST|APP_USR)-[A-Za-z0-9-]+$' and char_length(access_token) between 25 and 300)),
  webhook_secret text check (webhook_secret is null or char_length(webhook_secret) between 16 and 200),
  enabled boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table private.integration_keys (
  name text primary key check (name = 'payments'),
  key_hash text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
revoke all on private.payment_gateway, private.integration_keys from public, anon, authenticated;

alter table public.platform_charges
  add column provider text check (provider is null or provider = 'mercadopago'),
  add column provider_payment_id text;
create unique index platform_charges_provider_payment_idx on public.platform_charges(provider, provider_payment_id) where provider_payment_id is not null;

create or replace function private.integration_key_ok(_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(char_length(_key) >= 32, false) and exists (
    select 1 from private.integration_keys
     where name = 'payments' and key_hash = encode(extensions.digest(_key, 'sha256'), 'hex'))
$$;
revoke all on function private.integration_key_ok(text) from public, anon, authenticated;

-- ---------- painel ----------
create or replace function public.admin_payment_gateway_get()
returns table (provider text, mode text, public_key text, token_last4 text, token_set boolean, webhook_secret_set boolean,
               integration_key_set boolean, enabled boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  return query
    select 'mercadopago'::text,
           case when g.access_token like 'TEST-%' then 'teste' when g.access_token like 'APP_USR-%' then 'produção' else null end,
           g.public_key, right(g.access_token, 4), g.access_token is not null, g.webhook_secret is not null,
           exists (select 1 from private.integration_keys where name = 'payments'), coalesce(g.enabled, false), g.updated_at
      from (select true as k) one left join private.payment_gateway g on g.id;
end $$;

-- campos vazios/nulos mantêm o valor atual (o token nunca volta para a tela)
create or replace function public.admin_payment_gateway_set(_public_key text, _access_token text, _webhook_secret text, _enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare pk text := nullif(btrim(coalesce(_public_key, '')), ''); tk text := nullif(btrim(coalesce(_access_token, '')), '');
        ws text := nullif(btrim(coalesce(_webhook_secret, '')), ''); cur private.payment_gateway%rowtype;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  select * into cur from private.payment_gateway where id;
  if pk is not null and pk !~ '^(TEST|APP_USR)-' then raise exception 'Public Key inválida (começa com TEST- ou APP_USR-).' using errcode = 'P0001'; end if;
  if tk is not null and tk !~ '^(TEST|APP_USR)-' then raise exception 'Access Token inválido (começa com TEST- ou APP_USR-).' using errcode = 'P0001'; end if;
  if coalesce(pk, cur.public_key) is not null and coalesce(tk, cur.access_token) is not null
     and split_part(coalesce(pk, cur.public_key), '-', 1) <> split_part(coalesce(tk, cur.access_token), '-', 1) then
    raise exception 'Public Key e Access Token precisam ser do mesmo ambiente (os dois de teste ou os dois de produção).' using errcode = 'P0001';
  end if;
  if _enabled and coalesce(tk, cur.access_token) is null then raise exception 'Informe o Access Token antes de ativar.' using errcode = 'P0001'; end if;
  insert into private.payment_gateway as g (id, public_key, access_token, webhook_secret, enabled, updated_by, updated_at)
  values (true, pk, tk, ws, coalesce(_enabled, false), auth.uid(), now())
  on conflict (id) do update set
    public_key = coalesce(pk, g.public_key), access_token = coalesce(tk, g.access_token), webhook_secret = coalesce(ws, g.webhook_secret),
    enabled = coalesce(_enabled, g.enabled), updated_by = auth.uid(), updated_at = now();
  perform private.audit('payments.gateway', 'payment_gateway', 'mercadopago',
    jsonb_build_object('enabled', _enabled, 'token_changed', tk is not null, 'public_key_changed', pk is not null, 'webhook_secret_changed', ws is not null));
end $$;

-- nova chave de integração para o Worker (mostrada uma única vez; a anterior deixa de valer)
create or replace function public.admin_generate_integration_key() returns text
language plpgsql security definer set search_path = '' as $$
declare k text := 'tucai_pay_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform private.require_master();
  insert into private.integration_keys(name, key_hash, created_by) values ('payments', encode(extensions.digest(k, 'sha256'), 'hex'), auth.uid())
  on conflict (name) do update set key_hash = excluded.key_hash, created_by = auth.uid(), created_at = now();
  perform private.audit('payments.integration_key', 'integration_keys', 'payments', '{}'::jsonb);
  return k;
end $$;

-- ---------- quem pode pagar uma cobrança ----------
create or replace function public.payable_charge(_charge uuid)
returns table (id uuid, business_id uuid, business_name text, description text, amount_cents integer, kind public.charge_kind)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('payments.checkout');
  return query
    select ch.id, ch.business_id, b.name, ch.description, ch.amount_cents, ch.kind
      from public.platform_charges ch join public.businesses b on b.id = ch.business_id
     where ch.id = _charge and ch.status = 'aberta'
       and (public.has_business_permission(ch.business_id, 'settings.manage') or public.has_business_permission(ch.business_id, 'reports.view')
            or private.is_master_ok());
end $$;

-- ---------- Worker (chave de integração) ----------
create or replace function public.worker_payment_config(_key text)
returns table (access_token text, webhook_secret text, enabled boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.limit_for('worker.payments');
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select g.access_token, g.webhook_secret, g.enabled from private.payment_gateway g where g.id;
end $$;

create or replace function public.worker_confirm_payment(_key text, _charge uuid, _payment_id text, _amount_cents integer, _method text)
returns text language plpgsql security definer set search_path = '' as $$
declare ch public.platform_charges%rowtype;
begin
  perform private.limit_for('worker.payments');
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ch from public.platform_charges where id = _charge for update;
  if not found then return 'cobranca_inexistente'; end if;
  if ch.status = 'paga' then return case when ch.provider_payment_id = _payment_id then 'ja_confirmado' else 'ja_paga' end; end if;
  if ch.status <> 'aberta' then return 'cobranca_cancelada'; end if;
  if _amount_cents <> ch.amount_cents then return 'valor_diferente'; end if;
  update public.platform_charges set status = 'paga', paid_at = now(),
         paid_method = case when _method in ('pix', 'cartao', 'boleto') then _method else 'outro' end,
         provider = 'mercadopago', provider_payment_id = _payment_id
   where id = ch.id;
  if ch.kind = 'plano' and ch.subscription_id is not null then
    update public.business_subscriptions set current_period_end = (current_period_end + interval '1 month')::date
     where id = ch.subscription_id and status = 'active';
  end if;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'payments.confirmed', 'platform_charges', ch.id::text, jsonb_build_object('provider', 'mercadopago', 'payment_id', _payment_id, 'amount', _amount_cents));
  return 'confirmado';
exception when unique_violation then
  return 'pagamento_ja_usado';
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_payment_gateway_get()', 'public.admin_payment_gateway_set(text, text, text, boolean)',
                           'public.admin_generate_integration_key()', 'public.payable_charge(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- chamadas pelo Worker (sem sessão): protegidas pela chave de integração
  foreach f in array array['public.worker_payment_config(text)', 'public.worker_confirm_payment(text, uuid, text, integer, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0019', '0019_payment_gateway.sql', 'applied');
    raise notice 'Tucaí 0019: aplicada agora';
  end if;
end $tucai_0019$;

-- ===================== supabase/migrations/0020_finance_series.sql =====================
do $tucai_0020$
begin
  if exists (select 1 from private.tucai_migrations where version = '0020') then
    raise notice 'Tucaí 0020: já aplicada';
  else
    execute $tucai_sql$
-- 0020_finance_series: séries mensais para os gráficos do Financeiro (dados reais, sem estimativa).
--  * recebido: cobranças pagas no mês (pela data do pagamento)
--  * comissão e taxas: geradas pelos pedidos concluídos no mês
--  * novas assinaturas: planos iniciados no mês
-- Fuso de Brasília. Leitura com finance.view.

create or replace function public.admin_finance_series(_months integer default 12)
returns table (month date, received_cents integer, fees_cents integer, new_subscriptions integer)
language plpgsql stable security definer set search_path = '' as $$
declare n int := least(greatest(coalesce(_months, 12), 1), 36);
        first_month date := (date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => n - 1))::date;
begin
  perform private.require_permission('finance.view');
  return query
    with months as (select generate_series(first_month, date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, interval '1 month')::date as m)
    select ms.m,
           coalesce((select sum(ch.amount_cents)::int from public.platform_charges ch
                      where ch.status = 'paga' and date_trunc('month', ch.paid_at at time zone 'America/Sao_Paulo')::date = ms.m), 0),
           coalesce((select sum(o.commission_cents + o.platform_delivery_fee_cents)::int from public.orders o
                      where o.status in ('delivered', 'picked_up') and date_trunc('month', o.updated_at at time zone 'America/Sao_Paulo')::date = ms.m), 0),
           (select count(*)::int from public.business_subscriptions s where date_trunc('month', s.started_on)::date = ms.m)
      from months ms
     order by ms.m;
end $$;

create or replace function public.admin_finance_by_plan()
returns table (plan_code text, plan_name text, businesses integer, mrr_cents integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  return query
    select p.code, p.name,
           (select count(*)::int from public.business_subscriptions s join public.businesses b on b.id = s.business_id
             where s.plan_code = p.code and s.status = 'active' and b.status = 'active'),
           coalesce((select sum(s.price_cents)::int from public.business_subscriptions s join public.businesses b on b.id = s.business_id
             where s.plan_code = p.code and s.status = 'active' and b.status = 'active'), 0)
      from public.plans p
    union all
    select null, 'Sem plano',
           (select count(*)::int from public.businesses b
             where b.status = 'active' and not b.is_demo
               and not exists (select 1 from public.business_subscriptions s where s.business_id = b.id and s.status = 'active')),
           0;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_finance_series(integer)', 'public.admin_finance_by_plan()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0020', '0020_finance_series.sql', 'applied');
    raise notice 'Tucaí 0020: aplicada agora';
  end if;
end $tucai_0020$;

-- ===================== supabase/migrations/0021_admin_logins.sql =====================
do $tucai_0021$
begin
  if exists (select 1 from private.tucai_migrations where version = '0021') then
    raise notice 'Tucaí 0021: já aplicada';
  else
    execute $tucai_sql$
-- 0021_admin_logins: aba "Logins" do Painel Master (suporte às contas).
--  * Listar contas reais e de teste (busca por nome, usuário ou e-mail): permissão users.view.
--  * Suporte (support.manage ou Master): alterar nome, usuário e senha, bloquear/desbloquear.
--  * Contas da equipe (Master/operador) só podem ser alteradas por um Master; ninguém bloqueia a si mesmo.
--  * Toda alteração vai para a auditoria (sem registrar a senha).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.accounts', 120, 600);

create or replace function private.require_account_support(_user uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_platform_permission('support.manage') or private.is_master_ok()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_roles where user_id = _user and role in ('platform_master', 'platform_operator'))
     and _user <> auth.uid() and not private.is_master_ok() then
    raise exception 'Contas da equipe só podem ser alteradas por um Master.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = _user) then raise exception 'Conta não encontrada.' using errcode = 'P0001'; end if;
end $$;
revoke all on function private.require_account_support(uuid) from public, anon, authenticated;

create or replace function public.admin_list_accounts(_search text default null, _kind text default 'todos', _limit integer default 50, _offset integer default 0)
returns table (id uuid, email text, full_name text, username text, phone text, roles text[], is_test boolean, blocked boolean,
               created_at timestamptz, last_sign_in_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(lower(btrim(coalesce(_search, ''))), '');
begin
  perform private.require_permission('users.view');
  return query
    with base as (
      select u.id, u.email::text as email, p.full_name, p.username, p.phone,
             coalesce((select array_agg(r.role::text order by r.role::text) from public.user_roles r where r.user_id = u.id), '{}') as roles,
             exists (select 1 from private.test_data_runs t where t.removed_at is null and u.id = any(t.user_ids)) as is_test,
             coalesce(u.banned_until > now(), false) as blocked, u.created_at, u.last_sign_in_at
        from auth.users u left join public.profiles p on p.id = u.id
    ), filtered as (
      select * from base b
       where (q is null or lower(coalesce(b.email, '')) like '%' || q || '%' or lower(coalesce(b.full_name, '')) like '%' || q || '%'
              or lower(coalesce(b.username, '')) like '%' || q || '%')
         and (coalesce(_kind, 'todos') = 'todos' or (_kind = 'teste' and b.is_test) or (_kind = 'reais' and not b.is_test))
    )
    select f.*, count(*) over () from filtered f
     order by f.created_at desc nulls last
     limit least(greatest(coalesce(_limit, 50), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

create or replace function public.admin_set_account_name(_user uuid, _name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if char_length(btrim(coalesce(_name, ''))) not between 2 and 120 then raise exception 'Nome de 2 a 120 caracteres.' using errcode = 'P0001'; end if;
  update public.profiles set full_name = btrim(_name) where id = _user;
  perform private.audit('accounts.name', 'profiles', _user::text, '{}'::jsonb);
end $$;

create or replace function public.admin_set_account_username(_user uuid, _username text) returns text
language plpgsql security definer set search_path = '' as $$
declare u text := nullif(lower(btrim(coalesce(_username, ''))), '');
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if u is not null and u !~ '^[a-z0-9._]{3,30}$' then raise exception 'Use de 3 a 30 letras minúsculas, números, ponto ou sublinhado.' using errcode = 'P0001'; end if;
  if u is not null and private.username_reserved(u) and not private.is_master_ok() then raise exception 'Nome de usuário reservado.' using errcode = 'P0001'; end if;
  update public.profiles set username = u where id = _user;
  perform private.audit('accounts.username', 'profiles', _user::text, jsonb_build_object('username', u));
  return u;
exception when unique_violation then
  raise exception 'Este nome de usuário já está em uso.' using errcode = 'P0001';
end $$;

create or replace function public.admin_set_account_password(_user uuid, _password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if char_length(coalesce(_password, '')) < 8 or _password !~ '[A-Za-z]' or _password !~ '[0-9]' then
    raise exception 'A senha precisa ter pelo menos 8 caracteres, com letras e números.' using errcode = 'P0001';
  end if;
  update auth.users set encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf')), updated_at = now() where id = _user;
  perform private.audit('accounts.password', 'auth.users', _user::text, '{}'::jsonb); -- a senha nunca é registrada
end $$;

create or replace function public.admin_set_account_blocked(_user uuid, _blocked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if _user = auth.uid() then raise exception 'Você não pode bloquear a própria conta.' using errcode = 'P0001'; end if;
  update auth.users set banned_until = case when _blocked then 'infinity'::timestamptz else null end, updated_at = now() where id = _user;
  perform private.audit(case when _blocked then 'accounts.block' else 'accounts.unblock' end, 'auth.users', _user::text, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_list_accounts(text, text, integer, integer)', 'public.admin_set_account_name(uuid, text)',
                           'public.admin_set_account_username(uuid, text)', 'public.admin_set_account_password(uuid, text)',
                           'public.admin_set_account_blocked(uuid, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0021', '0021_admin_logins.sql', 'applied');
    raise notice 'Tucaí 0021: aplicada agora';
  end if;
end $tucai_0021$;

-- ===================== supabase/migrations/0022_homologacao.sql =====================
do $tucai_0022$
begin
  if exists (select 1 from private.tucai_migrations where version = '0022') then
    raise notice 'Tucaí 0022: já aplicada';
  else
    execute $tucai_sql$
-- 0022_homologacao: operação ponta a ponta testável sem misturar teste e produção.
--  * Teste isolado: estabelecimentos e pedidos de teste ficam marcados (is_test). Só contas de teste e a
--    equipe da plataforma enxergam estabelecimentos de teste; conta de teste não compra em loja real,
--    cliente real não compra em loja de teste; entregador real nunca recebe oferta de teste (e vice-versa);
--    pedidos de teste ficam fora do financeiro da plataforma.
--  * Despacho: oferta com prazo, recusa pelo entregador, expiração com nova rodada (redistribuição),
--    alerta para o estabelecimento e a equipe quando ninguém aceita ou o entregador não coleta, aceite
--    atômico já existente (0012) agora também respeita teste/produção. Localização do entregador só
--    quando ele compartilha, e só enquanto está disponível.
--  * Cozinha: aceite com tempo estimado de preparo; o papel "cozinha" só move aceito → em preparo → pronto.
--  * Master: lista de pedidos com alertas operacionais, detalhe com itens, eventos, entrega e valores,
--    cancelamento com motivo e redistribuição da entrega (permissão orders.manage), tudo auditado.
--  * Contas de homologação para os 9 perfis, reaproveitando o lote existente da cidade (sem duplicar).
--  * Tempo real: pedidos e notificações publicados no Supabase Realtime (as regras RLS valem para o canal).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('delivery.decline', 120, 600), ('dispatch.tick', 600, 600), ('admin.orders', 600, 600),
  ('admin.orders.manage', 60, 600), ('courier.location', 600, 600)
on conflict (action) do nothing;

insert into public.platform_permissions(code, description, sort_order) values
  ('orders.manage', 'Tratar ocorrências de pedidos: cancelar e redistribuir entregas', 75)
on conflict (code) do nothing;

-- ---------- quem é conta de teste ----------
create or replace function private.is_test_user(_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select _user is not null and exists (
    select 1 from private.test_data_runs where removed_at is null and _user = any(user_ids))
$$;

-- usado pela view pública (precisa de EXECUTE para anon); só responde sobre quem está consultando
create or replace function public.viewer_sees_tests() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    private.is_test_user(auth.uid()) or public.has_role('platform_master') or public.has_role('platform_operator'))
$$;

-- ---------- marcação de teste ----------
alter table public.businesses add column if not exists is_test boolean not null default false;
update public.businesses set is_test = true where id in (select private.test_business_ids()) and not is_test;

create or replace function private.businesses_is_test_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.is_test) or (tg_op = 'UPDATE' and new.is_test is distinct from old.is_test) then
    if coalesce(current_setting('tucai.internal', true), '') <> 'on' then
      raise exception 'A marcação de teste é controlada pela plataforma.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists businesses_is_test_guard on public.businesses;
create trigger businesses_is_test_guard before insert or update of is_test on public.businesses
  for each row execute function private.businesses_is_test_guard();

-- busca pública: estabelecimentos de teste só para contas de teste e equipe
create or replace view public.public_businesses with (security_barrier = true) as
  select b.id, b.name, b.slug, b.status, b.business_type, b.category_id, b.city_id,
         b.description, b.cover_url, b.logo_url, b.address_line, b.phone, b.whatsapp,
         b.lat, b.lng, b.distance_estimate_km,
         b.delivery_offer, b.own_delivery_fee_cents, b.accepts_pickup,
         b.estimated_min_minutes, b.estimated_max_minutes, b.min_order_cents, b.price_tier,
         b.rating_avg, b.rating_count, b.popularity_score, b.is_featured,
         b.created_at,
         public.business_is_open(b.id) as is_open
    from public.businesses b
   where b.status = 'active' and not b.is_demo and (not b.is_test or public.viewer_sees_tests());

-- vagas de estabelecimentos de teste também ficam fora do público
create or replace function public.job_is_public(_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j join public.businesses b on b.id = j.business_id
                  where j.id = _job and j.status = 'open' and j.expires_at > now()
                    and public.is_active_business(j.business_id) and (not b.is_test or public.viewer_sees_tests()))
$$;

-- pedidos herdam a marcação; teste e produção não se cruzam
alter table public.orders
  add column if not exists is_test boolean not null default false,
  add column if not exists prep_minutes smallint check (prep_minutes is null or prep_minutes between 5 and 180),
  add column if not exists estimated_ready_at timestamptz;
update public.orders o set is_test = true from public.businesses b where b.id = o.business_id and b.is_test and not o.is_test;

create or replace function private.orders_test_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare biz_test boolean; cust_test boolean := private.is_test_user(new.customer_id);
begin
  select is_test into biz_test from public.businesses where id = new.business_id;
  if coalesce(biz_test, false) and not cust_test and not exists (
       select 1 from public.user_roles where user_id = new.customer_id and role in ('platform_master', 'platform_operator')) then
    raise exception 'Estabelecimento indisponível.' using errcode = 'P0001';
  end if;
  if cust_test and not coalesce(biz_test, false) then
    raise exception 'Contas de teste só fazem pedidos em estabelecimentos de teste.' using errcode = 'P0001';
  end if;
  new.is_test := coalesce(biz_test, false);
  return new;
end $$;
drop trigger if exists orders_test_guard on public.orders;
create trigger orders_test_guard before insert on public.orders for each row execute function private.orders_test_guard();

-- financeiro da plataforma ignora pedidos de teste
create or replace function private.platform_fees(_business uuid, _from timestamptz, _to timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(o.commission_cents + o.platform_delivery_fee_cents), 0)::int
    from public.orders o
   where (_business is null or o.business_id = _business) and o.status in ('delivered', 'picked_up') and not o.is_test
     and o.updated_at >= _from and o.updated_at < _to
$$;

create or replace function public.admin_finance_series(_months integer default 12)
returns table (month date, received_cents integer, fees_cents integer, new_subscriptions integer)
language plpgsql stable security definer set search_path = '' as $$
declare n int := least(greatest(coalesce(_months, 12), 1), 36);
        first_month date := (date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => n - 1))::date;
begin
  perform private.require_permission('finance.view');
  return query
    with months as (select generate_series(first_month, date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, interval '1 month')::date as m)
    select ms.m,
           coalesce((select sum(ch.amount_cents)::int from public.platform_charges ch
                      where ch.status = 'paga' and date_trunc('month', ch.paid_at at time zone 'America/Sao_Paulo')::date = ms.m), 0),
           coalesce((select sum(o.commission_cents + o.platform_delivery_fee_cents)::int from public.orders o
                      where o.status in ('delivered', 'picked_up') and not o.is_test
                        and date_trunc('month', o.updated_at at time zone 'America/Sao_Paulo')::date = ms.m), 0),
           (select count(*)::int from public.business_subscriptions s where date_trunc('month', s.started_on)::date = ms.m)
      from months ms
     order by ms.m;
end $$;

-- ---------- notificações operacionais ----------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply',
  'order_new', 'order_update', 'delivery_offer', 'job_application', 'job_update', 'ops_alert'));
alter table public.notifications drop constraint notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or link ~ '^/(conectuai|pedidos|painel|entregador|vagas|admin)/[A-Za-z0-9/_-]*$');

-- alerta para a equipe do estabelecimento e para a equipe da plataforma com orders.view
create or replace function private.notify_ops(_order uuid, _message text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; m uuid;
begin
  select * into o from public.orders where id = _order;
  if not found then return; end if;
  perform private.notify_order_staff(o, 'ops_alert', _message);
  for m in select distinct r.user_id from public.user_roles r
            where r.role = 'platform_master'
               or (r.role = 'platform_operator' and exists (
                     select 1 from public.platform_staff_permissions sp where sp.user_id = r.user_id and sp.permission = 'orders.view')) loop
    perform private.notify_link(m, 'ops_alert', null, '/admin/pedidos', _message);
  end loop;
end $$;

-- ---------- despacho ----------
create or replace function private.offer_window() returns interval language sql immutable as $$ select interval '5 minutes' $$;
create or replace function private.offer_max_rounds() returns integer language sql immutable as $$ select 3 $$;
create or replace function private.pickup_deadline() returns interval language sql immutable as $$ select interval '40 minutes' $$;

alter table public.deliveries
  add column if not exists is_test boolean not null default false,
  add column if not exists offer_round smallint not null default 1,
  add column if not exists offer_expires_at timestamptz,
  add column if not exists attention_reason text check (attention_reason is null or char_length(attention_reason) <= 200),
  add column if not exists attention_at timestamptz;
update public.deliveries d set is_test = o.is_test from public.orders o where o.id = d.order_id and d.is_test <> o.is_test;
update public.deliveries set offer_expires_at = offered_at + private.offer_window() where offer_expires_at is null;
create index if not exists deliveries_expiry_idx on public.deliveries(status, offer_expires_at);
-- equipe do estabelecimento acompanha rodada e alerta (o código de confirmação continua fora)
grant select (is_test, offer_round, offer_expires_at, attention_reason, attention_at) on public.deliveries to authenticated;

create table if not exists public.delivery_declines (
  order_id uuid not null references public.deliveries(order_id) on delete cascade,
  courier_id uuid not null references auth.users(id) on delete cascade,
  offer_round smallint not null,
  created_at timestamptz not null default now(),
  primary key (order_id, courier_id, offer_round)
);
create index if not exists delivery_declines_courier_idx on public.delivery_declines(courier_id);
alter table public.delivery_declines enable row level security;
revoke all on public.delivery_declines from public, anon, authenticated;

alter table public.couriers
  add column if not exists last_lat numeric(9, 6) check (last_lat is null or last_lat between -90 and 90),
  add column if not exists last_lng numeric(9, 6) check (last_lng is null or last_lng between -180 and 180),
  add column if not exists last_location_at timestamptz;

-- entregadores aptos: aprovados, disponíveis, da cidade, e do mesmo "mundo" (teste x produção)
create or replace function private.eligible_couriers(_city uuid, _is_test boolean) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.user_id from public.couriers c
   where c.status = 'approved' and c.is_online and c.city_id = _city and private.is_test_user(c.user_id) = _is_test
$$;

create or replace function private.offer_to_couriers(_order uuid, _message text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; cour uuid;
begin
  select * into d from public.deliveries where order_id = _order;
  for cour in select private.eligible_couriers(d.city_id, d.is_test) loop
    perform private.notify_link(cour, 'delivery_offer', null, '/entregador/ofertas', _message);
  end loop;
end $$;

create or replace function private.orders_delivery_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
  if new.fulfillment = 'delivery_partner' and new.status = 'ready' and old.status <> 'ready' then
    select city_id into c from public.businesses where id = new.business_id;
    insert into public.deliveries(order_id, business_id, city_id, courier_pay_cents, is_test, offer_expires_at)
    values (new.id, new.business_id, c, new.courier_pay_cents, new.is_test, now() + private.offer_window())
    on conflict (order_id) do nothing;
    perform private.offer_to_couriers(new.id, 'Nova entrega disponível perto de você.');
  elsif new.status in ('cancelled', 'rejected') and old.status <> new.status then
    update public.deliveries set status = 'cancelled' where order_id = new.id and status in ('offered', 'accepted', 'picked_up');
  end if;
  return null;
end $$;

-- varredura: expira ofertas (nova rodada para todos de novo), e alerta quando ninguém aceita ou não coleta
create or replace function private.sweep_deliveries() returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; n int := 0; code text;
begin
  for d in select * from public.deliveries where status = 'offered' and offer_expires_at < now() for update skip locked loop
    if d.offer_round < private.offer_max_rounds() then
      update public.deliveries set offer_round = offer_round + 1, offer_expires_at = now() + private.offer_window() where order_id = d.order_id;
      perform private.offer_to_couriers(d.order_id, 'Entrega ainda aguardando entregador perto de você.');
    elsif d.attention_reason is null then
      select o.code into code from public.orders o where o.id = d.order_id;
      update public.deliveries set attention_reason = 'Sem entregador após ' || private.offer_max_rounds() || ' rodadas de oferta', attention_at = now()
       where order_id = d.order_id;
      perform private.notify_ops(d.order_id, 'Pedido #' || code || ': nenhum entregador aceitou a entrega.');
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  for d in select * from public.deliveries
            where status = 'accepted' and accepted_at < now() - private.pickup_deadline() and attention_reason is null
            for update skip locked loop
    select o.code into code from public.orders o where o.id = d.order_id;
    update public.deliveries set attention_reason = 'Entregador não coletou em ' || extract(epoch from private.pickup_deadline())::int / 60 || ' min', attention_at = now()
     where order_id = d.order_id;
    perform private.notify_ops(d.order_id, 'Pedido #' || code || ': entregador ainda não coletou.');
    n := n + 1;
  end loop;
  return n;
end $$;

-- painéis chamam ao abrir/atualizar; com pg_cron a varredura também roda a cada minuto
create or replace function public.dispatch_tick() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('dispatch.tick');
  return private.sweep_deliveries();
end $$;

drop function if exists public.courier_list_offers();
create function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint, offer_expires_at timestamptz, offer_round smallint)
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); me_test boolean := private.is_test_user(c.user_id);
begin
  if not c.is_online then return; end if;
  perform private.sweep_deliveries();
  return query
    select d.order_id, b.name, b.address_line, d.courier_pay_cents, d.offered_at,
           nullif(btrim(split_part(o.delivery_address, ',', -1)), ''),
           (select count(*) from public.order_items i where i.order_id = o.id),
           d.offer_expires_at, d.offer_round
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      join public.businesses b on b.id = d.business_id
     where d.status = 'offered' and d.city_id = c.city_id and d.is_test = me_test
       and not exists (select 1 from public.delivery_declines x
                        where x.order_id = d.order_id and x.courier_id = c.user_id and x.offer_round = d.offer_round)
     order by d.offered_at;
end $$;

create or replace function public.courier_accept_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int;
begin
  perform private.limit_for('delivery.action');
  if not c.is_online then raise exception 'Fique disponível para aceitar entregas.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.deliveries where courier_id = c.user_id and status in ('accepted', 'picked_up')) then
    raise exception 'Conclua a entrega atual antes de aceitar outra.' using errcode = 'P0001';
  end if;
  -- aceite atômico: só um UPDATE condicional vence
  update public.deliveries set status = 'accepted', courier_id = c.user_id, accepted_at = now(), attention_reason = null, attention_at = null
   where order_id = _order and status = 'offered' and courier_id is null and city_id = c.city_id
     and is_test = private.is_test_user(c.user_id);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Esta entrega já foi aceita por outro entregador ou não está mais disponível.' using errcode = 'P0001'; end if;
  insert into public.order_events(order_id, status, actor_id, note)
  select _order, o.status, c.user_id, 'Entrega aceita pelo entregador parceiro' from public.orders o where o.id = _order;
  perform private.audit('delivery.accept', 'deliveries', _order::text, '{}'::jsonb);
end $$;

create or replace function public.courier_decline_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype; pending int;
begin
  perform private.limit_for('delivery.decline');
  select * into d from public.deliveries
   where order_id = _order and status = 'offered' and city_id = c.city_id and is_test = private.is_test_user(c.user_id) for update;
  if not found then raise exception 'Oferta não está mais disponível.' using errcode = 'P0001'; end if;
  insert into public.delivery_declines(order_id, courier_id, offer_round) values (_order, c.user_id, d.offer_round) on conflict do nothing;
  perform private.audit('delivery.decline', 'deliveries', _order::text, jsonb_build_object('round', d.offer_round));
  -- todos os aptos recusaram nesta rodada: encerra a rodada já (a varredura redistribui ou alerta)
  select count(*) into pending from private.eligible_couriers(d.city_id, d.is_test) e
   where not exists (select 1 from public.delivery_declines x where x.order_id = _order and x.courier_id = e and x.offer_round = d.offer_round);
  if pending = 0 then
    update public.deliveries set offer_expires_at = now() - interval '1 second' where order_id = _order;
    perform private.sweep_deliveries();
  end if;
end $$;

create or replace function public.courier_release_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype;
begin
  perform private.limit_for('delivery.action');
  select * into d from public.deliveries where order_id = _order and courier_id = c.user_id and status = 'accepted' for update;
  if not found then raise exception 'Só é possível liberar antes da coleta.' using errcode = 'P0001'; end if;
  update public.deliveries set status = 'offered', courier_id = null, accepted_at = null,
         offer_expires_at = now() + private.offer_window(), attention_reason = null, attention_at = null
   where order_id = _order;
  insert into public.delivery_declines(order_id, courier_id, offer_round) values (_order, c.user_id, d.offer_round) on conflict do nothing;
  insert into public.order_events(order_id, status, actor_id, note)
  select _order, o.status, c.user_id, 'Entregador liberou a entrega; oferta reaberta' from public.orders o where o.id = _order;
  perform private.offer_to_couriers(_order, 'Entrega disponível novamente perto de você.');
  perform private.audit('delivery.release', 'deliveries', _order::text, '{}'::jsonb);
end $$;

-- localização: só enquanto disponível; vista pela equipe da plataforma no detalhe do pedido
create or replace function public.courier_update_location(_lat numeric, _lng numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  perform private.limit_for('courier.location');
  if not c.is_online then raise exception 'Fique disponível para compartilhar a localização.' using errcode = 'P0001'; end if;
  if _lat is null or _lng is null or _lat not between -90 and 90 or _lng not between -180 and 180 then
    raise exception 'Localização inválida.' using errcode = 'P0001';
  end if;
  update public.couriers set last_lat = round(_lat, 6), last_lng = round(_lng, 6), last_location_at = now() where user_id = c.user_id;
end $$;

-- ao ficar indisponível, a última localização é apagada
create or replace function private.couriers_offline_clear() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_online and old.is_online then new.last_lat := null; new.last_lng := null; new.last_location_at := null; end if;
  return new;
end $$;
drop trigger if exists couriers_offline_clear on public.couriers;
create trigger couriers_offline_clear before update of is_online on public.couriers
  for each row execute function private.couriers_offline_clear();

-- ---------- estabelecimento: cozinha e tempo de preparo ----------
create or replace function private.kitchen_only(_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members where business_id = _business and user_id = auth.uid() and member_role = 'kitchen')
$$;

create or replace function public.update_order_status(_order uuid, _status public.order_status, _note text default null)
returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; staff boolean; kitchen boolean; ok boolean := false; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('order.status');
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  staff := public.has_business_permission(o.business_id, 'orders.update_status');
  kitchen := staff and private.kitchen_only(o.business_id);
  if not staff and o.customer_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;

  if kitchen then
    -- cozinha: só preparo
    ok := (o.status = 'accepted' and _status = 'preparing') or (o.status = 'preparing' and _status = 'ready');
  elsif staff then
    ok := (o.status = 'placed' and _status in ('accepted', 'rejected'))
       or (o.status = 'accepted' and _status = 'preparing')
       or (o.status = 'preparing' and _status = 'ready')
       or (o.status = 'ready' and o.fulfillment = 'delivery_own' and _status = 'out_for_delivery')
       or (o.status = 'ready' and o.fulfillment = 'pickup' and _status = 'picked_up')
       or (o.status = 'out_for_delivery' and o.fulfillment = 'delivery_own' and _status = 'delivered')
       or (o.status in ('accepted', 'preparing') and _status = 'cancelled')
       -- entrega parceira: depois de pronto só cancela se nenhum entregador coletou
       or (o.status = 'ready' and _status = 'cancelled' and not exists (
             select 1 from public.deliveries d where d.order_id = o.id and d.status in ('picked_up', 'delivered')));
  end if;
  if not ok and o.customer_id = auth.uid() then
    ok := o.status = 'placed' and _status = 'cancelled';
  end if;
  if not ok then raise exception 'Mudança de status não permitida (% → %).', o.status, _status using errcode = 'P0001'; end if;
  if _status = 'rejected' and note is null then raise exception 'Informe o motivo da recusa.' using errcode = 'P0001'; end if;
  if _status = 'cancelled' and staff and note is null then raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001'; end if;

  update public.orders set status = _status, rejection_reason = case when _status in ('rejected', 'cancelled') then note else rejection_reason end
   where id = o.id;
  insert into public.order_events(order_id, status, actor_id, note) values (o.id, _status, auth.uid(), note);
  if staff then
    perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id,
      'Pedido #' || o.code || ': ' || case _status
        when 'accepted' then 'aceito pelo estabelecimento.'
        when 'rejected' then 'recusado. ' || coalesce(note, '')
        when 'preparing' then 'em preparo.'
        when 'ready' then case when o.fulfillment = 'pickup' then 'pronto para retirada.' else 'pronto, aguardando entrega.' end
        when 'out_for_delivery' then 'saiu para entrega.'
        when 'delivered' then 'entregue. Bom apetite!'
        when 'picked_up' then 'retirado.'
        when 'cancelled' then 'cancelado pelo estabelecimento. ' || coalesce(note, '')
        else _status::text end);
  else
    perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' cancelado pelo cliente.');
  end if;
  return _status;
end $$;

create or replace function public.merchant_accept_order(_order uuid, _prep_minutes integer) returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  if _prep_minutes is null or _prep_minutes not between 5 and 180 then
    raise exception 'Informe o tempo de preparo entre 5 e 180 minutos.' using errcode = 'P0001';
  end if;
  select business_id into b from public.orders where id = _order;
  if b is null or not public.has_business_permission(b, 'orders.update_status') or private.kitchen_only(b) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.update_order_status(_order, 'accepted', 'Preparo estimado em ' || _prep_minutes || ' min');
  update public.orders set prep_minutes = _prep_minutes, estimated_ready_at = now() + make_interval(mins => _prep_minutes) where id = _order;
  return 'accepted';
end $$;

-- ---------- Master: acompanhamento e ocorrências ----------
create or replace function private.order_attention(o public.orders, d public.deliveries) returns text
language sql stable set search_path = '' as $$
  select case
    when o.status = 'placed' and o.created_at < now() - interval '10 minutes'
      then 'Aguardando aceite há ' || (extract(epoch from now() - o.created_at)::int / 60) || ' min'
    when d.order_id is not null and d.status in ('offered', 'accepted') and d.attention_reason is not null then d.attention_reason
    when o.status = 'ready' and o.fulfillment = 'pickup' and o.updated_at < now() - interval '60 minutes' then 'Pronto para retirada há mais de 1 h'
    when o.status in ('accepted', 'preparing') and o.estimated_ready_at < now() - interval '20 minutes' then 'Preparo atrasado'
  end
$$;

create or replace function public.admin_list_orders(_scope text default 'abertos', _search text default null, _include_test boolean default true,
                                                    _limit integer default 50, _offset integer default 0)
returns table (id uuid, code text, created_at timestamptz, status public.order_status, fulfillment public.order_fulfillment,
               payment_method public.order_payment, business_name text, city_name text, customer_name text, courier_name text,
               total_cents integer, commission_cents integer, platform_fee_cents integer, delivery_status public.delivery_status,
               attention text, is_test boolean, total bigint)
language plpgsql security definer set search_path = '' as $$
declare s text := nullif(btrim(coalesce(_search, '')), '');
begin
  perform private.require_permission('orders.view');
  perform private.limit_for('admin.orders');
  if coalesce(_scope, '') not in ('abertos', 'atencao', 'concluidos', 'cancelados', 'todos') then
    raise exception 'Filtro inválido.' using errcode = 'P0001';
  end if;
  perform private.sweep_deliveries();
  return query
    with base as (
      select o.id, o.code, o.created_at, o.status, o.fulfillment, o.payment_method, b.name as business_name,
             c.name || ' - ' || c.state as city_name, o.customer_name, cr.full_name as courier_name,
             o.total_cents, o.commission_cents, o.platform_delivery_fee_cents, d.status as delivery_status,
             private.order_attention(o, d) as attention, o.is_test
        from public.orders o
        join public.businesses b on b.id = o.business_id
        left join public.cities c on c.id = b.city_id
        left join public.deliveries d on d.order_id = o.id
        left join public.couriers cr on cr.user_id = d.courier_id
       where (_include_test or not o.is_test)
         and (s is null or o.code ilike s || '%' or b.name ilike '%' || s || '%' or o.customer_name ilike '%' || s || '%')
    )
    select x.*, count(*) over () from base x
     where case _scope
             when 'abertos' then x.status not in ('delivered', 'picked_up', 'rejected', 'cancelled')
             when 'atencao' then x.attention is not null and x.status not in ('delivered', 'picked_up', 'rejected', 'cancelled')
             when 'concluidos' then x.status in ('delivered', 'picked_up')
             when 'cancelados' then x.status in ('rejected', 'cancelled')
             else true end
     order by (x.attention is not null) desc, x.created_at desc
     limit least(greatest(coalesce(_limit, 50), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

create or replace function public.admin_order_detail(_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders%rowtype; d public.deliveries%rowtype; full_contact boolean;
begin
  perform private.require_permission('orders.view');
  select * into o from public.orders where id = _order;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  select * into d from public.deliveries where order_id = _order;
  full_contact := public.has_platform_permission('users.view');
  return jsonb_build_object(
    'id', o.id, 'code', o.code, 'status', o.status, 'fulfillment', o.fulfillment, 'payment_method', o.payment_method,
    'created_at', o.created_at, 'is_test', o.is_test, 'notes', o.notes, 'rejection_reason', o.rejection_reason,
    'prep_minutes', o.prep_minutes, 'estimated_ready_at', o.estimated_ready_at,
    'attention', private.order_attention(o, d),
    'customer', jsonb_build_object('name', o.customer_name,
        'phone', case when full_contact then o.customer_phone end,
        'address', case when full_contact then o.delivery_address end),
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'phone', b.phone, 'address', b.address_line,
                                           'city', c.name || ' - ' || c.state)
                   from public.businesses b left join public.cities c on c.id = b.city_id where b.id = o.business_id),
    'values', jsonb_build_object('subtotal_cents', o.subtotal_cents, 'delivery_fee_cents', o.delivery_fee_cents,
        'total_cents', o.total_cents, 'commission_cents', o.commission_cents,
        'merchant_delivery_cents', o.merchant_delivery_contribution_cents, 'courier_pay_cents', o.courier_pay_cents,
        'platform_fee_cents', o.platform_delivery_fee_cents, 'pricing_version', o.pricing_snapshot->'version'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents,
                                                           'line_total_cents', i.line_total_cents, 'options', i.options, 'notes', i.notes) order by i.name)
                         from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'note', e.note, 'at', e.created_at,
                                                            'actor', case
                                                              when e.actor_id is null then 'sistema'
                                                              when e.actor_id = o.customer_id then 'cliente'
                                                              when e.actor_id = d.courier_id then 'entregador'
                                                              when exists (select 1 from public.business_members bm where bm.business_id = o.business_id and bm.user_id = e.actor_id) then 'estabelecimento'
                                                              else 'equipe Tucaí' end) order by e.created_at, e.id)
                          from public.order_events e where e.order_id = o.id), '[]'::jsonb),
    'delivery', case when d.order_id is null then null else jsonb_build_object(
        'status', d.status, 'offer_round', d.offer_round, 'offer_expires_at', d.offer_expires_at, 'offered_at', d.offered_at,
        'accepted_at', d.accepted_at, 'picked_up_at', d.picked_up_at, 'delivered_at', d.delivered_at,
        'attention_reason', d.attention_reason, 'failed_code_attempts', d.failed_code_attempts,
        'declines', (select count(*) from public.delivery_declines x where x.order_id = d.order_id),
        'courier', (select jsonb_build_object('name', cr.full_name, 'phone', case when full_contact then cr.phone end, 'vehicle', cr.vehicle,
                                              'last_lat', cr.last_lat, 'last_lng', cr.last_lng, 'last_location_at', cr.last_location_at)
                      from public.couriers cr where cr.user_id = d.courier_id)) end
  );
end $$;

create or replace function public.admin_cancel_order(_order uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; r text := nullif(btrim(coalesce(_reason, '')), ''); cour uuid;
begin
  perform private.require_permission('orders.manage');
  perform private.limit_for('admin.orders.manage');
  if r is null or char_length(r) > 250 then raise exception 'Informe o motivo (até 250 caracteres).' using errcode = 'P0001'; end if;
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  if o.status in ('delivered', 'picked_up', 'rejected', 'cancelled') then
    raise exception 'Pedido já encerrado.' using errcode = 'P0001';
  end if;
  select courier_id into cour from public.deliveries where order_id = _order;
  update public.orders set status = 'cancelled', rejection_reason = 'Cancelado pela Tucaí: ' || r where id = _order;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'cancelled', auth.uid(), 'Cancelado pela Tucaí: ' || r);
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' cancelado pela Tucaí. ' || r);
  perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' cancelado pela Tucaí. ' || r);
  if cour is not null then
    perform private.notify_link(cour, 'order_update', null, '/entregador/entregas', 'Entrega do pedido #' || o.code || ' cancelada pela Tucaí.');
  end if;
  perform private.audit('orders.cancel', 'orders', _order::text, jsonb_build_object('reason', r, 'previous_status', o.status));
end $$;

create or replace function public.admin_redispatch(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; code text;
begin
  perform private.require_permission('orders.manage');
  perform private.limit_for('admin.orders.manage');
  select * into d from public.deliveries where order_id = _order for update;
  if not found or d.status not in ('offered', 'accepted') then
    raise exception 'Só é possível redistribuir entregas ainda não coletadas.' using errcode = 'P0001';
  end if;
  select o.code into code from public.orders o where o.id = _order;
  if d.status = 'accepted' then
    perform private.notify_link(d.courier_id, 'order_update', null, '/entregador/entregas', 'A entrega do pedido #' || code || ' foi redistribuída pela Tucaí.');
  end if;
  delete from public.delivery_declines where order_id = _order;
  update public.deliveries set status = 'offered', courier_id = null, accepted_at = null, offer_round = 1,
         offer_expires_at = now() + private.offer_window(), attention_reason = null, attention_at = null
   where order_id = _order;
  insert into public.order_events(order_id, status, actor_id, note)
  select _order, o.status, auth.uid(), 'Entrega redistribuída pela Tucaí' from public.orders o where o.id = _order;
  perform private.offer_to_couriers(_order, 'Nova entrega disponível perto de você.');
  perform private.audit('orders.redispatch', 'deliveries', _order::text, jsonb_build_object('previous_status', d.status, 'previous_courier', d.courier_id));
end $$;

-- ---------- contas de homologação (9 perfis), sem duplicar ----------
create or replace function private.test_login_key(l jsonb) returns text language sql immutable as $$
  select coalesce(l->>'key', case
    when l->>'role' = 'lojista' and l->>'label' like '%Lanchonete%' then 'restaurante'
    when l->>'role' = 'lojista' then 'lojista'
    when l->>'role' = 'entregador' then 'entregador'
    when l->>'label' = 'Cliente 2' then 'cliente2'
    when l->>'role' = 'cliente' then 'cliente1' end)
$$;

create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cities%rowtype;
  r private.test_data_runs%rowtype;
  reuse boolean := false;
  sfx text := substr(md5(gen_random_uuid()::text), 1, 6);
  pwd text := 'Teste-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)) || '!';
  have text[] := '{}';
  created jsonb := '[]'::jsonb;
  new_users uuid[] := '{}';
  new_biz uuid[] := '{}';
  b_rest uuid; b_loja uuid; b_serv uuid;
  u uuid; cat uuid; mc uuid; p uuid; g uuid; run uuid;
  k text;
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  select * into c from public.cities where id = _city and is_active;
  if not found then raise exception 'Cidade não encontrada ou inativa.' using errcode = 'P0001'; end if;

  select * into r from private.test_data_runs where city_id = c.id and removed_at is null order by created_at desc limit 1 for update;
  if found then
    reuse := true;
    select coalesce(array_agg(private.test_login_key(l)), '{}') into have from jsonb_array_elements(r.logins) l;
    select id into b_rest from public.businesses where id = any(r.business_ids) and business_type = 'restaurante' order by created_at limit 1;
    select id into b_loja from public.businesses where id = any(r.business_ids) and business_type = 'loja' order by created_at limit 1;
    select id into b_serv from public.businesses where id = any(r.business_ids) and business_type = 'servico' order by created_at limit 1;
  end if;

  foreach k in array array['restaurante', 'funcionario', 'cozinha', 'lojista', 'prestador', 'entregador', 'entregador2', 'cliente1', 'cliente2', 'operador'] loop
    continue when k = any(have);
    if k = 'restaurante' and b_rest is not null then continue; end if;
    if k = 'lojista' and b_loja is not null then continue; end if;
    if k = 'prestador' and b_serv is not null then continue; end if;
    if k in ('funcionario', 'cozinha') and b_rest is null then continue; end if;  -- criado logo abaixo, na ordem

    u := private.create_auth_user(k || '-' || sfx || '@teste.example.com', pwd, case k
      when 'restaurante' then 'Dono Restaurante Teste' when 'funcionario' then 'Funcionário Teste' when 'cozinha' then 'Cozinha Teste'
      when 'lojista' then 'Lojista Teste' when 'prestador' then 'Prestador Teste' when 'entregador' then 'Entregador Teste'
      when 'entregador2' then 'Entregador Teste Dois' when 'cliente1' then 'Cliente Teste Um' when 'cliente2' then 'Cliente Teste Dois'
      else 'Operador Teste' end);
    update public.profiles set phone = '(35) 99999-0000' where id = u;
    new_users := new_users || u;

    if k = 'restaurante' then
      select id into cat from public.categories where kind = 'restaurante' and not is_demo order by sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
      values ('[Teste] Lanchonete do Tuca', private.unique_business_slug('teste lanchonete ' || sfx), u, 'active', 'restaurante', cat, c.id,
              'Estabelecimento de HOMOLOGAÇÃO: pedidos de teste com entregador parceiro. Não aparece para clientes reais.',
              'Rua de Teste, 100 - Centro', '(35) 99999-0001', '(35) 99999-0001', 'partner', true, 1000, 30, 45)
      returning id into b_rest;
      insert into public.business_members(business_id, user_id, member_role) values (b_rest, u, 'owner') on conflict do nothing;
      insert into public.menu_categories(business_id, name, sort_order) values (b_rest, 'Lanches', 10) returning id into mc;
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b_rest, mc, 'X-Burger', 'Pão, hambúrguer, queijo e molho da casa.', 2500, 10) returning id into p;
      insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
      values (b_rest, p, 'Ponto da carne', 1, 1, 10) returning id into g;
      insert into public.options(business_id, group_id, name, sort_order) values (b_rest, g, 'Ao ponto', 10), (b_rest, g, 'Bem passado', 20);
      insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
      values (b_rest, p, 'Adicionais', 0, 2, 20) returning id into g;
      insert into public.options(business_id, group_id, name, price_delta_cents, sort_order) values (b_rest, g, 'Bacon', 500, 10), (b_rest, g, 'Ovo', 300, 20);
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b_rest, mc, 'X-Salada', 'Hambúrguer, queijo, alface e tomate.', 2800, 20);
      insert into public.menu_categories(business_id, name, sort_order) values (b_rest, 'Bebidas', 20) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order)
      values (b_rest, mc, 'Refrigerante lata', 600, 10), (b_rest, mc, 'Suco natural 500 ml', 900, 20);
      insert into public.business_hours(business_id, weekday, opens, closes) select b_rest, d, '00:00', '24:00' from generate_series(0, 6) d;
      insert into public.jobs(business_id, city_id, title, area, description, employment_type, created_by)
      values (b_rest, c.id, '[Teste] Atendente', 'atendimento', 'Vaga de TESTE para validar candidaturas: atendimento ao público no balcão.', 'clt', u);
      new_biz := new_biz || b_rest;
      created := created || jsonb_build_object('key', k, 'role', 'restaurante', 'label', 'Dono do restaurante — [Teste] Lanchonete do Tuca', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'funcionario' then
      insert into public.business_members(business_id, user_id, member_role) values (b_rest, u, 'attendant');
      created := created || jsonb_build_object('key', k, 'role', 'funcionario', 'label', 'Funcionário (atendente) do restaurante de teste', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'cozinha' then
      insert into public.business_members(business_id, user_id, member_role) values (b_rest, u, 'kitchen');
      created := created || jsonb_build_object('key', k, 'role', 'cozinha', 'label', 'Operador da cozinha do restaurante de teste', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'lojista' then
      select id into cat from public.categories where kind = 'loja' and not is_demo order by sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, own_delivery_fee_cents, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
      values ('[Teste] Mercadinho Teste', private.unique_business_slug('teste mercadinho ' || sfx), u, 'active', 'loja', cat, c.id,
              'Estabelecimento de HOMOLOGAÇÃO: pedidos de teste com entrega própria. Não aparece para clientes reais.',
              'Avenida de Teste, 200 - Centro', '(35) 99999-0002', '(35) 99999-0002', 'own', 500, true, 0, 40, 60)
      returning id into b_loja;
      insert into public.business_members(business_id, user_id, member_role) values (b_loja, u, 'owner') on conflict do nothing;
      insert into public.menu_categories(business_id, name, sort_order) values (b_loja, 'Mercearia', 10) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order)
      values (b_loja, mc, 'Arroz 5 kg', 2990, 10), (b_loja, mc, 'Feijão 1 kg', 899, 20), (b_loja, mc, 'Café 500 g', 1690, 30);
      insert into public.business_hours(business_id, weekday, opens, closes) select b_loja, d, '00:00', '24:00' from generate_series(0, 6) d;
      new_biz := new_biz || b_loja;
      created := created || jsonb_build_object('key', k, 'role', 'lojista', 'label', 'Lojista — [Teste] Mercadinho Teste (entrega própria)', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'prestador' then
      select id into cat from public.categories where kind = 'servico' and not is_demo order by sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, accepts_pickup, min_order_cents)
      values ('[Teste] Serviços do Tuca', private.unique_business_slug('teste servicos ' || sfx), u, 'active', 'servico', cat, c.id,
              'Prestador de serviços de HOMOLOGAÇÃO. Não aparece para clientes reais.',
              'Rua de Teste, 300 - Centro', '(35) 99999-0004', '(35) 99999-0004', 'none', false, 0)
      returning id into b_serv;
      insert into public.business_members(business_id, user_id, member_role) values (b_serv, u, 'owner') on conflict do nothing;
      insert into public.services(business_id, name, category_id, city_id, description, phone, whatsapp)
      values (b_serv, '[Teste] Instalação elétrica residencial', cat, c.id, 'Serviço de teste para validar a vitrine de serviços.', '(35) 99999-0004', '(35) 99999-0004');
      new_biz := new_biz || b_serv;
      created := created || jsonb_build_object('key', k, 'role', 'prestador', 'label', 'Prestador de serviços — [Teste] Serviços do Tuca', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k in ('entregador', 'entregador2') then
      insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category, status,
                                  terms_version, terms_accepted_at, reviewed_by, reviewed_at, review_note)
      values (u, case k when 'entregador' then 'Entregador Teste' else 'Entregador Teste Dois' end, '(35) 99999-0003', c.id, 'moto',
              case k when 'entregador' then 'TST1A23' else 'TST2B34' end, 'A', 'approved',
              'teste', now(), auth.uid(), now(), 'Cadastro de teste gerado pelo Painel Master.');
      insert into public.user_roles(user_id, role, granted_by) values (u, 'courier_partner', auth.uid()) on conflict do nothing;
      created := created || jsonb_build_object('key', k, 'role', 'entregador', 'label', case k when 'entregador' then 'Entregador independente 1' else 'Entregador independente 2 (concorrência)' end,
                                               'email', k || '-' || sfx || '@teste.example.com');
    elsif k in ('cliente1', 'cliente2') then
      created := created || jsonb_build_object('key', k, 'role', 'cliente', 'label', case k when 'cliente1' then 'Cliente 1' else 'Cliente 2' end, 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'operador' then
      insert into public.user_roles(user_id, role, granted_by) values (u, 'platform_operator', auth.uid()) on conflict do nothing;
      insert into public.platform_staff_permissions(user_id, permission, granted_by)
      values (u, 'admin.dashboard', auth.uid()), (u, 'orders.view', auth.uid()), (u, 'users.view', auth.uid());
      created := created || jsonb_build_object('key', k, 'role', 'operador', 'label', 'Operador administrativo (painel, pedidos e usuários; exige MFA quando ativado)', 'email', k || '-' || sfx || '@teste.example.com');
    end if;
  end loop;

  if array_length(new_biz, 1) is not null then
    perform set_config('tucai.internal', 'on', true);
    update public.businesses set is_test = true where id = any(new_biz);
    perform set_config('tucai.internal', 'off', true);
  end if;

  if reuse then
    update private.test_data_runs set user_ids = user_ids || new_users, business_ids = business_ids || new_biz, logins = logins || created
     where id = r.id returning id into run;
  else
    insert into private.test_data_runs(city_id, created_by, user_ids, business_ids, logins)
    values (c.id, auth.uid(), new_users, new_biz, created) returning id into run;
  end if;
  perform private.audit('test_data.create', 'test_data_runs', run::text,
                        jsonb_build_object('city', c.id, 'reused', reuse, 'new_accounts', coalesce(array_length(new_users, 1), 0)));
  return jsonb_build_object('run_id', run, 'city', c.name || ' - ' || c.state, 'reused', reuse,
                            'password', case when array_length(new_users, 1) is null then null else pwd end, 'logins', created);
end $$;

-- ---------- tempo real ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;

-- varredura a cada minuto quando o pg_cron estiver habilitado no projeto
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tucai-dispatch-sweep', '* * * * *', 'select private.sweep_deliveries()');
  end if;
end $$;

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array[
    'private.is_test_user(uuid)', 'private.businesses_is_test_guard()', 'private.orders_test_guard()', 'private.notify_ops(uuid, text)',
    'private.eligible_couriers(uuid, boolean)', 'private.offer_to_couriers(uuid, text)', 'private.orders_delivery_sync()',
    'private.sweep_deliveries()', 'private.couriers_offline_clear()', 'private.kitchen_only(uuid)',
    'private.order_attention(public.orders, public.deliveries)', 'private.platform_fees(uuid, timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.viewer_sees_tests() from public;
  grant execute on function public.viewer_sees_tests() to anon, authenticated;
  foreach f in array array[
    'public.dispatch_tick()', 'public.courier_list_offers()', 'public.courier_accept_delivery(uuid)', 'public.courier_decline_delivery(uuid)',
    'public.courier_release_delivery(uuid)', 'public.courier_update_location(numeric, numeric)',
    'public.update_order_status(uuid, public.order_status, text)', 'public.merchant_accept_order(uuid, integer)',
    'public.admin_list_orders(text, text, boolean, integer, integer)', 'public.admin_order_detail(uuid)',
    'public.admin_cancel_order(uuid, text)', 'public.admin_redispatch(uuid)', 'public.admin_create_test_data(uuid)',
    'public.admin_finance_series(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0022', '0022_homologacao.sql', 'applied');
    raise notice 'Tucaí 0022: aplicada agora';
  end if;
end $tucai_0022$;

select version, name, how, applied_at from private.tucai_migrations order by version;
