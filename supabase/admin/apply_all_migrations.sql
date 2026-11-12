-- =====================================================================================
-- TUCAÍ — BANCO COMPLETO (migrations 0001 a 0033) PARA O SQL EDITOR DO SUPABASE
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

-- ===================== supabase/migrations/0023_painel_master.sql =====================
do $tucai_0023$
begin
  if exists (select 1 from private.tucai_migrations where version = '0023') then
    raise notice 'Tucaí 0023: já aplicada';
  else
    execute $tucai_sql$
-- 0023_painel_master: Painel Master operacional.
--  * Auditoria paginada no banco (20 por página) com filtros por data, ação e usuário.
--  * Entregadores: lista com "Todos" (antes abria só em "Pendentes" e escondia os aprovados), busca,
--    entregas reais, contas de teste e histórico por entregador.
--  * Estabelecimentos: página com filtros (cidade, status, categoria, tipo) e imagem para os cards.
--  * Contas: detalhe (papéis, vínculos, entregador, pedidos, auditoria da conta); recuperação de senha
--    por e-mail registrada na auditoria; senha temporária só com regras fortes e troca obrigatória.
--  * Equipe: convite por e-mail (sem senha), vínculo de conta existente sem duplicar, Master com MFA e
--    confirmação reforçada.
--  * Financeiro: relatório por período/cidade/estabelecimento separando previsto, confirmado, recebido e
--    repassado; histórico de transações para exportação. Pagamentos: cobranças com provedor e eventos.
--  * Cidades: busca sem acento/maiúsculas no banco, com limite (escala para milhares de municípios).
--  * Nomes dos estabelecimentos de teste passam a trazer o código do lote (evita confundir lotes).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('admin.read', 1200, 600), ('admin.invite', 30, 3600), ('admin.password_email', 20, 3600)
on conflict (action) do nothing;

-- ---------- lotes de teste com nomes distintos ----------
-- manutenção interna pode renomear (a trava continua valendo para chamadas da API)
create or replace function private.businesses_name_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name and current_setting('role', true) in ('authenticated', 'anon')
     and coalesce(current_setting('tucai.internal', true), '') <> 'on'
     and not public.has_business_permission(new.id, 'settings.manage') then
    raise exception 'Somente o responsável pode alterar o nome do negócio.' using errcode = '42501';
  end if;
  return new;
end $$;

-- "[Teste] Mercadinho Teste · lote 6e9b5d": o código vem do e-mail do dono (lojista-6e9b5d@...)
create or replace function private.label_test_businesses(_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('tucai.internal', 'on', true);
  update public.businesses b set name = left(b.name || ' · lote ' || substring(u.email from '-([0-9a-f]{6})@'), 120)
    from auth.users u
   where u.id = b.owner_id and b.id = any(_ids) and b.name like '[Teste]%' and b.name not like '%· lote%'
     and substring(u.email from '-([0-9a-f]{6})@') is not null;
  perform set_config('tucai.internal', 'off', true);
end $$;
revoke all on function private.label_test_businesses(uuid[]) from public, anon, authenticated;

select private.label_test_businesses(coalesce((select array_agg(x) from private.test_data_runs r, unnest(r.business_ids) x where r.removed_at is null), '{}'));

alter function public.admin_create_test_data(uuid) set schema private;
alter function private.admin_create_test_data(uuid) rename to admin_create_test_data_impl;
revoke all on function private.admin_create_test_data_impl(uuid) from public, anon, authenticated;
create function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  res := private.admin_create_test_data_impl(_city);
  perform private.label_test_businesses((select business_ids from private.test_data_runs where id = (res->>'run_id')::uuid));
  return res;
end $$;

-- ---------- auditoria: 20 por página ----------
create or replace function public.admin_audit_page(_page integer default 1, _action text default null, _actor text default null,
                                                   _from date default null, _to date default null)
returns table (id bigint, actor_id uuid, actor_email text, actor_name text, action text, entity text, entity_id text,
               details jsonb, created_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare a text := nullif(btrim(coalesce(_action, '')), ''); who text := nullif(lower(btrim(coalesce(_actor, ''))), '');
begin
  perform private.require_permission('audit.view');
  return query
    select l.id, l.actor_id, u.email::text, p.full_name, l.action, l.entity, l.entity_id, l.details, l.created_at, count(*) over ()
      from public.audit_logs l
      left join auth.users u on u.id = l.actor_id
      left join public.profiles p on p.id = l.actor_id
     where (a is null or l.action = a)
       and (who is null or lower(u.email) like '%' || who || '%' or lower(coalesce(p.full_name, '')) like '%' || who || '%')
       and (_from is null or l.created_at >= (_from::timestamp at time zone 'America/Sao_Paulo'))
       and (_to is null or l.created_at < ((_to + 1)::timestamp at time zone 'America/Sao_Paulo'))
     order by l.created_at desc, l.id desc
     limit 20 offset (greatest(coalesce(_page, 1), 1) - 1) * 20;
end $$;

create or replace function public.admin_audit_actions() returns setof text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('audit.view');
  return query select distinct l.action from public.audit_logs l order by 1;
end $$;

-- ---------- entregadores ----------
create or replace function public.admin_couriers_page(_status text default 'todos', _search text default null, _page integer default 1)
returns table (user_id uuid, email text, full_name text, phone text, city_name text, vehicle public.courier_vehicle,
               vehicle_plate text, cnh_category text, status public.courier_status, is_online boolean, review_note text,
               submitted_at timestamptz, reviewed_at timestamptz, deliveries_done bigint, deliveries_active bigint,
               last_delivery_at timestamptz, is_test boolean, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare s text := nullif(lower(btrim(coalesce(_search, ''))), '');
begin
  perform private.require_permission('couriers.review');
  if coalesce(_status, 'todos') not in ('todos', 'pending', 'approved', 'rejected', 'suspended') then
    raise exception 'Filtro inválido.' using errcode = 'P0001';
  end if;
  return query
    select c.user_id, u.email::text, c.full_name, c.phone, ci.name || ' - ' || ci.state, c.vehicle, c.vehicle_plate, c.cnh_category,
           c.status, c.is_online, c.review_note, c.submitted_at, c.reviewed_at,
           (select count(*) from public.deliveries d where d.courier_id = c.user_id and d.status = 'delivered'),
           (select count(*) from public.deliveries d where d.courier_id = c.user_id and d.status in ('accepted', 'picked_up')),
           (select max(d.delivered_at) from public.deliveries d where d.courier_id = c.user_id),
           private.is_test_user(c.user_id), count(*) over ()
      from public.couriers c
      left join auth.users u on u.id = c.user_id
      left join public.cities ci on ci.id = c.city_id
     where (coalesce(_status, 'todos') = 'todos' or c.status::text = _status)
       and (s is null or lower(c.full_name) like '%' || s || '%' or lower(u.email) like '%' || s || '%')
     order by (c.status = 'pending') desc, c.submitted_at desc
     limit 30 offset (greatest(coalesce(_page, 1), 1) - 1) * 30;
end $$;

create or replace function public.admin_courier_history(_user uuid)
returns table (order_id uuid, order_code text, business_name text, status public.delivery_status, courier_pay_cents integer,
               accepted_at timestamptz, delivered_at timestamptz, is_test boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('couriers.review');
  return query
    select d.order_id, o.code, b.name, d.status, d.courier_pay_cents, d.accepted_at, d.delivered_at, d.is_test
      from public.deliveries d join public.orders o on o.id = d.order_id join public.businesses b on b.id = d.business_id
     where d.courier_id = _user
     order by coalesce(d.delivered_at, d.accepted_at, d.offered_at) desc
     limit 30;
end $$;

-- ---------- estabelecimentos (cards) ----------
create or replace function public.admin_businesses_page(_status public.business_status default null, _search text default null,
                                                        _city uuid default null, _category uuid default null,
                                                        _type public.business_type default null, _page integer default 1)
returns table (id uuid, name text, slug text, status public.business_status, business_type public.business_type,
               city_id uuid, city_name text, city_state text, category_id uuid, category_label text, owner_id uuid,
               owner_email text, owner_name text, phone text, description text, address_line text, logo_url text, cover_url text,
               submitted_at timestamptz, reviewed_at timestamptz, review_note text, created_at timestamptz, is_test boolean, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare s text := nullif(lower(btrim(coalesce(_search, ''))), '');
begin
  perform private.require_permission('businesses.review');
  return query
    select b.id, b.name, b.slug, b.status, b.business_type, b.city_id, c.name, c.state, b.category_id, k.label, b.owner_id,
           u.email::text, p.full_name, b.phone, b.description, b.address_line, b.logo_url, b.cover_url,
           b.submitted_at, b.reviewed_at, b.review_note, b.created_at, b.is_test, count(*) over ()
      from public.businesses b
      left join public.cities c on c.id = b.city_id
      left join public.categories k on k.id = b.category_id
      left join auth.users u on u.id = b.owner_id
      left join public.profiles p on p.id = b.owner_id
     where not b.is_demo
       and (_status is null or b.status = _status)
       and (_city is null or b.city_id = _city)
       and (_category is null or b.category_id = _category)
       and (_type is null or b.business_type = _type)
       and (s is null or lower(b.name) like '%' || s || '%' or lower(coalesce(u.email, '')) like '%' || s || '%')
     order by (b.status = 'pending') desc, coalesce(b.submitted_at, b.created_at) desc, b.id
     limit 12 offset (greatest(coalesce(_page, 1), 1) - 1) * 12;
end $$;

-- ---------- contas: detalhe ----------
create or replace function public.admin_account_detail(_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u record;
begin
  perform private.require_permission('users.view');
  select au.id, au.email::text as email, au.created_at, au.last_sign_in_at, au.banned_until, au.email_confirmed_at,
         p.full_name, p.username, p.phone
    into u from auth.users au left join public.profiles p on p.id = au.id where au.id = _user;
  if u.id is null then raise exception 'Conta não encontrada.' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'id', u.id, 'email', u.email, 'full_name', u.full_name, 'username', u.username, 'phone', u.phone,
    'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'email_confirmed', u.email_confirmed_at is not null,
    'blocked', u.banned_until is not null and u.banned_until > now(), 'is_test', private.is_test_user(u.id),
    'must_change_password', exists (select 1 from private.forced_password_changes f where f.user_id = u.id),
    'roles', coalesce((select jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id = u.id), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(sp.permission order by sp.permission) from public.platform_staff_permissions sp where sp.user_id = u.id), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('business_id', b.id, 'business', b.name, 'role', m.member_role, 'status', b.status))
                               from public.business_members m join public.businesses b on b.id = m.business_id where m.user_id = u.id), '[]'::jsonb),
    'courier', (select jsonb_build_object('status', c.status, 'city', ci.name, 'vehicle', c.vehicle, 'is_online', c.is_online)
                  from public.couriers c left join public.cities ci on ci.id = c.city_id where c.user_id = u.id),
    'orders', (select count(*) from public.orders o where o.customer_id = u.id),
    'audit', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select l.action, l.created_at, l.details, coalesce(ap.full_name, au2.email::text) as actor
          from public.audit_logs l left join auth.users au2 on au2.id = l.actor_id left join public.profiles ap on ap.id = l.actor_id
         where l.entity_id = u.id::text order by l.created_at desc limit 20) x), '[]'::jsonb));
end $$;

-- ---------- senha: recuperação por e-mail (registrada) e senha temporária controlada ----------
create table if not exists private.forced_password_changes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  forced_by uuid references auth.users(id) on delete set null,
  forced_at timestamptz not null default now()
);
revoke all on private.forced_password_changes from public, anon, authenticated;

-- quando a própria pessoa troca a senha (Minha conta ou link de recuperação), a obrigação some
create or replace function private.auth_password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(current_setting('tucai.admin_password', true), '') <> 'on' then
    delete from private.forced_password_changes where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists auth_password_changed on auth.users;
create trigger auth_password_changed after update of encrypted_password on auth.users
  for each row execute function private.auth_password_changed();

create or replace function public.must_change_password() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.forced_password_changes where user_id = auth.uid())
$$;

-- registra o envio do link de recuperação (o envio é do Supabase Auth, pela tela) e devolve o e-mail
create or replace function public.admin_password_recovery(_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.password_email');
  select email::text into e from auth.users where id = _user;
  if e is null or e like '%@tucai.example.com' then
    raise exception 'Esta conta não tem e-mail real (entra por usuário). Use a senha temporária.' using errcode = 'P0001';
  end if;
  perform private.audit('accounts.password_recovery_email', 'auth.users', _user::text, '{}'::jsonb);
  return e;
end $$;

-- senha temporária: conta de teste → suporte ou Master; conta real → só Master com MFA (aal2). Troca obrigatória.
create or replace function public.admin_set_account_password(_user uuid, _password text) returns void
language plpgsql security definer set search_path = '' as $$
declare test boolean := private.is_test_user(_user);
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if not test and not (private.is_master_ok() and private.current_aal() = 'aal2') then
    raise exception 'Senha temporária para conta real só pelo Master com verificação em duas etapas ativa. Envie o link de recuperação.' using errcode = '42501';
  end if;
  if char_length(coalesce(_password, '')) < 8 or _password !~ '[A-Za-z]' or _password !~ '[0-9]' then
    raise exception 'A senha precisa ter pelo menos 8 caracteres, com letras e números.' using errcode = 'P0001';
  end if;
  perform set_config('tucai.admin_password', 'on', true);
  update auth.users set encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf')), updated_at = now() where id = _user;
  perform set_config('tucai.admin_password', 'off', true);
  insert into private.forced_password_changes(user_id, forced_by) values (_user, auth.uid())
    on conflict (user_id) do update set forced_by = excluded.forced_by, forced_at = now();
  perform private.audit('accounts.password', 'auth.users', _user::text, jsonb_build_object('temporary', true, 'test_account', test)); -- nunca a senha
end $$;

-- ---------- equipe: convites e papéis ----------
create table if not exists private.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.app_role not null check (role in ('platform_operator', 'platform_master')),
  permissions text[] not null default '{}',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_user uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
create unique index if not exists staff_invites_open_idx on private.staff_invites(email) where accepted_at is null and revoked_at is null;
revoke all on private.staff_invites from public, anon, authenticated;

create or replace function private.require_master_mfa() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  if private.current_aal() <> 'aal2' then
    raise exception 'Esta ação exige a verificação em duas etapas (MFA) ativa na sua sessão.' using errcode = '42501';
  end if;
end $$;

create or replace function private.apply_staff_access(_user uuid, _role public.app_role, _permissions text[], _by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  insert into public.user_roles(user_id, role, granted_by) values (_user, _role, _by) on conflict do nothing;
  if _role = 'platform_operator' then
    foreach p in array coalesce(_permissions, '{}') loop
      insert into public.platform_staff_permissions(user_id, permission, granted_by)
      select _user, p, _by where exists (select 1 from public.platform_permissions where code = p)
      on conflict do nothing;
    end loop;
  end if;
end $$;

-- convite: conta existente é vinculada na hora (sem duplicar); e-mail novo fica pendente até a pessoa ativar
create or replace function public.admin_invite_staff(_email text, _role public.app_role, _permissions text[] default '{}', _confirm text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare e text := lower(btrim(coalesce(_email, ''))); existing uuid; bad text;
begin
  perform private.require_master();
  perform private.limit_for('admin.invite');
  if _role not in ('platform_operator', 'platform_master') then raise exception 'Papel inválido para a equipe.' using errcode = 'P0001'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.' using errcode = 'P0001'; end if;
  if _role = 'platform_master' then
    perform private.require_master_mfa();
    if coalesce(_confirm, '') <> 'CONCEDER MASTER' then
      raise exception 'Para conceder acesso Master, digite CONCEDER MASTER na confirmação.' using errcode = 'P0001';
    end if;
  end if;
  select x into bad from unnest(coalesce(_permissions, '{}')) x where not exists (select 1 from public.platform_permissions where code = x) limit 1;
  if bad is not null then raise exception 'Permissão desconhecida: %.', bad using errcode = 'P0001'; end if;
  select id into existing from auth.users where lower(email) = e;
  if existing is not null then
    perform private.apply_staff_access(existing, _role, _permissions, auth.uid());
    perform private.audit('staff.invite_existing', 'user_roles', existing::text, jsonb_build_object('role', _role, 'permissions', _permissions));
    return 'vinculado';
  end if;
  update private.staff_invites set revoked_at = now() where email = e and accepted_at is null and revoked_at is null;
  insert into private.staff_invites(email, role, permissions, invited_by) values (e, _role, coalesce(_permissions, '{}'), auth.uid());
  perform private.audit('staff.invite', 'staff_invites', e, jsonb_build_object('role', _role, 'permissions', _permissions));
  return 'convidado';
end $$;

create or replace function public.admin_list_invites()
returns table (id uuid, email text, role public.app_role, permissions text[], created_at timestamptz, expires_at timestamptz, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select i.id, i.email, i.role, i.permissions, i.created_at, i.expires_at,
           case when i.accepted_at is not null then 'aceito' when i.revoked_at is not null then 'cancelado'
                when i.expires_at < now() then 'expirado' else 'pendente' end
      from private.staff_invites i order by i.created_at desc limit 50;
end $$;

create or replace function public.admin_revoke_invite(_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  update private.staff_invites set revoked_at = now() where id = _id and accepted_at is null and revoked_at is null;
  if not found then raise exception 'Convite não está pendente.' using errcode = 'P0001'; end if;
  perform private.audit('staff.invite_revoke', 'staff_invites', _id::text, '{}'::jsonb);
end $$;

-- ao confirmar o e-mail pelo link (conta criada pelo convite), o acesso convidado é aplicado
create or replace function private.claim_staff_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i private.staff_invites%rowtype;
begin
  if new.email_confirmed_at is null or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then return new; end if;
  for i in select * from private.staff_invites
            where email = lower(new.email) and accepted_at is null and revoked_at is null and expires_at > now() loop
    perform private.apply_staff_access(new.id, i.role, i.permissions, i.invited_by);
    update private.staff_invites set accepted_at = now(), accepted_user = new.id where id = i.id;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (new.id, 'staff.invite_accept', 'user_roles', new.id::text, jsonb_build_object('role', i.role));
  end loop;
  return new;
end $$;
drop trigger if exists claim_staff_invites on auth.users;
create trigger claim_staff_invites after insert or update of email_confirmed_at on auth.users
  for each row execute function private.claim_staff_invites();

-- conceder Master exige MFA; revogar continua protegendo o último Master (0005)
create or replace function public.grant_role(_user uuid, _role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.role');
  if _role = 'platform_master' then perform private.require_master_mfa(); end if;
  if _role in ('courier_partner', 'courier_own', 'business_owner', 'business_staff', 'service_provider') then
    raise exception 'Este papel vem do cadastro e aprovação (entregador ou estabelecimento), não da Equipe.' using errcode = 'P0001';
  end if;
  perform private.grant_role_impl(_user, _role);
end $$;

-- ---------- financeiro ----------
create or replace function public.admin_finance_report(_from date, _to date, _city uuid default null, _business uuid default null,
                                                       _include_test boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  perform private.require_permission('finance.view');
  if _from is null or _to is null or _to < _from or _to - _from > 366 then
    raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001';
  end if;
  return (
    with o as (
      select o.* from public.orders o join public.businesses b on b.id = o.business_id
       where o.created_at >= f and o.created_at < t
         and (_include_test or not o.is_test)
         and (_city is null or b.city_id = _city) and (_business is null or o.business_id = _business)),
    ch as (
      select c.* from public.platform_charges c join public.businesses b on b.id = c.business_id
       where (_city is null or b.city_id = _city) and (_business is null or c.business_id = _business)
         and (_include_test or not b.is_test)),
    done as (select * from o where status in ('delivered', 'picked_up')),
    open as (select * from o where status not in ('delivered', 'picked_up', 'rejected', 'cancelled'))
    select jsonb_build_object(
      'confirmado', jsonb_build_object(
        'pedidos', (select count(*) from done),
        'volume_bruto_cents', coalesce((select sum(total_cents) from done), 0),
        'produtos_cents', coalesce((select sum(subtotal_cents) from done), 0),
        'comissao_cents', coalesce((select sum(commission_cents) from done), 0),
        'taxas_plataforma_cents', coalesce((select sum(platform_delivery_fee_cents) from done), 0),
        'devido_entregadores_cents', coalesce((select sum(courier_pay_cents) from done where fulfillment = 'delivery_partner'), 0),
        'logistica_estabelecimentos_cents', coalesce((select sum(merchant_delivery_contribution_cents) from done), 0)),
      'previsto', jsonb_build_object(
        'pedidos', (select count(*) from open),
        'volume_bruto_cents', coalesce((select sum(total_cents) from open), 0),
        'comissao_cents', coalesce((select sum(commission_cents) from open), 0),
        'taxas_plataforma_cents', coalesce((select sum(platform_delivery_fee_cents) from open), 0)),
      'cancelados', jsonb_build_object('pedidos', (select count(*) from o where status in ('rejected', 'cancelled')),
                                       'volume_cents', coalesce((select sum(total_cents) from o where status in ('rejected', 'cancelled')), 0)),
      'mensalidades', jsonb_build_object(
        'recebido_cents', coalesce((select sum(amount_cents) from ch where status = 'paga' and paid_at >= f and paid_at < t), 0),
        'recebido_online_cents', coalesce((select sum(amount_cents) from ch where status = 'paga' and provider is not null and paid_at >= f and paid_at < t), 0),
        'a_receber_cents', coalesce((select sum(amount_cents) from ch where status = 'aberta'), 0),
        'vencido_cents', coalesce((select sum(amount_cents) from ch where status = 'aberta' and due_on < current_date), 0)),
      'repassado', jsonb_build_object('entregadores_cents', 0, 'registrado', false),
      'reembolsos', jsonb_build_object('cents', 0, 'registrado', false),
      'por_estabelecimento', coalesce((select jsonb_agg(x order by x.volume_cents desc) from (
          select b.name as estabelecimento, count(*) as pedidos, sum(d.total_cents) as volume_cents,
                 sum(d.commission_cents + d.platform_delivery_fee_cents) as plataforma_cents
            from done d join public.businesses b on b.id = d.business_id group by b.name limit 50) x), '[]'::jsonb),
      'por_cidade', coalesce((select jsonb_agg(x order by x.volume_cents desc) from (
          select coalesce(c.name || ' - ' || c.state, 'Sem cidade') as cidade, count(*) as pedidos, sum(d.total_cents) as volume_cents
            from done d join public.businesses b on b.id = d.business_id left join public.cities c on c.id = b.city_id
           group by 1) x), '[]'::jsonb)));
end $$;

-- histórico de transações (pedidos concluídos/cancelados e cobranças), paginado; a exportação pede página a página
create or replace function public.admin_finance_transactions(_from date, _to date, _city uuid default null, _business uuid default null,
                                                             _kind text default 'todos', _include_test boolean default false, _page integer default 1)
returns table (kind text, ref text, occurred_at timestamptz, business_name text, city_name text, description text, status text,
               amount_cents integer, platform_cents integer, courier_cents integer, method text, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  perform private.require_permission('finance.view');
  if _from is null or _to is null or _to < _from or _to - _from > 366 then
    raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001';
  end if;
  if coalesce(_kind, 'todos') not in ('todos', 'pedido', 'cobranca') then raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  return query
    with x as (
      select 'pedido'::text as kind, o.code as ref, o.created_at as occurred_at, b.name as business_name,
             c.name || ' - ' || c.state as city_name,
             case o.fulfillment when 'pickup' then 'Pedido (retirada)' when 'delivery_own' then 'Pedido (entrega própria)' else 'Pedido (entregador parceiro)' end
               || case when o.is_test then ' · teste' else '' end as description,
             o.status::text as status, o.total_cents as amount_cents, o.commission_cents + o.platform_delivery_fee_cents as platform_cents,
             case when o.fulfillment = 'delivery_partner' then o.courier_pay_cents else 0 end as courier_cents,
             o.payment_method::text as method
        from public.orders o join public.businesses b on b.id = o.business_id left join public.cities c on c.id = b.city_id
       where coalesce(_kind, 'todos') in ('todos', 'pedido') and o.created_at >= f and o.created_at < t
         and (_include_test or not o.is_test) and (_city is null or b.city_id = _city) and (_business is null or o.business_id = _business)
      union all
      select 'cobranca', left(ch.id::text, 8), coalesce(ch.paid_at, ch.created_at), b.name, c.name || ' - ' || c.state,
             ch.description, ch.status::text, ch.amount_cents, case when ch.status = 'paga' then ch.amount_cents else 0 end, 0,
             coalesce(ch.provider, ch.paid_method)
        from public.platform_charges ch join public.businesses b on b.id = ch.business_id left join public.cities c on c.id = b.city_id
       where coalesce(_kind, 'todos') in ('todos', 'cobranca') and coalesce(ch.paid_at, ch.created_at) >= f and coalesce(ch.paid_at, ch.created_at) < t
         and (_include_test or not b.is_test) and (_city is null or b.city_id = _city) and (_business is null or ch.business_id = _business))
    select x.*, count(*) over () from x order by x.occurred_at desc
     limit 100 offset (greatest(coalesce(_page, 1), 1) - 1) * 100;
end $$;

-- ---------- pagamentos (cobranças da plataforma) ----------
create or replace function public.admin_payments_page(_status public.charge_status default null, _search text default null,
                                                      _origin text default 'todos', _page integer default 1)
returns table (id uuid, business_name text, kind public.charge_kind, description text, amount_cents integer, due_on date,
               status public.charge_status, paid_at timestamptz, paid_method text, provider text, provider_payment_id text,
               created_at timestamptz, events jsonb, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare s text := nullif(lower(btrim(coalesce(_search, ''))), '');
begin
  perform private.require_permission('finance.view');
  if coalesce(_origin, 'todos') not in ('todos', 'online', 'manual') then raise exception 'Origem inválida.' using errcode = 'P0001'; end if;
  return query
    select ch.id, b.name, ch.kind, ch.description, ch.amount_cents, ch.due_on, ch.status, ch.paid_at, ch.paid_method, ch.provider,
           ch.provider_payment_id, ch.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at) order by l.created_at)
                       from public.audit_logs l where l.entity = 'platform_charges' and l.entity_id = ch.id::text), '[]'::jsonb),
           count(*) over ()
      from public.platform_charges ch join public.businesses b on b.id = ch.business_id
     where (_status is null or ch.status = _status)
       and (s is null or lower(b.name) like '%' || s || '%' or lower(ch.description) like '%' || s || '%' or ch.provider_payment_id = s)
       and (coalesce(_origin, 'todos') = 'todos' or (_origin = 'online') = (ch.provider is not null and ch.status = 'paga'))
     order by ch.created_at desc
     limit 30 offset (greatest(coalesce(_page, 1), 1) - 1) * 30;
end $$;

-- ---------- cidades: busca escalável ----------
create or replace function private.search_norm(_t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(coalesce(_t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;
alter table public.cities add column if not exists search_name text generated always as (private.search_norm(name)) stored;
alter table public.cities add column if not exists ibge_code integer check (ibge_code is null or ibge_code between 1000000 and 9999999);
create unique index if not exists cities_ibge_code_idx on public.cities(ibge_code) where ibge_code is not null;
create index if not exists cities_search_name_idx on public.cities(search_name text_pattern_ops);

create or replace function public.search_cities(_q text default null, _state text default null, _limit integer default 30)
returns table (id uuid, name text, state text, slug text, center_lat numeric, center_lng numeric)
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(private.search_norm(_q)); st text := nullif(upper(btrim(coalesce(_state, ''))), '');
begin
  -- leitura barata e limitada (índice + LIMIT); sem contador, que seria compartilhado por todos os visitantes
  return query
    select c.id, c.name, c.state, c.slug, c.center_lat, c.center_lng
      from public.cities c
     where c.is_active and not c.is_demo
       and (st is null or c.state = st)
       and (q = '' or c.search_name like '%' || q || '%')
     order by (q <> '' and c.search_name like q || '%') desc, c.name
     limit least(greatest(coalesce(_limit, 30), 1), 100);
end $$;

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array['private.auth_password_changed()', 'private.require_master_mfa()', 'private.apply_staff_access(uuid, public.app_role, text[], uuid)',
                           'private.claim_staff_invites()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_audit_page(integer, text, text, date, date)', 'public.admin_audit_actions()',
    'public.admin_couriers_page(text, text, integer)', 'public.admin_courier_history(uuid)',
    'public.admin_businesses_page(public.business_status, text, uuid, uuid, public.business_type, integer)',
    'public.admin_account_detail(uuid)', 'public.must_change_password()', 'public.admin_password_recovery(uuid)',
    'public.admin_set_account_password(uuid, text)', 'public.admin_invite_staff(text, public.app_role, text[], text)',
    'public.admin_list_invites()', 'public.admin_revoke_invite(uuid)', 'public.grant_role(uuid, public.app_role)',
    'public.admin_finance_report(date, date, uuid, uuid, boolean)',
    'public.admin_finance_transactions(date, date, uuid, uuid, text, boolean, integer)',
    'public.admin_payments_page(public.charge_status, text, text, integer)', 'public.admin_create_test_data(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function public.search_cities(text, text, integer) from public;
  grant execute on function public.search_cities(text, text, integer) to anon, authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0023', '0023_painel_master.sql', 'applied');
    raise notice 'Tucaí 0023: aplicada agora';
  end if;
end $tucai_0023$;

-- ===================== supabase/migrations/0024_pedidos_entrega_codigo.sql =====================
do $tucai_0024$
begin
  if exists (select 1 from private.tucai_migrations where version = '0024') then
    raise notice 'Tucaí 0024: já aplicada';
  else
    execute $tucai_sql$
-- 0024_pedidos_entrega_codigo: fluxo de pedido no estilo delivery, código de entrega seguro e finanças do lojista.
--  * Código de 4 dígitos sem texto aberto no banco: derivado por HMAC-SHA256 (segredo aleatório guardado no
--    schema private) do id da entrega + versão. Só o cliente do pedido consegue ver; o entregador nunca recebe.
--    Nova tentativa de entrega (liberação/redistribuição) gera nova versão e invalida o código anterior.
--  * Confirmação em duas etapas: courier_verify_code (bloqueio progressivo e auditoria sem o código) e
--    courier_finish_delivery (só com validação vigente; atômica e idempotente por identificador de operação).
--    Exceção: admin_force_complete_delivery (Master com MFA, justificativa e auditoria).
--  * Aceite do estabelecimento já coloca o pedido "em preparo"; cliente e loja são avisados quando um
--    entregador aceita ("Entregador encontrado!"). Entregas publicadas no Realtime para a loja.
--  * Homologação: o "[Teste] Mercadinho Teste" passa a usar entregador parceiro e vende Cheeseburger.
--  * Lojista: gastos (categorias, recorrência), custo por produto (privado) e painel/lucro estimado.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('delivery.verify', 30, 600), ('merchant.finance', 300, 600), ('admin.force_delivery', 10, 3600)
on conflict (action) do nothing;

-- ---------- código de entrega ----------
create table if not exists private.app_secrets (
  key text primary key,
  value bytea not null,
  created_at timestamptz not null default now()
);
revoke all on private.app_secrets from public, anon, authenticated;
insert into private.app_secrets(key, value) values ('delivery_code', extensions.gen_random_bytes(32)) on conflict (key) do nothing;

alter table public.deliveries
  add column if not exists code_version integer not null default 1,
  add column if not exists code_verified_at timestamptz,
  add column if not exists code_verified_version integer,
  add column if not exists code_locked_until timestamptz,
  add column if not exists finish_op_id uuid;
-- o código deixa de existir em texto aberto
alter table public.deliveries alter column confirmation_code drop not null;
alter table public.deliveries alter column confirmation_code drop default;
update public.deliveries set confirmation_code = null where confirmation_code is not null;

create or replace function private.delivery_code(_order uuid, _version integer) returns text
language sql stable security definer set search_path = '' as $$
  select lpad(((('x' || '00000000' || substr(encode(extensions.hmac(convert_to(_order::text || ':' || _version::text, 'UTF8'), s.value, 'sha256'), 'hex'), 1, 8))::bit(64)::bigint) % 10000)::text, 4, '0')
    from private.app_secrets s where s.key = 'delivery_code'
$$;

-- nova tentativa (entrega volta a ser oferecida): nova versão do código, tentativas zeradas
create or replace function private.deliveries_code_rotate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'offered' and old.status <> 'offered' then
    new.code_version := old.code_version + 1;
    new.code_verified_at := null; new.code_verified_version := null;
    new.code_locked_until := null; new.failed_code_attempts := 0;
  end if;
  return new;
end $$;
drop trigger if exists deliveries_code_rotate on public.deliveries;
create trigger deliveries_code_rotate before update of status on public.deliveries
  for each row execute function private.deliveries_code_rotate();

-- cliente: andamento, código (só dele, depois que um entregador aceitou) e dados permitidos do entregador
create or replace function public.my_delivery(_order uuid)
returns table (status public.delivery_status, confirmation_code text, courier_first_name text, courier_vehicle public.courier_vehicle)
language sql stable security definer set search_path = '' as $$
  select d.status,
         case when d.status in ('accepted', 'picked_up') then private.delivery_code(d.order_id, d.code_version) end,
         split_part(c.full_name, ' ', 1), c.vehicle
    from public.deliveries d join public.orders o on o.id = d.order_id left join public.couriers c on c.user_id = d.courier_id
   where d.order_id = _order and o.customer_id = auth.uid()
$$;

-- etapa 1: validar o código informado pelo cliente (no banco; o entregador nunca recebe o código esperado)
create or replace function public.courier_verify_code(_order uuid, _code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype; fails int; lock_for interval;
begin
  perform private.limit_for('delivery.verify');
  select * into d from public.deliveries where order_id = _order and courier_id = c.user_id for update;
  if not found then raise exception 'Esta entrega não está com você.' using errcode = '42501'; end if;
  if d.status <> 'picked_up' then raise exception 'A entrega não está em rota.' using errcode = 'P0001'; end if;
  if d.code_locked_until is not null and d.code_locked_until > now() then
    return jsonb_build_object('ok', false, 'locked_until', d.code_locked_until, 'reason', 'bloqueado');
  end if;
  if coalesce(btrim(_code), '') ~ '^[0-9]{4}$' and btrim(_code) = private.delivery_code(d.order_id, d.code_version) then
    update public.deliveries set code_verified_at = now(), code_verified_version = d.code_version, failed_code_attempts = 0, code_locked_until = null
     where order_id = _order;
    perform private.audit('delivery.code_ok', 'deliveries', _order::text, jsonb_build_object('version', d.code_version));
    return jsonb_build_object('ok', true);
  end if;
  fails := d.failed_code_attempts + 1;
  -- bloqueio progressivo: 3 erros → 5 min, 6 → 30 min, 10 → só com o suporte
  lock_for := case when fails >= 10 then interval '100 years' when fails >= 6 then interval '30 minutes' when fails % 3 = 0 then interval '5 minutes' end;
  update public.deliveries set failed_code_attempts = fails, code_locked_until = case when lock_for is null then null else now() + lock_for end
   where order_id = _order;
  perform private.audit('delivery.code_fail', 'deliveries', _order::text, jsonb_build_object('attempt', fails)); -- nunca o código
  if fails = 10 then perform private.notify_ops(_order, 'Entrega com código bloqueado após 10 tentativas: confira com o cliente.'); end if;
  return jsonb_build_object('ok', false, 'reason', case when lock_for is null then 'invalido' else 'bloqueado' end,
                            'locked_until', case when lock_for is null then null else now() + lock_for end);
end $$;

-- etapa 2: finalizar (exige validação vigente). Atômica: só um UPDATE condicional vence; repetir com a mesma operação é seguro.
create or replace function public.courier_finish_delivery(_order uuid, _op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype; o public.orders%rowtype; n int;
begin
  perform private.limit_for('delivery.action');
  if _op is null then raise exception 'Operação inválida.' using errcode = 'P0001'; end if;
  select * into d from public.deliveries where order_id = _order and courier_id = c.user_id;
  if not found then raise exception 'Esta entrega não está com você.' using errcode = '42501'; end if;
  if d.status = 'delivered' then
    if d.finish_op_id = _op then return 'ja_finalizada'; end if;
    raise exception 'Esta entrega já foi concluída.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'delivered', delivered_at = now(), finish_op_id = _op
   where order_id = _order and courier_id = c.user_id and status = 'picked_up'
     and code_verified_at is not null and code_verified_version = code_version;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Confirme o código do cliente antes de finalizar.' using errcode = 'P0001'; end if;
  update public.orders set status = 'delivered' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'delivered', c.user_id, 'Entregue com código de confirmação');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' entregue. Bom apetite!');
  perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' entregue ao cliente.');
  perform private.audit('delivery.complete', 'deliveries', _order::text, jsonb_build_object('pay_cents', d.courier_pay_cents, 'op', _op));
  return 'finalizada';
end $$;

-- compatibilidade com a tela anterior: valida e finaliza numa chamada (mesmas regras)
create or replace function public.courier_complete_delivery(_order uuid, _code text) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r := public.courier_verify_code(_order, _code);
  if (r->>'ok')::boolean then perform public.courier_finish_delivery(_order, gen_random_uuid()); end if;
end $$;

-- exceção administrativa (cliente sem acesso ao código, por exemplo): Master com MFA, justificativa e auditoria
create or replace function public.admin_force_complete_delivery(_order uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; o public.orders%rowtype; r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  perform private.require_master_mfa();
  perform private.limit_for('admin.force_delivery');
  if r is null or char_length(r) < 10 or char_length(r) > 300 then
    raise exception 'Descreva a justificativa (10 a 300 caracteres).' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'delivered', delivered_at = now() where order_id = _order and status = 'picked_up' returning * into d;
  if not found then raise exception 'Só entregas em rota podem ser concluídas pelo suporte.' using errcode = 'P0001'; end if;
  update public.orders set status = 'delivered' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'delivered', auth.uid(), 'Concluída pelo suporte Tucaí: ' || r);
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' marcado como entregue pelo suporte.');
  perform private.audit('delivery.force_complete', 'deliveries', _order::text, jsonb_build_object('reason', r, 'courier', d.courier_id));
end $$;

-- ---------- aceite → em preparo; "Entregador encontrado!" ----------
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
  perform public.update_order_status(_order, 'preparing');
  return 'preparing';
end $$;

create or replace function public.courier_accept_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int; o public.orders%rowtype;
begin
  perform private.limit_for('delivery.action');
  if not c.is_online then raise exception 'Fique disponível para aceitar entregas.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.deliveries where courier_id = c.user_id and status in ('accepted', 'picked_up')) then
    raise exception 'Conclua a entrega atual antes de aceitar outra.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'accepted', courier_id = c.user_id, accepted_at = now(), attention_reason = null, attention_at = null
   where order_id = _order and status = 'offered' and courier_id is null and city_id = c.city_id
     and is_test = private.is_test_user(c.user_id);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Esta entrega já foi aceita por outro entregador ou não está mais disponível.' using errcode = 'P0001'; end if;
  select * into o from public.orders where id = _order;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, o.status, c.user_id, 'Entrega aceita pelo entregador parceiro');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id,
    'Pedido #' || o.code || ': entregador encontrado! ' || split_part(c.full_name, ' ', 1) || ' vai buscar seu pedido.');
  perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ': entregador ' || split_part(c.full_name, ' ', 1) || ' a caminho para coletar.');
  perform private.audit('delivery.accept', 'deliveries', _order::text, '{}'::jsonb);
end $$;

-- a loja recebe as mudanças das entregas em tempo real (RLS: só as do próprio estabelecimento)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deliveries') then
    alter publication supabase_realtime add table public.deliveries;
  end if;
end $$;

-- ---------- homologação: Mercadinho com entregador parceiro e Cheeseburger ----------
create or replace function private.prepare_test_mercadinho(_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare b uuid; mc uuid;
begin
  for b in select id from public.businesses where id = any(_ids) and is_test and business_type = 'loja' and name like '[Teste] Mercadinho%' loop
    update public.businesses set delivery_offer = 'partner' where id = b and delivery_offer <> 'partner';
    if not exists (select 1 from public.products where business_id = b and name = 'Cheeseburger') then
      select id into mc from public.menu_categories where business_id = b and name = 'Lanches';
      if mc is null then insert into public.menu_categories(business_id, name, sort_order) values (b, 'Lanches', 5) returning id into mc; end if;
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b, mc, 'Cheeseburger', 'Pão, hambúrguer, queijo e molho. Produto de homologação.', 2200, 10);
    end if;
  end loop;
end $$;
revoke all on function private.prepare_test_mercadinho(uuid[]) from public, anon, authenticated;
select private.prepare_test_mercadinho(coalesce((select array_agg(x) from private.test_data_runs r, unnest(r.business_ids) x where r.removed_at is null), '{}'));

create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[];
begin
  res := private.admin_create_test_data_impl(_city);
  select business_ids into ids from private.test_data_runs where id = (res->>'run_id')::uuid;
  perform private.label_test_businesses(ids);
  perform private.prepare_test_mercadinho(ids);
  return res;
end $$;

-- ---------- finanças do lojista ----------
create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category text not null check (category in ('mercadorias', 'ingredientes', 'embalagens', 'aluguel', 'energia', 'agua', 'internet',
                                             'funcionarios', 'marketing', 'outros')),
  description text check (description is null or char_length(description) <= 200),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  spent_on date not null,
  recurrence text not null default 'unica' check (recurrence in ('unica', 'mensal')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_expenses_business_idx on public.business_expenses(business_id, spent_on desc);
create index if not exists business_expenses_created_by_idx on public.business_expenses(created_by);
alter table public.business_expenses enable row level security;
drop policy if exists business_expenses_rw on public.business_expenses;
create policy business_expenses_rw on public.business_expenses for all to authenticated
  using (public.has_business_permission(business_id, 'reports.view'))
  with check (public.has_business_permission(business_id, 'reports.view'));
revoke all on public.business_expenses from public, anon, authenticated;
grant select, insert, update, delete on public.business_expenses to authenticated;

-- custo de cada produto: separado do cardápio público (cliente nunca vê)
create table if not exists public.business_product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  cost_cents integer not null check (cost_cents >= 0 and cost_cents <= 10000000),
  updated_at timestamptz not null default now()
);
create index if not exists business_product_costs_business_idx on public.business_product_costs(business_id);
alter table public.business_product_costs enable row level security;
drop policy if exists business_product_costs_rw on public.business_product_costs;
create policy business_product_costs_rw on public.business_product_costs for all to authenticated
  using (public.has_business_permission(business_id, 'reports.view'))
  with check (public.has_business_permission(business_id, 'reports.view')
              and exists (select 1 from public.products p where p.id = business_product_costs.product_id and p.business_id = business_product_costs.business_id));
revoke all on public.business_product_costs from public, anon, authenticated;
grant select, insert, update, delete on public.business_product_costs to authenticated;

-- painel, caixa e lucro estimado (pedidos de teste contam só em lojas de teste, que só têm pedidos de teste)
create or replace function public.merchant_finance(_business uuid, _from date, _to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
        today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  if _from is null or _to is null or _to < _from or _to - _from > 366 then raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001'; end if;
  return (
    with done as (select * from public.orders where business_id = _business and status in ('delivered', 'picked_up')),
    per as (select * from done where updated_at >= f and updated_at < t),
    items as (
      select i.quantity, i.line_total_cents, c.cost_cents
        from public.order_items i join per o on o.id = i.order_id left join public.business_product_costs c on c.product_id = i.product_id),
    exp as (
      -- despesa única conta se cair no período; mensal conta uma vez por mês do período, a partir do mês em que começou
      select e.*, case
               when e.recurrence = 'unica' then (case when e.spent_on between _from and _to then 1 else 0 end)
               when e.spent_on > _to then 0
               else ((extract(year from _to) * 12 + extract(month from _to))
                     - (extract(year from greatest(e.spent_on, _from)) * 12 + extract(month from greatest(e.spent_on, _from))) + 1)::int
             end as times
        from public.business_expenses e where e.business_id = _business)
    select jsonb_build_object(
      'hoje_cents', coalesce((select sum(subtotal_cents) from done where updated_at >= today), 0),
      'mes_cents', coalesce((select sum(subtotal_cents) from done where updated_at >= month), 0),
      'pedidos', (select count(*) from per),
      'ticket_medio_cents', coalesce((select round(avg(subtotal_cents)) from per), 0)::int,
      'cancelados', (select count(*) from public.orders where business_id = _business and status in ('rejected', 'cancelled') and updated_at >= f and updated_at < t),
      'faturamento_bruto_cents', coalesce((select sum(subtotal_cents + case when fulfillment = 'delivery_own' then delivery_fee_cents else 0 end) from per), 0),
      'comissao_cents', coalesce((select sum(commission_cents) from per), 0),
      'taxas_entrega_cents', coalesce((select sum(merchant_delivery_contribution_cents + platform_delivery_fee_cents) from per), 0),
      'custo_produtos_cents', coalesce((select sum(quantity * cost_cents) from items where cost_cents is not null), 0),
      'itens_sem_custo', (select count(*) from items where cost_cents is null),
      'vendas_itens_com_custo_cents', coalesce((select sum(line_total_cents) from items where cost_cents is not null), 0),
      'despesas_cents', coalesce((select sum(amount_cents * times) from exp), 0),
      'despesas_por_categoria', coalesce((select jsonb_object_agg(category, total) from (select category, sum(amount_cents * times) as total from exp where times > 0 group by category) x), '{}'::jsonb),
      'recebido_na_entrega_cents', coalesce((select sum(total_cents) from per where fulfillment <> 'delivery_partner'), 0),
      'caixa_hoje', coalesce((select jsonb_object_agg(payment_method, total) from (select payment_method, sum(total_cents) as total from done where updated_at >= today group by payment_method) x), '{}'::jsonb)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.delivery_code(uuid, integer)', 'private.deliveries_code_rotate()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.my_delivery(uuid)', 'public.courier_verify_code(uuid, text)', 'public.courier_finish_delivery(uuid, uuid)',
    'public.courier_complete_delivery(uuid, text)', 'public.admin_force_complete_delivery(uuid, text)',
    'public.merchant_accept_order(uuid, integer)', 'public.courier_accept_delivery(uuid)', 'public.admin_create_test_data(uuid)',
    'public.merchant_finance(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0024', '0024_pedidos_entrega_codigo.sql', 'applied');
    raise notice 'Tucaí 0024: aplicada agora';
  end if;
end $tucai_0024$;

-- ===================== supabase/migrations/0025_comunidade_logada.sql =====================
do $tucai_0025$
begin
  if exists (select 1 from private.tucai_migrations where version = '0025') then
    raise notice 'Tucaí 0025: já aplicada';
  else
    execute $tucai_sql$
-- 0025_comunidade_logada: o Conectuaí (feed, perfis, recados, depoimentos e comunidades) passa a ser só para
-- quem está logado. Visitante sem conta não lê nem publica; as regras de quem vê o quê entre usuários logados
-- (perfil fechado, amigos, comunidades fechadas, bloqueios) continuam as mesmas.
revoke select on public.social_profiles, public.follows, public.posts, public.post_comments,
  public.friendships, public.scraps, public.testimonials,
  public.communities, public.community_members, public.community_topics, public.topic_replies,
  public.community_polls, public.poll_options
from anon;

do $$
declare f text;
begin
  foreach f in array array['public.are_friends(uuid, uuid)', 'public.can_read_community(uuid)', 'public.can_see_wall(uuid)',
                           'public.community_role(uuid)', 'public.conecta_can_see(uuid)', 'public.is_blocked_between(uuid, uuid)',
                           'public.is_community_mod(uuid)'] loop
    execute format('revoke execute on function %s from anon', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0025', '0025_comunidade_logada.sql', 'applied');
    raise notice 'Tucaí 0025: aplicada agora';
  end if;
end $tucai_0025$;

-- ===================== supabase/migrations/0026_painel_empresarial.sql =====================
do $tucai_0026$
begin
  if exists (select 1 from private.tucai_migrations where version = '0026') then
    raise notice 'Tucaí 0026: já aplicada';
  else
    execute $tucai_sql$
-- 0026_painel_empresarial: central do lojista.
--  * Oferta antecipada: pedido com entregador parceiro já cria a demanda de entrega ao ser feito; entregadores
--    aptos veem a oferta (com a situação do preparo) e podem aceitar antes de ficar pronto. Endereço completo só
--    depois do aceite do estabelecimento; coleta só depois de "pronto"; recusa/cancelamento cancela a entrega.
--    O código de entrega fica disponível ao cliente desde a confirmação do pedido.
--  * Planos: Padrão = "delivery" (R$ 79) e Premium = "presencial_delivery" (R$ 99), já existentes. Recursos
--    Premium (gastos, custos, calculadora, Meu Lucro) bloqueados no banco. Concessão explícita e auditada de
--    Premium para estabelecimentos de homologação (sem cobrança e sem assinatura falsa).
--  * Calculadora de custos: ingredientes, ficha técnica por produto, embalagem e custo operacional, margem e preço
--    sugerido, histórico de cálculos.
--  * Equipe da loja: convite por e-mail para gerente, atendente/comandas, cozinha e entregador próprio, usando
--    business_members e o Supabase Auth (sem contas paralelas). Tudo auditado.
--  * Visão geral do estabelecimento com números reais; aviso de pedido novo traz os itens.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('merchant.team', 60, 3600), ('merchant.costing', 600, 600), ('admin.plan_grant', 60, 3600), ('merchant.plan_request', 10, 86400)
on conflict (action) do nothing;

update public.plans set name = 'Padrão' where code = 'delivery' and name = 'Delivery';
update public.plans set name = 'Premium' where code = 'presencial_delivery' and name = 'Presencial + Delivery';

-- ---------- oferta antecipada ----------
create or replace function private.orders_offer_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid; bname text;
begin
  if new.fulfillment = 'delivery_partner' then
    select city_id, name into c, bname from public.businesses where id = new.business_id;
    insert into public.deliveries(order_id, business_id, city_id, courier_pay_cents, is_test, offer_expires_at)
    values (new.id, new.business_id, c, new.courier_pay_cents, new.is_test, now() + private.offer_window())
    on conflict (order_id) do nothing;
    perform private.offer_to_couriers(new.id, 'Nova entrega disponível: ' || left(bname, 80) || '.');
  end if;
  return null;
end $$;
drop trigger if exists orders_offer_on_insert on public.orders;
create trigger orders_offer_on_insert after insert on public.orders for each row execute function private.orders_offer_on_insert();

create or replace function private.orders_delivery_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid; d public.deliveries%rowtype;
begin
  if new.fulfillment = 'delivery_partner' and new.status = 'ready' and old.status <> 'ready' then
    select * into d from public.deliveries where order_id = new.id;
    if not found then
      select city_id into c from public.businesses where id = new.business_id;
      insert into public.deliveries(order_id, business_id, city_id, courier_pay_cents, is_test, offer_expires_at)
      values (new.id, new.business_id, c, new.courier_pay_cents, new.is_test, now() + private.offer_window());
      perform private.offer_to_couriers(new.id, 'Nova entrega pronta para coleta perto de você.');
    elsif d.status = 'accepted' then
      perform private.notify_link(d.courier_id, 'order_update', null, '/entregador/entregas', 'Pedido #' || new.code || ' pronto para coleta.');
    elsif d.status = 'offered' then
      -- pronto e ainda sem entregador: as rodadas de oferta passam a contar a partir de agora
      update public.deliveries set offer_round = 1, offer_expires_at = now() + private.offer_window() where order_id = new.id;
      perform private.offer_to_couriers(new.id, 'Entrega pronta para coleta perto de você.');
    end if;
  elsif new.status in ('cancelled', 'rejected') and old.status <> new.status then
    select * into d from public.deliveries where order_id = new.id;
    update public.deliveries set status = 'cancelled' where order_id = new.id and status in ('offered', 'accepted', 'picked_up');
    if d.courier_id is not null and d.status in ('accepted', 'picked_up') then
      perform private.notify_link(d.courier_id, 'order_update', null, '/entregador/entregas',
        'Pedido #' || new.code || ' foi ' || case when new.status = 'rejected' then 'recusado' else 'cancelado' end || ' pelo estabelecimento. Entrega cancelada.');
    end if;
  end if;
  return null;
end $$;

-- antes de "pronto", ofertas vencidas só se renovam (sem alerta); rodadas e alertas contam depois de pronto
create or replace function private.sweep_deliveries() returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; n int := 0; code text; ost public.order_status; ready_at timestamptz;
begin
  for d in select * from public.deliveries where status = 'offered' and offer_expires_at < now() for update skip locked loop
    select o.code, o.status into code, ost from public.orders o where o.id = d.order_id;
    if ost in ('placed', 'accepted', 'preparing') then
      update public.deliveries set offer_expires_at = now() + private.offer_window() where order_id = d.order_id;
    elsif d.offer_round < private.offer_max_rounds() then
      update public.deliveries set offer_round = offer_round + 1, offer_expires_at = now() + private.offer_window() where order_id = d.order_id;
      perform private.offer_to_couriers(d.order_id, 'Entrega ainda aguardando entregador perto de você.');
    elsif d.attention_reason is null then
      update public.deliveries set attention_reason = 'Sem entregador após ' || private.offer_max_rounds() || ' rodadas de oferta', attention_at = now()
       where order_id = d.order_id;
      perform private.notify_ops(d.order_id, 'Pedido #' || code || ': nenhum entregador aceitou a entrega.');
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  for d in select dd.* from public.deliveries dd join public.orders o on o.id = dd.order_id
            where dd.status = 'accepted' and dd.attention_reason is null and o.status = 'ready'
              and greatest(dd.accepted_at, o.updated_at) < now() - private.pickup_deadline()
            for update of dd skip locked loop
    select o.code into code from public.orders o where o.id = d.order_id;
    update public.deliveries set attention_reason = 'Entregador não coletou em ' || extract(epoch from private.pickup_deadline())::int / 60 || ' min', attention_at = now()
     where order_id = d.order_id;
    perform private.notify_ops(d.order_id, 'Pedido #' || code || ': entregador ainda não coletou.');
    n := n + 1;
  end loop;
  return n;
end $$;

drop function if exists public.courier_list_offers();
create function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint, offer_expires_at timestamptz, offer_round smallint,
               order_status public.order_status, city_name text)
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); me_test boolean := private.is_test_user(c.user_id);
begin
  if not c.is_online then return; end if;
  perform private.sweep_deliveries();
  return query
    select d.order_id, b.name, b.address_line, d.courier_pay_cents, d.offered_at,
           nullif(btrim(split_part(o.delivery_address, ',', -1)), ''),
           (select count(*) from public.order_items i where i.order_id = o.id),
           d.offer_expires_at, d.offer_round, o.status, ci.name
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      join public.businesses b on b.id = d.business_id
      left join public.cities ci on ci.id = d.city_id
     where d.status = 'offered' and d.city_id = c.city_id and d.is_test = me_test
       and o.status not in ('rejected', 'cancelled')
       and not exists (select 1 from public.delivery_declines x
                        where x.order_id = d.order_id and x.courier_id = c.user_id and x.offer_round = d.offer_round)
     order by d.offered_at;
end $$;

-- coleta só depois de o estabelecimento marcar "pronto"
create or replace function public.courier_pickup_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); o public.orders%rowtype;
begin
  perform private.limit_for('delivery.action');
  select * into o from public.orders where id = _order;
  if not exists (select 1 from public.deliveries where order_id = _order and courier_id = c.user_id and status = 'accepted') then
    raise exception 'Entrega não está aceita por você.' using errcode = 'P0001';
  end if;
  if o.status <> 'ready' then
    raise exception 'O estabelecimento ainda não marcou o pedido como pronto.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'picked_up', picked_up_at = now() where order_id = _order and courier_id = c.user_id and status = 'accepted';
  update public.orders set status = 'out_for_delivery' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'out_for_delivery', c.user_id, 'Coletado pelo entregador parceiro');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' está a caminho.');
  perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' coletado pelo entregador.');
end $$;

-- entrega do entregador: endereço e contato do cliente só depois do aceite do estabelecimento
drop function if exists public.courier_my_deliveries(boolean);
create function public.courier_my_deliveries(_active boolean default true)
returns table (order_id uuid, order_code text, status public.delivery_status, business_name text, business_address text,
               business_phone text, customer_name text, customer_phone text, delivery_address text, delivery_reference text,
               payment_method public.order_payment, total_cents integer, change_for_cents integer, courier_pay_cents integer,
               accepted_at timestamptz, delivered_at timestamptz, order_status public.order_status)
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  return query
    select d.order_id, o.code, d.status, b.name, b.address_line, b.phone,
           case when o.status = 'placed' then null else o.customer_name end,
           case when o.status = 'placed' then null else o.customer_phone end,
           case when o.status = 'placed' then nullif(btrim(split_part(o.delivery_address, ',', -1)), '') else o.delivery_address end,
           case when o.status = 'placed' then null else o.delivery_reference end,
           o.payment_method, o.total_cents, o.change_for_cents, d.courier_pay_cents, d.accepted_at, d.delivered_at, o.status
      from public.deliveries d join public.orders o on o.id = d.order_id join public.businesses b on b.id = d.business_id
     where d.courier_id = c.user_id
       and ((_active and d.status in ('accepted', 'picked_up')) or (not _active and d.status = 'delivered'))
     order by coalesce(d.delivered_at, d.accepted_at) desc
     limit 100;
end $$;

-- código disponível ao cliente desde a confirmação do pedido (só ele vê; o entregador nunca recebe)
create or replace function public.my_delivery(_order uuid)
returns table (status public.delivery_status, confirmation_code text, courier_first_name text, courier_vehicle public.courier_vehicle)
language sql stable security definer set search_path = '' as $$
  select d.status,
         case when d.status in ('offered', 'accepted', 'picked_up') then private.delivery_code(d.order_id, d.code_version) end,
         split_part(c.full_name, ' ', 1), c.vehicle
    from public.deliveries d join public.orders o on o.id = d.order_id left join public.couriers c on c.user_id = d.courier_id
   where d.order_id = _order and o.customer_id = auth.uid()
$$;

-- aviso de pedido novo para a equipe traz os itens ("Pedido #ABC — 1× Cheeseburger")
create or replace function private.notify_order_staff(_order public.orders, _kind text, _message text)
returns void language plpgsql security definer set search_path = '' as $$
declare m uuid; msg text := _message; items text;
begin
  if _kind = 'order_new' then
    select string_agg(i.quantity || '× ' || i.name, ', ' order by i.name) into items from public.order_items i where i.order_id = _order.id;
    if items is not null then msg := left('Novo pedido #' || _order.code || ' — ' || items, 280); end if;
  end if;
  for m in select bm.user_id from public.business_members bm
             join public.role_permissions rp on rp.member_role = bm.member_role and rp.permission = 'orders.view'
            where bm.business_id = _order.business_id loop
    perform private.notify_link(m, _kind, _order.customer_id, '/painel/' || _order.business_id || '/pedidos', msg);
  end loop;
end $$;

-- ---------- planos e Premium ----------
create table if not exists private.plan_grants (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  plan_code text not null references public.plans(code),
  reason text not null check (char_length(reason) between 5 and 200),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
revoke all on private.plan_grants from public, anon, authenticated;

-- plano vigente: assinatura ativa; senão concessão de homologação (só lojas de teste)
create or replace function private.business_plan_code(_business uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.plan_code from public.business_subscriptions s where s.business_id = _business and s.status = 'active' and s.current_period_end >= current_date limit 1),
    (select g.plan_code from private.plan_grants g join public.businesses b on b.id = g.business_id where g.business_id = _business and b.is_test))
$$;

create or replace function public.business_has_premium(_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.business_plan_code(_business) = 'presencial_delivery', false)
$$;

create or replace function private.require_premium(_business uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.business_has_premium(_business) then
    raise exception 'Recurso do Plano Premium (R$ 99/mês). Fale com a Tucaí para mudar de plano.' using errcode = '42501';
  end if;
end $$;

create or replace function public.business_plan(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_code text; src text; s public.business_subscriptions%rowtype;
begin
  if not (public.is_business_member(_business) or public.has_platform_permission('finance.view')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into s from public.business_subscriptions where business_id = _business and status = 'active' and current_period_end >= current_date limit 1;
  if found then v_code := s.plan_code; src := 'assinatura';
  else
    select g.plan_code into v_code from private.plan_grants g join public.businesses b on b.id = g.business_id where g.business_id = _business and b.is_test;
    src := case when v_code is null then null else 'homologacao' end;
  end if;
  return jsonb_build_object('plan_code', v_code, 'plan_name', (select p.name from public.plans p where p.code = v_code),
                            'premium', coalesce(v_code = 'presencial_delivery', false), 'source', src,
                            'period_end', case when src = 'assinatura' then s.current_period_end end);
end $$;

create or replace function public.admin_grant_test_plan(_business uuid, _plan text, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.plan_grant');
  if not exists (select 1 from public.businesses where id = _business and is_test) then
    raise exception 'Concessão de plano sem cobrança só para estabelecimentos de homologação.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.plans where code = _plan) then raise exception 'Plano inválido.' using errcode = 'P0001'; end if;
  insert into private.plan_grants(business_id, plan_code, reason, granted_by) values (_business, _plan, btrim(_reason), auth.uid())
  on conflict (business_id) do update set plan_code = excluded.plan_code, reason = excluded.reason, granted_by = excluded.granted_by, created_at = now();
  perform private.audit('plan.test_grant', 'businesses', _business::text, jsonb_build_object('plan', _plan, 'reason', btrim(_reason)));
end $$;

create or replace function public.admin_revoke_test_plan(_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  delete from private.plan_grants where business_id = _business;
  if not found then raise exception 'Sem concessão para este estabelecimento.' using errcode = 'P0001'; end if;
  perform private.audit('plan.test_revoke', 'businesses', _business::text, '{}'::jsonb);
end $$;

create or replace function public.admin_plan_grants()
returns table (business_id uuid, business_name text, plan_code text, plan_name text, reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  return query select g.business_id, b.name, g.plan_code, p.name, g.reason, g.created_at
    from private.plan_grants g join public.businesses b on b.id = g.business_id join public.plans p on p.code = g.plan_code
   order by g.created_at desc;
end $$;

-- lojista pede mudança de plano (upgrade/downgrade): a Tucaí é avisada; dados nunca são apagados no downgrade
create or replace function public.merchant_request_plan_change(_business uuid, _plan text) returns void
language plpgsql security definer set search_path = '' as $$
declare m uuid; bname text; pname text;
begin
  if not public.has_business_permission(_business, 'settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.plan_request');
  select name into pname from public.plans where code = _plan and is_active;
  if pname is null then raise exception 'Plano inválido.' using errcode = 'P0001'; end if;
  select name into bname from public.businesses where id = _business;
  for m in select user_id from public.user_roles where role = 'platform_master' loop
    perform private.notify_link(m, 'ops_alert', null, '/admin/financeiro', left(bname || ' pediu o plano ' || pname || '.', 280));
  end loop;
  perform private.audit('plan.change_request', 'businesses', _business::text, jsonb_build_object('plan', _plan));
end $$;

-- homologação: o Mercadinho de teste recebe Premium (concessão explícita, auditada, sem cobrança)
do $$
declare b uuid;
begin
  for b in select id from public.businesses where is_test and business_type = 'loja' and name like '[Teste] Mercadinho%' loop
    insert into private.plan_grants(business_id, plan_code, reason) values (b, 'presencial_delivery', 'Homologação: Mercadinho de teste com todos os recursos')
    on conflict (business_id) do nothing;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (null, 'plan.test_grant', 'businesses', b::text, '{"plan":"presencial_delivery","reason":"Homologação (migração 0026)"}'::jsonb);
  end loop;
end $$;

create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[]; b uuid;
begin
  res := private.admin_create_test_data_impl(_city);
  select business_ids into ids from private.test_data_runs where id = (res->>'run_id')::uuid;
  perform private.label_test_businesses(ids);
  perform private.prepare_test_mercadinho(ids);
  for b in select id from public.businesses where id = any(ids) and business_type = 'loja' and name like '[Teste] Mercadinho%'
             and not exists (select 1 from private.plan_grants g where g.business_id = businesses.id) loop
    perform public.admin_grant_test_plan(b, 'presencial_delivery', 'Homologação: Mercadinho de teste com todos os recursos');
  end loop;
  return res;
end $$;

-- recursos Premium bloqueados também na leitura/gravação direta das tabelas
drop policy if exists business_expenses_rw on public.business_expenses;
create policy business_expenses_rw on public.business_expenses for all to authenticated
  using (public.has_business_permission(business_id, 'reports.view') and public.business_has_premium(business_id))
  with check (public.has_business_permission(business_id, 'reports.view') and public.business_has_premium(business_id));
drop policy if exists business_product_costs_rw on public.business_product_costs;
create policy business_product_costs_rw on public.business_product_costs for all to authenticated
  using (public.has_business_permission(business_id, 'reports.view') and public.business_has_premium(business_id))
  with check (public.has_business_permission(business_id, 'reports.view') and public.business_has_premium(business_id)
              and exists (select 1 from public.products p where p.id = business_product_costs.product_id and p.business_id = business_product_costs.business_id));

-- ---------- calculadora de custos ----------
alter table public.business_product_costs
  add column if not exists packaging_cents integer not null default 0 check (packaging_cents between 0 and 10000000),
  add column if not exists operational_cents integer not null default 0 check (operational_cents between 0 and 10000000),
  add column if not exists target_margin_bps integer not null default 3000 check (target_margin_bps between 0 and 9000);
alter table public.business_product_costs alter column cost_cents set default 0;

create table if not exists public.business_ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  unit text not null check (unit in ('un', 'kg', 'g', 'l', 'ml')),
  purchase_cost_cents integer not null check (purchase_cost_cents > 0 and purchase_cost_cents <= 100000000),
  purchase_qty numeric(12, 3) not null check (purchase_qty > 0),
  updated_at timestamptz not null default now()
);
create index if not exists business_ingredients_business_idx on public.business_ingredients(business_id, name);

create table if not exists public.product_recipe_items (
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.business_ingredients(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  quantity numeric(12, 3) not null check (quantity > 0),
  primary key (product_id, ingredient_id)
);
create index if not exists product_recipe_items_ingredient_idx on public.product_recipe_items(ingredient_id);
create index if not exists product_recipe_items_business_idx on public.product_recipe_items(business_id);

create table if not exists public.business_costing_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  price_cents integer not null,
  cost_cents integer not null,
  fee_cents integer not null,
  margin_cents integer not null,
  margin_bps integer not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_costing_snapshots_business_idx on public.business_costing_snapshots(business_id, created_at desc);
create index if not exists business_costing_snapshots_product_idx on public.business_costing_snapshots(product_id);
create index if not exists business_costing_snapshots_created_by_idx on public.business_costing_snapshots(created_by);

do $$
declare t text;
begin
  foreach t in array array['business_ingredients', 'product_recipe_items', 'business_costing_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_business_permission(business_id, %L) and public.business_has_premium(business_id)) with check (public.has_business_permission(business_id, %L) and public.business_has_premium(business_id))',
                   t || '_rw', t, 'reports.view', 'reports.view');
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- custo unitário do produto: ficha técnica (se houver) senão custo informado; + embalagem + operacional
create or replace function private.product_unit_cost(_product uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (coalesce(
            (select round(sum(r.quantity * i.purchase_cost_cents / i.purchase_qty))::int
               from public.product_recipe_items r join public.business_ingredients i on i.id = r.ingredient_id where r.product_id = _product),
            (select c.cost_cents from public.business_product_costs c where c.product_id = _product))
          + coalesce((select c.packaging_cents + c.operational_cents from public.business_product_costs c where c.product_id = _product), 0))
$$;

create or replace function public.merchant_costing(_business uuid)
returns table (product_id uuid, name text, price_cents integer, recipe_cents integer, manual_cents integer, packaging_cents integer,
               operational_cents integer, unit_cost_cents integer, fee_cents integer, margin_cents integer, margin_bps integer,
               target_margin_bps integer, suggested_price_cents integer, has_cost boolean, ingredients bigint)
language plpgsql stable security definer set search_path = '' as $$
declare cfg jsonb; bps int; thr int;
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_premium(_business);
  select config into cfg from public.pricing_configs where is_current;
  bps := coalesce((cfg->>'commissionBps')::int, 200); thr := coalesce((cfg->>'commissionThresholdCents')::int, 5000);
  return query
    with base as (
      select p.id, p.name, p.price_cents,
             (select round(sum(r.quantity * i.purchase_cost_cents / i.purchase_qty))::int
                from public.product_recipe_items r join public.business_ingredients i on i.id = r.ingredient_id where r.product_id = p.id) as recipe,
             c.cost_cents as manual, coalesce(c.packaging_cents, 0) as pack, coalesce(c.operational_cents, 0) as op,
             coalesce(c.target_margin_bps, 3000) as target,
             (select count(*) from public.product_recipe_items r where r.product_id = p.id) as ing
        from public.products p left join public.business_product_costs c on c.product_id = p.id
       where p.business_id = _business and not p.is_demo)
    select b.id, b.name, b.price_cents, b.recipe, b.manual, b.pack, b.op,
           coalesce(b.recipe, b.manual, 0) + b.pack + b.op,
           -- comissão estimada: 2% quando o pedido passa de R$ 50 (aqui, se o próprio item já passa)
           case when b.price_cents > thr then round(b.price_cents * bps / 10000.0)::int else 0 end,
           b.price_cents - (coalesce(b.recipe, b.manual, 0) + b.pack + b.op) - case when b.price_cents > thr then round(b.price_cents * bps / 10000.0)::int else 0 end,
           case when b.price_cents > 0 then round((b.price_cents - (coalesce(b.recipe, b.manual, 0) + b.pack + b.op)
                                                   - case when b.price_cents > thr then round(b.price_cents * bps / 10000.0)::int else 0 end) * 10000.0 / b.price_cents)::int else 0 end,
           b.target,
           case when b.target < 10000 then ceil((coalesce(b.recipe, b.manual, 0) + b.pack + b.op) / (1 - b.target / 10000.0))::int end,
           (b.recipe is not null or b.manual is not null), b.ing
      from base b order by b.name;
end $$;

create or replace function public.merchant_save_costing_snapshot(_business uuid, _product uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r record; sid uuid;
begin
  perform private.limit_for('merchant.costing');
  select * into r from public.merchant_costing(_business) x where x.product_id = _product;
  if r.product_id is null then raise exception 'Produto não encontrado.' using errcode = 'P0001'; end if;
  insert into public.business_costing_snapshots(business_id, product_id, product_name, price_cents, cost_cents, fee_cents, margin_cents, margin_bps, created_by)
  values (_business, _product, r.name, r.price_cents, r.unit_cost_cents, r.fee_cents, r.margin_cents, r.margin_bps, auth.uid())
  returning id into sid;
  return sid;
end $$;

-- Meu Lucro (Premium): custo dos itens pela ficha técnica/custo informado
create or replace function public.merchant_finance(_business uuid, _from date, _to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
        today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_premium(_business);
  if _from is null or _to is null or _to < _from or _to - _from > 366 then raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001'; end if;
  return (
    with done as (select * from public.orders where business_id = _business and status in ('delivered', 'picked_up')),
    per as (select * from done where updated_at >= f and updated_at < t),
    items as (
      select i.quantity, i.line_total_cents, case when i.product_id is null then null else private.product_unit_cost(i.product_id) end as unit_cost
        from public.order_items i join per o on o.id = i.order_id),
    exp as (
      select e.*, case
               when e.recurrence = 'unica' then (case when e.spent_on between _from and _to then 1 else 0 end)
               when e.spent_on > _to then 0
               else ((extract(year from _to) * 12 + extract(month from _to))
                     - (extract(year from greatest(e.spent_on, _from)) * 12 + extract(month from greatest(e.spent_on, _from))) + 1)::int
             end as times
        from public.business_expenses e where e.business_id = _business)
    select jsonb_build_object(
      'hoje_cents', coalesce((select sum(subtotal_cents) from done where updated_at >= today), 0),
      'mes_cents', coalesce((select sum(subtotal_cents) from done where updated_at >= month), 0),
      'pedidos', (select count(*) from per),
      'ticket_medio_cents', coalesce((select round(avg(subtotal_cents)) from per), 0)::int,
      'cancelados', (select count(*) from public.orders where business_id = _business and status in ('rejected', 'cancelled') and updated_at >= f and updated_at < t),
      'faturamento_bruto_cents', coalesce((select sum(subtotal_cents + case when fulfillment = 'delivery_own' then delivery_fee_cents else 0 end) from per), 0),
      'comissao_cents', coalesce((select sum(commission_cents) from per), 0),
      'taxas_entrega_cents', coalesce((select sum(merchant_delivery_contribution_cents + platform_delivery_fee_cents) from per), 0),
      'custo_produtos_cents', coalesce((select sum(quantity * unit_cost) from items where unit_cost is not null), 0),
      'itens_sem_custo', (select count(*) from items where unit_cost is null),
      'vendas_itens_com_custo_cents', coalesce((select sum(line_total_cents) from items where unit_cost is not null), 0),
      'despesas_cents', coalesce((select sum(amount_cents * times) from exp), 0),
      'despesas_por_categoria', coalesce((select jsonb_object_agg(category, total) from (select category, sum(amount_cents * times) as total from exp where times > 0 group by category) x), '{}'::jsonb),
      'recebido_na_entrega_cents', coalesce((select sum(total_cents) from per where fulfillment <> 'delivery_partner'), 0),
      'caixa_hoje', coalesce((select jsonb_object_agg(payment_method, total) from (select payment_method, sum(total_cents) as total from done where updated_at >= today group by payment_method) x), '{}'::jsonb)));
end $$;

-- ---------- visão geral (todos os planos) ----------
create or replace function public.merchant_overview(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        premium boolean := public.business_has_premium(_business);
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with o as (select * from public.orders where business_id = _business and created_at >= month - interval '14 days')
    select jsonb_build_object(
      'premium', premium,
      'recebidos_hoje', (select count(*) from o where created_at >= today),
      'concluidos_hoje', (select count(*) from o where status in ('delivered', 'picked_up') and updated_at >= today),
      'cancelados_hoje', (select count(*) from o where status in ('rejected', 'cancelled') and updated_at >= today),
      'em_andamento', (select count(*) from public.orders x where x.business_id = _business and x.status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery')),
      'faturamento_hoje_cents', coalesce((select sum(subtotal_cents) from o where status in ('delivered', 'picked_up') and updated_at >= today), 0),
      'faturamento_mes_cents', coalesce((select sum(subtotal_cents) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0),
      'ticket_medio_cents', coalesce((select round(avg(subtotal_cents)) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0)::int,
      'recebido_mes_cents', coalesce((select sum(total_cents) from o where status in ('delivered', 'picked_up') and updated_at >= month and fulfillment <> 'delivery_partner'), 0),
      'pendente_cents', coalesce((select sum(total_cents) from public.orders x where x.business_id = _business and x.status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery')), 0),
      'taxas_mes_cents', coalesce((select sum(commission_cents + merchant_delivery_contribution_cents + platform_delivery_fee_cents) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0),
      'despesas_mes_cents', case when premium then coalesce((select sum(amount_cents) from public.business_expenses e where e.business_id = _business
                                   and (e.recurrence = 'mensal' and e.spent_on < (month + interval '1 month') or e.spent_on >= month::date)), 0) end,
      'serie', coalesce((select jsonb_agg(jsonb_build_object('dia', d::date, 'cents', coalesce((select sum(subtotal_cents) from o
                           where status in ('delivered', 'picked_up') and (updated_at at time zone 'America/Sao_Paulo')::date = d::date), 0)) order by d)
                          from generate_series((now() at time zone 'America/Sao_Paulo')::date - 13, (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') d), '[]'::jsonb)));
end $$;

-- ---------- equipe da loja ----------
create table if not exists private.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  member_role public.member_role not null check (member_role <> 'owner'),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz
);
create unique index if not exists business_invites_open_idx on private.business_invites(business_id, email) where accepted_at is null and revoked_at is null;
revoke all on private.business_invites from public, anon, authenticated;

create or replace function public.merchant_invite_member(_business uuid, _email text, _role public.member_role) returns text
language plpgsql security definer set search_path = '' as $$
declare e text := lower(btrim(coalesce(_email, ''))); u uuid;
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _role = 'owner' then raise exception 'O proprietário não é convidado pela equipe.' using errcode = 'P0001'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.' using errcode = 'P0001'; end if;
  select id into u from auth.users where lower(email) = e;
  if u is not null then
    if exists (select 1 from public.business_members where business_id = _business and user_id = u) then
      raise exception 'Esta pessoa já faz parte da equipe.' using errcode = 'P0001';
    end if;
    insert into public.business_members(business_id, user_id, member_role) values (_business, u, _role);
    perform private.audit('business.member_add', 'business_members', _business::text, jsonb_build_object('user', u, 'role', _role));
    return 'vinculado';
  end if;
  update private.business_invites set revoked_at = now() where business_id = _business and email = e and accepted_at is null and revoked_at is null;
  insert into private.business_invites(business_id, email, member_role, invited_by) values (_business, e, _role, auth.uid());
  perform private.audit('business.member_invite', 'business_invites', _business::text, jsonb_build_object('email', e, 'role', _role));
  return 'convidado';
end $$;

create or replace function public.merchant_team(_business uuid)
returns table (user_id uuid, name text, email text, member_role public.member_role, pending boolean, invite_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.user_id, p.full_name, u.email::text, m.member_role, false, null::uuid, m.created_at
      from public.business_members m left join public.profiles p on p.id = m.user_id left join auth.users u on u.id = m.user_id
     where m.business_id = _business
    union all
    select null, null, i.email, i.member_role, true, i.id, i.created_at
      from private.business_invites i where i.business_id = _business and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     order by 7;
end $$;

create or replace function public.merchant_set_member_role(_business uuid, _user uuid, _role public.member_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _role = 'owner' then raise exception 'A propriedade não é transferida por aqui.' using errcode = 'P0001'; end if;
  update public.business_members set member_role = _role where business_id = _business and user_id = _user and member_role <> 'owner';
  if not found then raise exception 'Integrante não encontrado (o proprietário não pode ser alterado).' using errcode = 'P0001'; end if;
  perform private.audit('business.member_role', 'business_members', _business::text, jsonb_build_object('user', _user, 'role', _role));
end $$;

create or replace function public.merchant_remove_member(_business uuid, _user uuid, _invite uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _invite is not null then
    update private.business_invites set revoked_at = now() where id = _invite and business_id = _business and accepted_at is null and revoked_at is null;
    if not found then raise exception 'Convite não encontrado.' using errcode = 'P0001'; end if;
    perform private.audit('business.member_invite_revoke', 'business_invites', _business::text, jsonb_build_object('invite', _invite));
    return;
  end if;
  if _user = auth.uid() then raise exception 'Você não pode remover a si mesmo.' using errcode = 'P0001'; end if;
  delete from public.business_members where business_id = _business and user_id = _user and member_role <> 'owner';
  if not found then raise exception 'Integrante não encontrado (o proprietário não pode ser removido).' using errcode = 'P0001'; end if;
  perform private.audit('business.member_remove', 'business_members', _business::text, jsonb_build_object('user', _user));
end $$;

-- ao ativar a conta pelo link, o convite da loja é aplicado
create or replace function private.claim_business_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i private.business_invites%rowtype;
begin
  if new.email_confirmed_at is null or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then return new; end if;
  for i in select * from private.business_invites where email = lower(new.email) and accepted_at is null and revoked_at is null and expires_at > now() loop
    insert into public.business_members(business_id, user_id, member_role) values (i.business_id, new.id, i.member_role) on conflict do nothing;
    update private.business_invites set accepted_at = now() where id = i.id;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (new.id, 'business.member_invite_accept', 'business_members', i.business_id::text, jsonb_build_object('role', i.member_role));
  end loop;
  return new;
end $$;
drop trigger if exists claim_business_invites on auth.users;
create trigger claim_business_invites after insert or update of email_confirmed_at on auth.users
  for each row execute function private.claim_business_invites();

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array['private.orders_offer_on_insert()', 'private.orders_delivery_sync()', 'private.sweep_deliveries()',
                           'private.notify_order_staff(public.orders, text, text)',
                           'private.business_plan_code(uuid)', 'private.require_premium(uuid)', 'private.product_unit_cost(uuid)',
                           'private.claim_business_invites()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.courier_list_offers()', 'public.courier_pickup_delivery(uuid)', 'public.courier_my_deliveries(boolean)', 'public.my_delivery(uuid)',
    'public.business_has_premium(uuid)', 'public.business_plan(uuid)', 'public.admin_grant_test_plan(uuid, text, text)',
    'public.admin_revoke_test_plan(uuid)', 'public.admin_plan_grants()', 'public.merchant_request_plan_change(uuid, text)',
    'public.admin_create_test_data(uuid)', 'public.merchant_costing(uuid)', 'public.merchant_save_costing_snapshot(uuid, uuid)',
    'public.merchant_finance(uuid, date, date)', 'public.merchant_overview(uuid)', 'public.merchant_invite_member(uuid, text, public.member_role)',
    'public.merchant_team(uuid)', 'public.merchant_set_member_role(uuid, uuid, public.member_role)', 'public.merchant_remove_member(uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0026', '0026_painel_empresarial.sql', 'applied');
    raise notice 'Tucaí 0026: aplicada agora';
  end if;
end $tucai_0026$;

-- ===================== supabase/migrations/0027_gestao_mesas_caixa.sql =====================
do $tucai_0027$
begin
  if exists (select 1 from private.tucai_migrations where version = '0027') then
    raise notice 'Tucaí 0027: já aplicada';
  else
    execute $tucai_sql$
-- 0027_gestao_mesas_caixa: Tucaí Gestão (atendimento presencial).
--  * Permissões extras por integrante (sem criar cargo novo): "comandas" (tabs.manage) e "caixa" (cash.manage),
--    somadas às do cargo. Ex.: atendente + caixa = operador de caixa.
--  * Mesas (com área, capacidade e QR próprio), comandas com ou sem mesa (balcão), itens com preço do servidor,
--    envio à cozinha, transferências, fechamento com pagamento registrado no caixa. Uma mesa nunca tem duas
--    comandas abertas; operações com identificador para não duplicar; cancelamentos e descontos auditados.
--  * Caixa presencial: turno (um aberto por estabelecimento), saldo inicial, vendas, entradas, saídas, sangrias,
--    suprimentos, fechamento com valor contado e diferença. Registro manual ≠ confirmação eletrônica.
--  * QR da mesa: só identifica mesa e cardápio público; nunca dá acesso administrativo.
--  * Recursos presenciais: Plano Premium (R$ 99), verificado no banco.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('gestao.tabs', 1200, 600), ('gestao.cash', 600, 600), ('gestao.tables', 300, 600)
on conflict (action) do nothing;

insert into public.permissions(code) values ('tabs.manage'), ('cash.manage') on conflict do nothing;
insert into public.role_permissions(member_role, permission) values
  ('owner', 'tabs.manage'), ('owner', 'cash.manage'), ('manager', 'tabs.manage'), ('manager', 'cash.manage'), ('attendant', 'tabs.manage')
on conflict do nothing;

create table if not exists public.business_member_permissions (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('tabs.manage', 'cash.manage', 'reports.view')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id, permission)
);
create index if not exists business_member_permissions_user_idx on public.business_member_permissions(user_id);
create index if not exists business_member_permissions_granted_by_idx on public.business_member_permissions(granted_by);
alter table public.business_member_permissions enable row level security;
drop policy if exists business_member_permissions_select on public.business_member_permissions;
create policy business_member_permissions_select on public.business_member_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_business_permission(business_id, 'staff.manage'));
revoke all on public.business_member_permissions from public, anon, authenticated;
grant select on public.business_member_permissions to authenticated;

-- permissão = cargo + extras do integrante (extras só valem para quem continua na equipe)
create or replace function public.has_business_permission(_business uuid, _permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    join public.role_permissions rp on rp.member_role = m.member_role
    where m.business_id = _business and m.user_id = auth.uid() and rp.permission = _permission)
  or exists (
    select 1 from public.business_member_permissions x
    join public.business_members m on m.business_id = x.business_id and m.user_id = x.user_id
    where x.business_id = _business and x.user_id = auth.uid() and x.permission = _permission)
$$;

create or replace function public.merchant_set_member_permission(_business uuid, _user uuid, _permission text, _granted boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _permission not in ('tabs.manage', 'cash.manage', 'reports.view') then raise exception 'Permissão inválida.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.business_members where business_id = _business and user_id = _user and member_role <> 'owner') then
    raise exception 'Integrante não encontrado.' using errcode = 'P0001';
  end if;
  if _granted then
    insert into public.business_member_permissions(business_id, user_id, permission, granted_by) values (_business, _user, _permission, auth.uid()) on conflict do nothing;
  else
    delete from public.business_member_permissions where business_id = _business and user_id = _user and permission = _permission;
  end if;
  perform private.audit(case when _granted then 'business.member_permission_grant' else 'business.member_permission_revoke' end,
                        'business_member_permissions', _business::text, jsonb_build_object('user', _user, 'permission', _permission));
end $$;

-- ---------- mesas ----------
create table if not exists public.business_tables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  area text check (area is null or char_length(area) <= 40),
  capacity smallint check (capacity is null or capacity between 1 and 99),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  qr_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists business_tables_business_idx on public.business_tables(business_id, sort_order);

-- ---------- comandas ----------
create table if not exists public.business_tabs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  number integer not null,
  table_id uuid references public.business_tables(id) on delete set null,
  label text check (label is null or char_length(label) <= 60),
  people smallint check (people is null or people between 1 and 99),
  status text not null default 'aberta' check (status in ('aberta', 'aguardando_pagamento', 'fechada', 'cancelada')),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  close_op uuid unique,
  unique (business_id, number)
);
-- uma mesa nunca tem duas comandas abertas
create unique index if not exists business_tabs_table_open_idx on public.business_tabs(table_id) where status in ('aberta', 'aguardando_pagamento') and table_id is not null;
create index if not exists business_tabs_business_idx on public.business_tabs(business_id, status, opened_at desc);
create index if not exists business_tabs_table_idx on public.business_tabs(table_id);
create index if not exists business_tabs_opened_by_idx on public.business_tabs(opened_by);
create index if not exists business_tabs_closed_by_idx on public.business_tabs(closed_by);

create table if not exists public.business_tab_items (
  id uuid primary key default gen_random_uuid(),
  tab_id uuid not null references public.business_tabs(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity smallint not null check (quantity between 1 and 99),
  notes text check (notes is null or char_length(notes) <= 200),
  kitchen_status text not null default 'novo' check (kitchen_status in ('novo', 'em_preparo', 'pronto', 'servido', 'cancelado')),
  add_op uuid,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200)
);
create unique index if not exists business_tab_items_op_idx on public.business_tab_items(tab_id, add_op, product_id) where add_op is not null;
create index if not exists business_tab_items_tab_idx on public.business_tab_items(tab_id);
create index if not exists business_tab_items_kitchen_idx on public.business_tab_items(business_id, kitchen_status);
create index if not exists business_tab_items_product_idx on public.business_tab_items(product_id);
create index if not exists business_tab_items_added_by_idx on public.business_tab_items(added_by);

-- ---------- caixa ----------
create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  opening_cents integer not null check (opening_cents >= 0),
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  counted_cents integer check (counted_cents is null or counted_cents >= 0),
  expected_cents integer,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 300)
);
create unique index if not exists cash_sessions_open_idx on public.cash_sessions(business_id) where status = 'aberto';
create index if not exists cash_sessions_business_idx on public.cash_sessions(business_id, opened_at desc);
create index if not exists cash_sessions_opened_by_idx on public.cash_sessions(opened_by);
create index if not exists cash_sessions_closed_by_idx on public.cash_sessions(closed_by);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_sessions(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('venda', 'entrada', 'saida', 'sangria', 'suprimento')),
  method text not null check (method in ('dinheiro', 'pix', 'cartao', 'outro')),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  confirmation text not null default 'manual' check (confirmation in ('manual', 'eletronica')),
  tab_id uuid references public.business_tabs(id) on delete set null,
  description text check (description is null or char_length(description) <= 200),
  op_id uuid not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_session_idx on public.cash_movements(session_id, created_at);
create index if not exists cash_movements_business_idx on public.cash_movements(business_id);
create index if not exists cash_movements_tab_idx on public.cash_movements(tab_id);
create index if not exists cash_movements_created_by_idx on public.cash_movements(created_by);

-- leitura direta pela equipe autorizada; toda escrita passa pelas funções
do $$
declare t text; p text;
begin
  foreach t in array array['business_tables', 'business_tabs', 'business_tab_items', 'cash_sessions', 'cash_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    p := case when t like 'cash_%' then 'cash.manage' else 'tabs.manage' end;
    execute format($f$create policy %I on public.%I for select to authenticated using (public.has_business_permission(business_id, %L)
                     or public.has_business_permission(business_id, 'orders.update_status')%s)$f$,
                   t || '_select', t, p, case when t like 'cash_%' then '' else ' or public.has_business_permission(business_id, ''cash.manage'')' end);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function private.require_gestao(_business uuid, _permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, _permission) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_premium(_business);
end $$;

-- mesas
create or replace function public.gestao_save_table(_business uuid, _id uuid, _name text, _area text, _capacity integer, _active boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  perform private.require_gestao(_business, 'settings.manage');
  perform private.limit_for('gestao.tables');
  if _id is null then
    insert into public.business_tables(business_id, name, area, capacity, is_active, sort_order)
    values (_business, btrim(_name), nullif(btrim(coalesce(_area, '')), ''), _capacity, coalesce(_active, true),
            coalesce((select max(sort_order) + 10 from public.business_tables where business_id = _business), 10))
    returning id into tid;
  else
    update public.business_tables set name = btrim(_name), area = nullif(btrim(coalesce(_area, '')), ''), capacity = _capacity, is_active = coalesce(_active, true)
     where id = _id and business_id = _business returning id into tid;
    if tid is null then raise exception 'Mesa não encontrada.' using errcode = 'P0001'; end if;
  end if;
  perform private.audit('gestao.table_save', 'business_tables', tid::text, jsonb_build_object('name', btrim(_name)));
  return tid;
exception when unique_violation then
  raise exception 'Já existe uma mesa com esse nome.' using errcode = 'P0001';
end $$;

-- cria várias mesas de uma vez ("Mesa 01" … "Mesa N"), sem limite fixo de quantidade
create or replace function public.gestao_create_tables(_business uuid, _count integer, _area text default null, _capacity integer default 4)
returns integer language plpgsql security definer set search_path = '' as $$
declare i int; n int := 0; base int;
begin
  perform private.require_gestao(_business, 'settings.manage');
  perform private.limit_for('gestao.tables');
  if _count is null or _count not between 1 and 300 then raise exception 'Informe de 1 a 300 mesas por vez.' using errcode = 'P0001'; end if;
  select count(*) into base from public.business_tables where business_id = _business;
  for i in 1.._count loop
    insert into public.business_tables(business_id, name, area, capacity, sort_order)
    values (_business, 'Mesa ' || lpad((base + i)::text, 2, '0'), nullif(btrim(coalesce(_area, '')), ''), _capacity, (base + i) * 10)
    on conflict (business_id, name) do nothing;
    n := n + 1;
  end loop;
  perform private.audit('gestao.tables_create', 'business_tables', _business::text, jsonb_build_object('count', _count));
  return n;
end $$;

-- comandas
create or replace function public.gestao_open_tab(_business uuid, _table uuid default null, _label text default null, _people integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; num int;
begin
  perform private.require_gestao(_business, 'tabs.manage');
  perform private.limit_for('gestao.tabs');
  if _table is not null and not exists (select 1 from public.business_tables where id = _table and business_id = _business and is_active) then
    raise exception 'Mesa não encontrada.' using errcode = 'P0001';
  end if;
  if _table is null and nullif(btrim(coalesce(_label, '')), '') is null then
    raise exception 'Comanda de balcão precisa de um nome ou identificação.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('tabs:' || _business::text));
  select coalesce(max(number), 0) + 1 into num from public.business_tabs where business_id = _business;
  insert into public.business_tabs(business_id, number, table_id, label, people, opened_by)
  values (_business, num, _table, nullif(btrim(coalesce(_label, '')), ''), _people, auth.uid()) returning id into tid;
  perform private.audit('gestao.tab_open', 'business_tabs', tid::text, jsonb_build_object('number', num, 'table', _table));
  return tid;
exception when unique_violation then
  raise exception 'Esta mesa já tem uma comanda aberta.' using errcode = 'P0001';
end $$;

-- adicionar itens (preço do cardápio, no servidor); a mesma operação repetida não duplica
create or replace function public.gestao_add_items(_tab uuid, _items jsonb, _op uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype; it jsonb; p public.products%rowtype; qty int; n int := 0;
begin
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'tabs.manage');
  perform private.limit_for('gestao.tabs');
  if t.status <> 'aberta' then raise exception 'A comanda não está aberta para novos itens.' using errcode = 'P0001'; end if;
  if _op is null then raise exception 'Operação inválida.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.business_tab_items where tab_id = _tab and add_op = _op) then return 0; end if;
  if jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) not between 1 and 50 then raise exception 'Informe de 1 a 50 itens.' using errcode = 'P0001'; end if;
  for it in select * from jsonb_array_elements(_items) loop
    select * into p from public.products where id = (it->>'product_id')::uuid and business_id = t.business_id;
    if not found or not p.is_available then raise exception 'Produto indisponível.' using errcode = 'P0001'; end if;
    qty := coalesce((it->>'quantity')::int, 0);
    if qty not between 1 and 99 then raise exception 'Quantidade inválida para %.', p.name using errcode = 'P0001'; end if;
    insert into public.business_tab_items(tab_id, business_id, product_id, name, unit_price_cents, quantity, notes, add_op, added_by)
    values (_tab, t.business_id, p.id, p.name, p.price_cents, qty, nullif(left(btrim(coalesce(it->>'notes', '')), 200), ''), _op, auth.uid());
    n := n + 1;
  end loop;
  update public.business_tabs set last_activity_at = now() where id = _tab;
  return n;
end $$;

-- cozinha/atendimento: novo → em preparo → pronto → servido (ordem obrigatória)
create or replace function public.gestao_item_status(_item uuid, _status text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.business_tab_items%rowtype; ok boolean;
begin
  select * into i from public.business_tab_items where id = _item for update;
  if not found then raise exception 'Item não encontrado.' using errcode = 'P0001'; end if;
  if not (public.has_business_permission(i.business_id, 'tabs.manage') or public.has_business_permission(i.business_id, 'orders.update_status')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_premium(i.business_id);
  ok := (i.kitchen_status = 'novo' and _status = 'em_preparo') or (i.kitchen_status = 'em_preparo' and _status = 'pronto')
     or (i.kitchen_status = 'pronto' and _status = 'servido');
  if not ok then raise exception 'Mudança não permitida (% → %).', i.kitchen_status, _status using errcode = 'P0001'; end if;
  update public.business_tab_items set kitchen_status = _status, updated_at = now() where id = _item;
  update public.business_tabs set last_activity_at = now() where id = i.tab_id;
end $$;

create or replace function public.gestao_cancel_item(_item uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.business_tab_items%rowtype; r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  select * into i from public.business_tab_items where id = _item for update;
  if not found then raise exception 'Item não encontrado.' using errcode = 'P0001'; end if;
  perform private.require_gestao(i.business_id, 'tabs.manage');
  if r is null then raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001'; end if;
  if i.kitchen_status = 'cancelado' then raise exception 'Item já cancelado.' using errcode = 'P0001'; end if;
  if (select status from public.business_tabs where id = i.tab_id) not in ('aberta', 'aguardando_pagamento') then raise exception 'Comanda encerrada.' using errcode = 'P0001'; end if;
  update public.business_tab_items set kitchen_status = 'cancelado', cancel_reason = r, updated_at = now() where id = _item;
  perform private.audit('gestao.item_cancel', 'business_tab_items', _item::text, jsonb_build_object('reason', r, 'item', i.name, 'value', i.unit_price_cents * i.quantity));
end $$;

create or replace function public.gestao_transfer_tab(_tab uuid, _table uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype;
begin
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'tabs.manage');
  if t.status not in ('aberta', 'aguardando_pagamento') then raise exception 'Comanda encerrada.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.business_tables where id = _table and business_id = t.business_id and is_active) then raise exception 'Mesa não encontrada.' using errcode = 'P0001'; end if;
  update public.business_tabs set table_id = _table, last_activity_at = now() where id = _tab;
  perform private.audit('gestao.tab_transfer', 'business_tabs', _tab::text, jsonb_build_object('from', t.table_id, 'to', _table));
exception when unique_violation then
  raise exception 'A mesa de destino já tem uma comanda aberta.' using errcode = 'P0001';
end $$;

-- move itens para outra comanda aberta (com confirmação na tela)
create or replace function public.gestao_transfer_items(_items uuid[], _to_tab uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype; n int;
begin
  select * into t from public.business_tabs where id = _to_tab for update;
  if not found or t.status <> 'aberta' then raise exception 'Comanda de destino não está aberta.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'tabs.manage');
  update public.business_tab_items i set tab_id = _to_tab, updated_at = now()
   where i.id = any(_items) and i.business_id = t.business_id and i.kitchen_status <> 'cancelado'
     and exists (select 1 from public.business_tabs s where s.id = i.tab_id and s.status in ('aberta', 'aguardando_pagamento'));
  get diagnostics n = row_count;
  perform private.audit('gestao.items_transfer', 'business_tabs', _to_tab::text, jsonb_build_object('items', _items, 'moved', n));
  return n;
end $$;

create or replace function private.tab_total(_tab uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(unit_price_cents * quantity), 0)::int from public.business_tab_items where tab_id = _tab and kitchen_status <> 'cancelado'
$$;

create or replace function public.gestao_request_close(_tab uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype;
begin
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'tabs.manage');
  if t.status <> 'aberta' then raise exception 'A comanda não está aberta.' using errcode = 'P0001'; end if;
  update public.business_tabs set status = 'aguardando_pagamento', last_activity_at = now() where id = _tab;
end $$;

-- fechar: soma os pagamentos (registro manual no caixa aberto); total − desconto precisa bater
create or replace function public.gestao_close_tab(_tab uuid, _payments jsonb, _discount_cents integer, _op uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype; s public.cash_sessions%rowtype; total int; due int; paid int := 0; p jsonb; i int := 0;
begin
  if _op is null then raise exception 'Operação inválida.' using errcode = 'P0001'; end if;
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'cash.manage');
  perform private.limit_for('gestao.cash');
  if t.status = 'fechada' and t.close_op = _op then return jsonb_build_object('status', 'ja_fechada'); end if;
  if t.status not in ('aberta', 'aguardando_pagamento') then raise exception 'Comanda já encerrada.' using errcode = 'P0001'; end if;
  select * into s from public.cash_sessions where business_id = t.business_id and status = 'aberto';
  if not found then raise exception 'Abra o caixa antes de receber.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.business_tab_items where tab_id = _tab and kitchen_status in ('novo', 'em_preparo')) then
    raise exception 'Ainda há itens na cozinha. Sirva ou cancele antes de fechar.' using errcode = 'P0001';
  end if;
  total := private.tab_total(_tab);
  if coalesce(_discount_cents, 0) < 0 or coalesce(_discount_cents, 0) > total then raise exception 'Desconto inválido.' using errcode = 'P0001'; end if;
  due := total - coalesce(_discount_cents, 0);
  if jsonb_typeof(_payments) <> 'array' then raise exception 'Pagamentos inválidos.' using errcode = 'P0001'; end if;
  for p in select * from jsonb_array_elements(_payments) loop
    if (p->>'method') not in ('dinheiro', 'pix', 'cartao', 'outro') or coalesce((p->>'amount_cents')::int, 0) <= 0 then
      raise exception 'Pagamento inválido.' using errcode = 'P0001';
    end if;
    paid := paid + (p->>'amount_cents')::int;
  end loop;
  if paid <> due then raise exception 'Os pagamentos (R$ %) precisam somar o total a pagar (R$ %).', to_char(paid / 100.0, 'FM999990D00'), to_char(due / 100.0, 'FM999990D00') using errcode = 'P0001'; end if;
  for p in select * from jsonb_array_elements(_payments) loop
    i := i + 1;
    insert into public.cash_movements(session_id, business_id, kind, method, amount_cents, confirmation, tab_id, description, op_id, created_by)
    values (s.id, t.business_id, 'venda', p->>'method', (p->>'amount_cents')::int, 'manual', _tab, 'Comanda #' || t.number,
            (substr(md5(_op::text || ':' || i), 1, 8) || '-' || substr(md5(_op::text || ':' || i), 9, 4) || '-' || substr(md5(_op::text || ':' || i), 13, 4) || '-' ||
             substr(md5(_op::text || ':' || i), 17, 4) || '-' || substr(md5(_op::text || ':' || i), 21, 12))::uuid, auth.uid());
  end loop;
  update public.business_tabs set status = 'fechada', discount_cents = coalesce(_discount_cents, 0), closed_by = auth.uid(), closed_at = now(), close_op = _op
   where id = _tab;
  perform private.audit('gestao.tab_close', 'business_tabs', _tab::text, jsonb_build_object('total', total, 'discount', coalesce(_discount_cents, 0), 'paid', paid));
  return jsonb_build_object('status', 'fechada', 'total_cents', total, 'pago_cents', paid);
end $$;

create or replace function public.gestao_cancel_tab(_tab uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype; r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'cash.manage');
  if r is null then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  if t.status not in ('aberta', 'aguardando_pagamento') then raise exception 'Comanda já encerrada.' using errcode = 'P0001'; end if;
  update public.business_tabs set status = 'cancelada', closed_by = auth.uid(), closed_at = now() where id = _tab;
  perform private.audit('gestao.tab_cancel', 'business_tabs', _tab::text, jsonb_build_object('reason', r, 'total', private.tab_total(_tab)));
end $$;

-- quadro de mesas: situação calculada no banco
create or replace function public.gestao_board(_business uuid)
returns table (table_id uuid, table_name text, area text, capacity smallint, tab_id uuid, tab_number integer, tab_label text, people smallint,
               tab_status text, situation text, opened_at timestamptz, last_activity_at timestamptz, opened_by_name text,
               total_cents integer, items_count bigint, pending_kitchen bigint, ready_items bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_business_permission(_business, 'tabs.manage') or public.has_business_permission(_business, 'cash.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_premium(_business);
  return query
    with tabs as (
      select t.*, private.tab_total(t.id) as total,
             (select count(*) from public.business_tab_items i where i.tab_id = t.id and i.kitchen_status <> 'cancelado') as n_items,
             (select count(*) from public.business_tab_items i where i.tab_id = t.id and i.kitchen_status in ('novo', 'em_preparo')) as n_kitchen,
             (select count(*) from public.business_tab_items i where i.tab_id = t.id and i.kitchen_status = 'pronto') as n_ready
        from public.business_tabs t where t.business_id = _business and t.status in ('aberta', 'aguardando_pagamento'))
    select bt.id, bt.name, bt.area, bt.capacity, x.id, x.number, x.label, x.people, x.status,
           case when x.id is null then 'livre' when x.status = 'aguardando_pagamento' then 'aguardando_pagamento'
                when x.n_ready > 0 then 'pronto' when x.n_kitchen > 0 then 'em_preparo' else 'ocupada' end,
           x.opened_at, x.last_activity_at, p.full_name, coalesce(x.total, 0), coalesce(x.n_items, 0), coalesce(x.n_kitchen, 0), coalesce(x.n_ready, 0)
      from public.business_tables bt
      left join tabs x on x.table_id = bt.id
      left join public.profiles p on p.id = x.opened_by
     where bt.business_id = _business and bt.is_active
    union all
    select null, null, null, null, x.id, x.number, x.label, x.people, x.status,
           case when x.status = 'aguardando_pagamento' then 'aguardando_pagamento' when x.n_ready > 0 then 'pronto'
                when x.n_kitchen > 0 then 'em_preparo' else 'ocupada' end,
           x.opened_at, x.last_activity_at, p.full_name, x.total, x.n_items, x.n_kitchen, x.n_ready
      from tabs x left join public.profiles p on p.id = x.opened_by where x.table_id is null
     order by 2 nulls last, 6;
end $$;

-- cozinha unificada: delivery/retirada (pedidos) + mesa/balcão (comandas)
create or replace function public.gestao_kitchen(_business uuid)
returns table (origin text, ref_id uuid, ref_label text, item_id uuid, item_name text, quantity integer, notes text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_business_permission(_business, 'orders.update_status') or public.has_business_permission(_business, 'tabs.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select case o.fulfillment when 'pickup' then 'retirada' else 'delivery' end, o.id, 'Pedido #' || o.code, i.id, i.name, i.quantity::int, i.notes,
           o.status::text, o.created_at
      from public.orders o join public.order_items i on i.order_id = o.id
     where o.business_id = _business and o.status in ('accepted', 'preparing')
    union all
    select case when t.table_id is null then 'balcao' else 'mesa' end, t.id,
           coalesce(bt.name || ' — ', 'Balcão — ') || 'Comanda #' || lpad(t.number::text, 3, '0'), i.id, i.name, i.quantity::int, i.notes,
           i.kitchen_status, i.created_at
      from public.business_tab_items i join public.business_tabs t on t.id = i.tab_id left join public.business_tables bt on bt.id = t.table_id
     where i.business_id = _business and i.kitchen_status in ('novo', 'em_preparo', 'pronto') and t.status in ('aberta', 'aguardando_pagamento')
       and public.business_has_premium(_business)
     order by 9;
end $$;

-- caixa
create or replace function public.gestao_open_cash(_business uuid, _opening_cents integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  perform private.require_gestao(_business, 'cash.manage');
  perform private.limit_for('gestao.cash');
  if _opening_cents is null or _opening_cents < 0 then raise exception 'Informe o saldo inicial.' using errcode = 'P0001'; end if;
  insert into public.cash_sessions(business_id, opening_cents, opened_by) values (_business, _opening_cents, auth.uid()) returning id into sid;
  perform private.audit('gestao.cash_open', 'cash_sessions', sid::text, jsonb_build_object('opening', _opening_cents));
  return sid;
exception when unique_violation then
  raise exception 'O caixa já está aberto.' using errcode = 'P0001';
end $$;

create or replace function public.gestao_cash_movement(_business uuid, _kind text, _method text, _amount_cents integer, _description text, _op uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.cash_sessions%rowtype; mid uuid;
begin
  perform private.require_gestao(_business, 'cash.manage');
  perform private.limit_for('gestao.cash');
  if _kind not in ('venda', 'entrada', 'saida', 'sangria', 'suprimento') then raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  -- saídas e sangrias são sensíveis: só quem gerencia a loja (proprietário/gerente)
  if _kind in ('saida', 'sangria') and not public.has_business_permission(_business, 'reports.view') then
    raise exception 'Saídas e sangrias exigem autorização do gerente ou proprietário.' using errcode = '42501';
  end if;
  if _kind in ('saida', 'sangria') and nullif(btrim(coalesce(_description, '')), '') is null then raise exception 'Descreva o motivo.' using errcode = 'P0001'; end if;
  select * into s from public.cash_sessions where business_id = _business and status = 'aberto';
  if not found then raise exception 'O caixa está fechado.' using errcode = 'P0001'; end if;
  select id into mid from public.cash_movements where op_id = _op;
  if mid is not null then return mid; end if;
  insert into public.cash_movements(session_id, business_id, kind, method, amount_cents, description, op_id, created_by)
  values (s.id, _business, _kind, _method, _amount_cents, nullif(btrim(coalesce(_description, '')), ''), _op, auth.uid()) returning id into mid;
  perform private.audit('gestao.cash_' || _kind, 'cash_movements', mid::text, jsonb_build_object('amount', _amount_cents, 'method', _method));
  return mid;
end $$;

create or replace function private.cash_expected(_session uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (s.opening_cents + coalesce(sum(case when m.method = 'dinheiro' and m.kind in ('venda', 'entrada', 'suprimento') then m.amount_cents
                                              when m.method = 'dinheiro' and m.kind in ('saida', 'sangria') then -m.amount_cents else 0 end), 0))::int
    from public.cash_sessions s left join public.cash_movements m on m.session_id = s.id where s.id = _session group by s.opening_cents
$$;

create or replace function public.gestao_close_cash(_business uuid, _counted_cents integer, _notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.cash_sessions%rowtype; expected int;
begin
  perform private.require_gestao(_business, 'cash.manage');
  perform private.limit_for('gestao.cash');
  select * into s from public.cash_sessions where business_id = _business and status = 'aberto' for update;
  if not found then raise exception 'O caixa já está fechado.' using errcode = 'P0001'; end if;
  if _counted_cents is null or _counted_cents < 0 then raise exception 'Informe o valor contado em dinheiro.' using errcode = 'P0001'; end if;
  expected := private.cash_expected(s.id);
  update public.cash_sessions set status = 'fechado', counted_cents = _counted_cents, expected_cents = expected, closed_by = auth.uid(), closed_at = now(),
         notes = nullif(btrim(coalesce(_notes, '')), '') where id = s.id;
  perform private.audit('gestao.cash_close', 'cash_sessions', s.id::text, jsonb_build_object('expected', expected, 'counted', _counted_cents));
  return public.gestao_cash_report(s.id);
end $$;

create or replace function public.gestao_cash_report(_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.cash_sessions%rowtype;
begin
  select * into s from public.cash_sessions where id = _session;
  if not found or not public.has_business_permission(s.business_id, 'cash.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at, 'opening_cents', s.opening_cents,
    'opened_by', (select full_name from public.profiles where id = s.opened_by), 'closed_by', (select full_name from public.profiles where id = s.closed_by),
    'expected_cash_cents', coalesce(s.expected_cents, private.cash_expected(s.id)), 'counted_cents', s.counted_cents,
    'difference_cents', case when s.counted_cents is null then null else s.counted_cents - coalesce(s.expected_cents, private.cash_expected(s.id)) end,
    'by_kind', coalesce((select jsonb_object_agg(kind, total) from (select kind, sum(amount_cents) as total from public.cash_movements where session_id = s.id group by kind) x), '{}'::jsonb),
    'by_method', coalesce((select jsonb_object_agg(method, total) from (select method, sum(amount_cents) as total from public.cash_movements where session_id = s.id and kind = 'venda' group by method) x), '{}'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'method', m.method, 'amount_cents', m.amount_cents, 'description', m.description,
                                  'confirmation', m.confirmation, 'at', m.created_at, 'by', p.full_name) order by m.created_at)
                             from public.cash_movements m left join public.profiles p on p.id = m.created_by where m.session_id = s.id), '[]'::jsonb));
end $$;

create or replace function public.gestao_cash_status(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.cash_sessions%rowtype;
begin
  if not public.is_business_member(_business) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.cash_sessions where business_id = _business and status = 'aberto';
  if not found then return jsonb_build_object('open', false); end if;
  return jsonb_build_object('open', true, 'session_id', s.id, 'opened_at', s.opened_at,
                            'opened_by', (select full_name from public.profiles where id = s.opened_by));
end $$;

-- QR da mesa: identifica mesa e cardápio público; nada administrativo
create or replace function public.table_by_qr(_token uuid)
returns table (business_slug text, business_name text, business_type public.business_type, table_name text)
language sql stable security definer set search_path = '' as $$
  select b.slug, b.name, b.business_type, t.name
    from public.business_tables t join public.businesses b on b.id = t.business_id
   where t.qr_token = _token and t.is_active and b.status = 'active' and not b.is_demo
     and (not b.is_test or public.viewer_sees_tests())
$$;

-- tempo real para a equipe (RLS das tabelas vale para o canal)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['business_tabs', 'business_tab_items', 'cash_sessions', 'cash_movements', 'business_tables'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.require_gestao(uuid, text)', 'private.tab_total(uuid)', 'private.cash_expected(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.merchant_set_member_permission(uuid, uuid, text, boolean)', 'public.gestao_save_table(uuid, uuid, text, text, integer, boolean)',
    'public.gestao_create_tables(uuid, integer, text, integer)', 'public.gestao_open_tab(uuid, uuid, text, integer)',
    'public.gestao_add_items(uuid, jsonb, uuid)', 'public.gestao_item_status(uuid, text)', 'public.gestao_cancel_item(uuid, text)',
    'public.gestao_transfer_tab(uuid, uuid)', 'public.gestao_transfer_items(uuid[], uuid)', 'public.gestao_request_close(uuid)',
    'public.gestao_close_tab(uuid, jsonb, integer, uuid)', 'public.gestao_cancel_tab(uuid, text)', 'public.gestao_board(uuid)',
    'public.gestao_kitchen(uuid)', 'public.gestao_open_cash(uuid, integer)', 'public.gestao_cash_movement(uuid, text, text, integer, text, uuid)',
    'public.gestao_close_cash(uuid, integer, text)', 'public.gestao_cash_report(uuid)', 'public.gestao_cash_status(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function public.table_by_qr(uuid) from public;
  grant execute on function public.table_by_qr(uuid) to anon, authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0027', '0027_gestao_mesas_caixa.sql', 'applied');
    raise notice 'Tucaí 0027: aplicada agora';
  end if;
end $tucai_0027$;

-- ===================== supabase/migrations/0028_cobertura_nacional.sql =====================
do $tucai_0028$
begin
  if exists (select 1 from private.tucai_migrations where version = '0028') then
    raise notice 'Tucaí 0028: já aplicada';
  else
    execute $tucai_sql$
-- 0028_cobertura_nacional: Brasil → UF → Região comercial → Município.
--  * UFs (27, códigos IBGE) e municípios IBGE (código, nome, UF, coordenadas da sede). Os municípios NÃO ficam no
--    código: são importados pelo arquivo gerado supabase/admin/municipios_ibge.sql (scripts/ibge/), que chama
--    private.import_municipalities. Mudanças territoriais: reimportar (upsert) e desativar municípios extintos.
--  * Regiões comerciais dinâmicas (Master): centro (município IBGE) + raio em km, distância geográfica em linha reta
--    (haversine). Um município pode estar em várias regiões (sobreposição), mas tem UMA região principal.
--  * Município fora de todos os raios: cobertura administrativa por UF, sinalizada como lacuna (nunca "coberto").
--  * Separação: cobertura cadastrada ≠ região ativa ≠ cidade com estabelecimento operacional ≠ raio de entrega da loja.
--    Nada é ativado automaticamente: regiões nascem como rascunho.
--  * Alterações que afetariam campanhas em andamento são bloqueadas (private.region_in_use, completada na 0029).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.regions', 600, 600)
on conflict (action) do nothing;

-- texto sem acento/minúsculo para busca ("itau de minas" encontra "Itaú de Minas")
create or replace function private.fold(_t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(lower(translate(coalesce(_t, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ''’-', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn   ')), '\s+', ' ', 'g'))
$$;

-- distância geográfica em linha reta (km), raio médio da Terra 6371 km
create or replace function private.haversine_km(_lat1 numeric, _lng1 numeric, _lat2 numeric, _lng2 numeric) returns numeric
language sql immutable parallel safe set search_path = '' as $$
  select (2 * 6371 * asin(least(1, sqrt(
    power(sin(radians((_lat2 - _lat1)::float8) / 2), 2) +
    cos(radians(_lat1::float8)) * cos(radians(_lat2::float8)) * power(sin(radians((_lng2 - _lng1)::float8) / 2), 2)))))::numeric
$$;

create table if not exists public.ufs (
  code smallint primary key check (code between 11 and 53),
  sigla text not null unique check (sigla ~ '^[A-Z]{2}$'),
  name text not null,
  region text not null check (region in ('Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'))
);
insert into public.ufs(code, sigla, name, region) values
  (11, 'RO', 'Rondônia', 'Norte'), (12, 'AC', 'Acre', 'Norte'), (13, 'AM', 'Amazonas', 'Norte'), (14, 'RR', 'Roraima', 'Norte'),
  (15, 'PA', 'Pará', 'Norte'), (16, 'AP', 'Amapá', 'Norte'), (17, 'TO', 'Tocantins', 'Norte'),
  (21, 'MA', 'Maranhão', 'Nordeste'), (22, 'PI', 'Piauí', 'Nordeste'), (23, 'CE', 'Ceará', 'Nordeste'), (24, 'RN', 'Rio Grande do Norte', 'Nordeste'),
  (25, 'PB', 'Paraíba', 'Nordeste'), (26, 'PE', 'Pernambuco', 'Nordeste'), (27, 'AL', 'Alagoas', 'Nordeste'), (28, 'SE', 'Sergipe', 'Nordeste'),
  (29, 'BA', 'Bahia', 'Nordeste'), (31, 'MG', 'Minas Gerais', 'Sudeste'), (32, 'ES', 'Espírito Santo', 'Sudeste'), (33, 'RJ', 'Rio de Janeiro', 'Sudeste'),
  (35, 'SP', 'São Paulo', 'Sudeste'), (41, 'PR', 'Paraná', 'Sul'), (42, 'SC', 'Santa Catarina', 'Sul'), (43, 'RS', 'Rio Grande do Sul', 'Sul'),
  (50, 'MS', 'Mato Grosso do Sul', 'Centro-Oeste'), (51, 'MT', 'Mato Grosso', 'Centro-Oeste'), (52, 'GO', 'Goiás', 'Centro-Oeste'), (53, 'DF', 'Distrito Federal', 'Centro-Oeste')
on conflict (code) do nothing;

create table if not exists public.municipalities (
  ibge_code integer primary key check (ibge_code between 1100000 and 5399999),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  name_fold text generated always as (private.fold(name)) stored,
  uf_code smallint not null references public.ufs(code),
  lat numeric(8,5) check (lat is null or lat between -34.0 and 5.5),
  lng numeric(8,5) check (lng is null or lng between -74.5 and -28.5),
  is_capital boolean not null default false,
  active boolean not null default true,   -- extinto/desmembrado: false (nunca apagar; preserva vínculos)
  source text,
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  check (ibge_code / 100000 = uf_code)
);
create index if not exists municipalities_uf_name_idx on public.municipalities(uf_code, name_fold);
create index if not exists municipalities_latlng_idx on public.municipalities(lat, lng) where active;
alter table public.municipalities enable row level security;
alter table public.ufs enable row level security;
drop policy if exists municipalities_select on public.municipalities;
create policy municipalities_select on public.municipalities for select to anon, authenticated using (true);
drop policy if exists ufs_select on public.ufs;
create policy ufs_select on public.ufs for select to anon, authenticated using (true);
revoke all on public.municipalities, public.ufs from public, anon, authenticated;
grant select on public.municipalities, public.ufs to anon, authenticated;

-- cidades atendidas: a coluna cities.ibge_code já existe (0023, sem chave estrangeira para não travar cadastros
-- feitos antes da importação). private.link_cities_ibge() preenche pelo nome + UF.

create table if not exists public.commercial_regions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null default 'raio' check (kind in ('raio', 'administrativa')),
  uf_code smallint references public.ufs(code),
  center_ibge integer references public.municipalities(ibge_code),
  center_lat numeric(8,5),
  center_lng numeric(8,5),
  radius_km numeric(6,1) check (radius_km is null or radius_km between 1 and 500),
  status text not null default 'rascunho' check (status in ('rascunho', 'ativa', 'pausada', 'desativada')),
  suggested boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'administrativa' or (center_ibge is not null and center_lat is not null and center_lng is not null and radius_km is not null)),
  check (kind = 'raio' or uf_code is not null)
);
create unique index if not exists commercial_regions_admin_uf_idx on public.commercial_regions(uf_code) where kind = 'administrativa';
create index if not exists commercial_regions_status_idx on public.commercial_regions(status, uf_code);
create index if not exists commercial_regions_uf_idx on public.commercial_regions(uf_code);
create index if not exists commercial_regions_center_idx on public.commercial_regions(center_ibge);
create index if not exists commercial_regions_created_by_idx on public.commercial_regions(created_by);

create table if not exists public.region_municipalities (
  region_id uuid not null references public.commercial_regions(id) on delete cascade,
  ibge_code integer not null references public.municipalities(ibge_code) on delete cascade,
  distance_km numeric(7,1),
  source text not null check (source in ('raio', 'manual', 'administrativa')),
  excluded boolean not null default false,   -- retirado manualmente de dentro do raio (recalcular respeita)
  is_primary boolean not null default false,
  primary key (region_id, ibge_code)
);
create unique index if not exists region_municipalities_primary_idx on public.region_municipalities(ibge_code) where is_primary;
create index if not exists region_municipalities_ibge_idx on public.region_municipalities(ibge_code);
alter table public.commercial_regions enable row level security;
alter table public.region_municipalities enable row level security;
-- leitura e escrita só pelas funções (Master) e pelas listagens públicas de regiões ativas
revoke all on public.commercial_regions, public.region_municipalities from public, anon, authenticated;

-- ---------- importação IBGE (arquivo gerado, executado no SQL Editor) ----------
create or replace function private.import_municipalities(_rows jsonb, _source text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ins int := 0; upd int := 0; r jsonb;
begin
  if jsonb_typeof(_rows) <> 'array' then raise exception 'Formato inválido.' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(_rows) loop
    insert into public.municipalities as m (ibge_code, name, uf_code, lat, lng, is_capital, source, updated_at)
    values ((r->>'codigo_ibge')::int, btrim(r->>'nome'), (r->>'codigo_uf')::smallint, nullif(r->>'latitude', '')::numeric,
            nullif(r->>'longitude', '')::numeric, coalesce((r->>'capital')::int = 1, false), _source, now())
    on conflict (ibge_code) do update set name = excluded.name, uf_code = excluded.uf_code, lat = excluded.lat, lng = excluded.lng,
      is_capital = excluded.is_capital, active = true, source = excluded.source, updated_at = now()
    where (m.name, m.uf_code, m.lat, m.lng, m.is_capital, m.active) is distinct from (excluded.name, excluded.uf_code, excluded.lat, excluded.lng, excluded.is_capital, true);
    if found then
      if (select xmax = 0 from public.municipalities where ibge_code = (r->>'codigo_ibge')::int) then ins := ins + 1; else upd := upd + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('inseridos', ins, 'atualizados', upd, 'total', (select count(*) from public.municipalities));
end $$;

-- liga as cidades atendidas aos municípios IBGE por nome + UF (sem acento)
create or replace function private.link_cities_ibge() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.cities c set ibge_code = m.ibge_code
    from public.municipalities m join public.ufs u on u.code = m.uf_code
   where c.ibge_code is null and u.sigla = c.state and m.name_fold = private.fold(c.name)
     and not exists (select 1 from public.cities x where x.ibge_code = m.ibge_code);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- cálculo da cobertura ----------
-- 0029 redefine: região com campanhas pagas em andamento não pode mudar centro/raio/status nem perder municípios
create or replace function private.region_in_use(_region uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
create or replace function private.region_campaign_count(_region uuid) returns bigint
language sql stable security definer set search_path = '' as $$ select 0::bigint $$;

-- municípios dentro do raio (prévia por caixa de coordenadas + haversine)
create or replace function private.region_compute(_region uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.commercial_regions%rowtype; dlat numeric; dlng numeric;
begin
  select * into r from public.commercial_regions where id = _region;
  if not found or r.kind <> 'raio' then return; end if;
  dlat := r.radius_km / 110.574;
  dlng := r.radius_km / (111.320 * greatest(cos(radians(r.center_lat::float8)), 0.01)::numeric);
  delete from public.region_municipalities where region_id = _region and source = 'raio' and not excluded;
  insert into public.region_municipalities(region_id, ibge_code, distance_km, source)
  select _region, m.ibge_code, round(private.haversine_km(r.center_lat, r.center_lng, m.lat, m.lng), 1), 'raio'
    from public.municipalities m
   where m.active and m.lat between r.center_lat - dlat and r.center_lat + dlat
     and m.lng between r.center_lng - dlng and r.center_lng + dlng
     and private.haversine_km(r.center_lat, r.center_lng, m.lat, m.lng) <= r.radius_km
  on conflict (region_id, ibge_code) do update set distance_km = excluded.distance_km;
end $$;

-- uma região principal por município; quem fica fora de todo raio entra na cobertura administrativa da UF (lacuna)
create or replace function private.assign_coverage() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- garante uma região administrativa por UF que tenha municípios (nunca ativada automaticamente)
  insert into public.commercial_regions(name, slug, kind, uf_code, status)
  select 'Cobertura administrativa — ' || u.sigla, 'administrativa-' || lower(u.sigla), 'administrativa', u.code, 'rascunho'
    from public.ufs u where exists (select 1 from public.municipalities m where m.uf_code = u.code)
  on conflict do nothing;
  -- administrativa = municípios ativos sem nenhum raio vigente (não desativado)
  delete from public.region_municipalities rm using public.commercial_regions r
   where r.id = rm.region_id and r.kind = 'administrativa'
     and exists (select 1 from public.region_municipalities x join public.commercial_regions y on y.id = x.region_id
                  where x.ibge_code = rm.ibge_code and y.kind = 'raio' and y.status <> 'desativada' and not x.excluded);
  insert into public.region_municipalities(region_id, ibge_code, source)
  select r.id, m.ibge_code, 'administrativa'
    from public.municipalities m join public.commercial_regions r on r.kind = 'administrativa' and r.uf_code = m.uf_code
   where m.active and not exists (select 1 from public.region_municipalities x join public.commercial_regions y on y.id = x.region_id
                                   where x.ibge_code = m.ibge_code and y.kind = 'raio' and y.status <> 'desativada' and not x.excluded)
  on conflict do nothing;
  -- principal: raio ativo > outro raio > administrativa; manual > mais perto > mais antiga (duas etapas: índice único)
  create temp table if not exists _best (ibge_code integer primary key, region_id uuid) on commit drop;
  truncate _best;
  insert into _best
  select distinct on (rm.ibge_code) rm.ibge_code, rm.region_id
    from public.region_municipalities rm join public.commercial_regions r on r.id = rm.region_id
   where not rm.excluded and r.status <> 'desativada'
   order by rm.ibge_code, (r.kind = 'administrativa'), (r.status = 'ativa') desc, (rm.source = 'manual') desc, rm.distance_km nulls last, r.created_at, r.id;
  update public.region_municipalities rm set is_primary = false
   where rm.is_primary and not exists (select 1 from _best b where b.ibge_code = rm.ibge_code and b.region_id = rm.region_id);
  update public.region_municipalities rm set is_primary = true
    from _best b where b.ibge_code = rm.ibge_code and b.region_id = rm.region_id and not rm.is_primary;
end $$;

create or replace function private.region_slug(_name text, _uf smallint) returns text
language plpgsql stable security definer set search_path = '' as $$
declare base text := regexp_replace(private.fold(_name), '[^a-z0-9]+', '-', 'g') || '-' || lower(coalesce((select sigla from public.ufs where code = _uf), 'br'));
        s text; i int := 1;
begin
  base := btrim(base, '-'); s := base;
  while exists (select 1 from public.commercial_regions where slug = s) loop i := i + 1; s := base || '-' || i; end loop;
  return s;
end $$;

create or replace function private.create_region(_name text, _center integer, _radius numeric, _suggested boolean, _by uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.municipalities%rowtype; rid uuid;
begin
  select * into m from public.municipalities where ibge_code = _center and active;
  if not found or m.lat is null then raise exception 'Município central inválido ou sem coordenadas.' using errcode = 'P0001'; end if;
  insert into public.commercial_regions(name, slug, kind, uf_code, center_ibge, center_lat, center_lng, radius_km, status, suggested, created_by)
  values (btrim(_name), private.region_slug(_name, m.uf_code), 'raio', m.uf_code, m.ibge_code, m.lat, m.lng, _radius, 'rascunho', _suggested, _by)
  returning id into rid;
  perform private.region_compute(rid);
  return rid;
end $$;

-- regiões iniciais de exemplo (rascunho; o Master ativa quando houver operação real)
create or replace function private.seed_initial_regions() returns integer
language plpgsql security definer set search_path = '' as $$
declare c record; n int := 0;
begin
  for c in select * from (values (3133758, 'Itaú de Minas'), (3106200, 'Belo Horizonte'), (3550308, 'São Paulo'),
                                 (3516200, 'Franca'), (3543402, 'Ribeirão Preto'), (3304557, 'Rio de Janeiro')) v(code, name) loop
    if exists (select 1 from public.municipalities where ibge_code = c.code and lat is not null)
       and not exists (select 1 from public.commercial_regions where center_ibge = c.code and kind = 'raio') then
      perform private.create_region('Região de ' || c.name, c.code, 100, false, null);
      n := n + 1;
    end if;
  end loop;
  if exists (select 1 from public.municipalities) then perform private.assign_coverage(); end if;
  return n;
end $$;

-- ---------- painel Master ----------
create or replace function public.admin_coverage_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return (
    with m as (select * from public.municipalities where active),
    cov as (
      select m.ibge_code,
             bool_or(r.kind = 'raio' and r.status <> 'desativada' and not rm.excluded) as em_raio,
             bool_or(r.kind = 'raio' and r.status = 'ativa' and not rm.excluded) as em_ativa
        from m left join public.region_municipalities rm on rm.ibge_code = m.ibge_code
        left join public.commercial_regions r on r.id = rm.region_id
       group by m.ibge_code)
    select jsonb_build_object(
      'municipios', (select count(*) from m),
      'com_regiao_principal', (select count(distinct rm.ibge_code) from public.region_municipalities rm join m on m.ibge_code = rm.ibge_code where rm.is_primary),
      'em_raio', (select count(*) from cov where em_raio),
      'em_regiao_ativa', (select count(*) from cov where em_ativa),
      'lacunas', (select count(*) from cov where not coalesce(em_raio, false)),
      'sem_coordenadas', (select count(*) from m where lat is null),
      'regioes', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.commercial_regions where kind = 'raio' group by status) x),
      'cidades_atendidas', (select count(*) from public.cities where is_active and not is_demo),
      'cidades_com_ibge', (select count(*) from public.cities where ibge_code is not null),
      'cidades_operacionais', (select count(distinct b.city_id) from public.businesses b where b.status = 'active' and not b.is_demo and not b.is_test),
      'por_uf', coalesce((select jsonb_agg(jsonb_build_object('sigla', u.sigla, 'nome', u.name, 'municipios', x.total, 'em_raio', x.raio, 'lacunas', x.total - x.raio,
                                                               'lat', x.lat, 'lng', x.lng) order by u.sigla)
                            from public.ufs u join (
                              select m.uf_code, count(*) total, count(*) filter (where cov.em_raio) raio, round(avg(m.lat), 2) lat, round(avg(m.lng), 2) lng
                                from m join cov on cov.ibge_code = m.ibge_code group by m.uf_code) x on x.uf_code = u.code), '[]'::jsonb)
    ));
end $$;

create or replace function public.admin_regions(_uf text default null, _status text default null, _q text default null, _limit integer default 24, _offset integer default 0)
returns table (id uuid, name text, slug text, kind text, status text, uf text, center_ibge integer, center_name text, center_lat numeric, center_lng numeric,
               radius_km numeric, suggested boolean, municipalities bigint, primary_municipalities bigint, businesses bigint, active_campaigns bigint,
               in_use boolean, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    with f as (
      select r.* from public.commercial_regions r left join public.ufs u on u.code = r.uf_code
       where (_uf is null or u.sigla = upper(_uf)) and (_status is null or r.status = _status)
         and (_q is null or btrim(_q) = '' or private.fold(r.name) like '%' || private.fold(_q) || '%'
              or exists (select 1 from public.region_municipalities x join public.municipalities mm on mm.ibge_code = x.ibge_code
                          where x.region_id = r.id and not x.excluded and mm.name_fold like '%' || private.fold(_q) || '%')))
    select r.id, r.name, r.slug, r.kind, r.status, u.sigla, r.center_ibge, cm.name, r.center_lat, r.center_lng, r.radius_km, r.suggested,
           (select count(*) from public.region_municipalities x where x.region_id = r.id and not x.excluded),
           (select count(*) from public.region_municipalities x where x.region_id = r.id and x.is_primary),
           (select count(*) from public.businesses b join public.cities c on c.id = b.city_id
                             join public.region_municipalities x on x.ibge_code = c.ibge_code and x.region_id = r.id and not x.excluded
             where b.status = 'active' and not b.is_demo),
           private.region_campaign_count(r.id), private.region_in_use(r.id),
           count(*) over ()
      from f r left join public.ufs u on u.code = r.uf_code left join public.municipalities cm on cm.ibge_code = r.center_ibge
     order by (r.status = 'ativa') desc, (r.kind = 'administrativa'), u.sigla nulls last, r.name
     limit least(greatest(coalesce(_limit, 24), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

-- círculos para o mapa (centro e raio; sem municípios nem polígonos)
create or replace function public.admin_region_map() returns table (id uuid, name text, status text, lat numeric, lng numeric, radius_km numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query select r.id, r.name, r.status, r.center_lat, r.center_lng, r.radius_km from public.commercial_regions r
                where r.kind = 'raio' and r.status <> 'desativada' order by r.name limit 3000;
end $$;

create or replace function public.admin_region_municipalities(_region uuid, _q text default null, _limit integer default 50, _offset integer default 0)
returns table (ibge_code integer, name text, uf text, distance_km numeric, source text, excluded boolean, is_primary boolean, primary_region text,
               served_city boolean, businesses bigint, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select m.ibge_code, m.name, u.sigla, rm.distance_km, rm.source, rm.excluded, rm.is_primary,
           (select r2.name from public.region_municipalities p join public.commercial_regions r2 on r2.id = p.region_id where p.ibge_code = m.ibge_code and p.is_primary),
           exists (select 1 from public.cities c where c.ibge_code = m.ibge_code and c.is_active),
           (select count(*) from public.businesses b join public.cities c on c.id = b.city_id where c.ibge_code = m.ibge_code and b.status = 'active' and not b.is_demo),
           count(*) over ()
      from public.region_municipalities rm join public.municipalities m on m.ibge_code = rm.ibge_code join public.ufs u on u.code = m.uf_code
     where rm.region_id = _region and (_q is null or btrim(_q) = '' or m.name_fold like '%' || private.fold(_q) || '%')
     order by rm.excluded, rm.distance_km nulls last, m.name
     limit least(greatest(coalesce(_limit, 50), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

-- lacunas: municípios fora de qualquer raio vigente (ficam só na cobertura administrativa)
create or replace function public.admin_uncovered_municipalities(_uf text default null, _q text default null, _limit integer default 50, _offset integer default 0)
returns table (ibge_code integer, name text, uf text, lat numeric, lng numeric, reason text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select m.ibge_code, m.name, u.sigla, m.lat, m.lng, case when m.lat is null then 'sem_coordenadas' else 'fora_dos_raios' end, count(*) over ()
      from public.municipalities m join public.ufs u on u.code = m.uf_code
     where m.active and (_uf is null or u.sigla = upper(_uf)) and (_q is null or btrim(_q) = '' or m.name_fold like '%' || private.fold(_q) || '%')
       and not exists (select 1 from public.region_municipalities x join public.commercial_regions r on r.id = x.region_id
                        where x.ibge_code = m.ibge_code and r.kind = 'raio' and r.status <> 'desativada' and not x.excluded)
     order by u.sigla, m.name_fold
     limit least(greatest(coalesce(_limit, 50), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

create or replace function public.admin_municipality_search(_q text, _uf text default null, _limit integer default 20)
returns table (ibge_code integer, name text, uf text, lat numeric, lng numeric, is_capital boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  if char_length(private.fold(_q)) < 2 then return; end if;
  return query
    select m.ibge_code, m.name, u.sigla, m.lat, m.lng, m.is_capital from public.municipalities m join public.ufs u on u.code = m.uf_code
     where m.active and m.name_fold like '%' || private.fold(_q) || '%' and (_uf is null or u.sigla = upper(_uf))
     order by (m.name_fold like private.fold(_q) || '%') desc, m.is_capital desc, m.name_fold limit least(greatest(coalesce(_limit, 20), 1), 50);
end $$;

create or replace function public.admin_save_region(_id uuid, _name text, _center integer, _radius_km numeric, _notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.commercial_regions%rowtype; rid uuid; m public.municipalities%rowtype;
begin
  perform private.require_master();
  perform private.limit_for('admin.regions');
  if char_length(btrim(coalesce(_name, ''))) < 2 then raise exception 'Informe o nome da região.' using errcode = 'P0001'; end if;
  if _radius_km is null or _radius_km < 1 or _radius_km > 500 then raise exception 'Raio entre 1 e 500 km.' using errcode = 'P0001'; end if;
  if _id is null then
    rid := private.create_region(_name, _center, _radius_km, false, auth.uid());
    update public.commercial_regions set notes = nullif(btrim(coalesce(_notes, '')), '') where id = rid;
  else
    select * into r from public.commercial_regions where id = _id for update;
    if not found then raise exception 'Região não encontrada.' using errcode = 'P0001'; end if;
    if r.kind = 'administrativa' then raise exception 'A cobertura administrativa é calculada automaticamente.' using errcode = 'P0001'; end if;
    if (r.center_ibge is distinct from _center or r.radius_km is distinct from _radius_km) and private.region_in_use(_id) then
      raise exception 'Há campanhas em andamento nesta região. Altere centro ou raio depois que terminarem (ou crie outra região).' using errcode = 'P0001';
    end if;
    select * into m from public.municipalities where ibge_code = _center and active;
    if not found or m.lat is null then raise exception 'Município central inválido ou sem coordenadas.' using errcode = 'P0001'; end if;
    update public.commercial_regions set name = btrim(_name), center_ibge = m.ibge_code, center_lat = m.lat, center_lng = m.lng, uf_code = m.uf_code,
           radius_km = _radius_km, notes = nullif(btrim(coalesce(_notes, '')), ''), suggested = false, updated_at = now()
     where id = _id;
    rid := _id;
    if r.center_ibge is distinct from _center or r.radius_km is distinct from _radius_km then perform private.region_compute(rid); end if;
  end if;
  perform private.assign_coverage();
  perform private.audit('regions.save', 'commercial_regions', rid::text, jsonb_build_object('name', _name, 'center', _center, 'radius_km', _radius_km, 'new', _id is null));
  return rid;
end $$;

create or replace function public.admin_set_region_status(_id uuid, _status text, _reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.commercial_regions%rowtype;
begin
  perform private.require_master();
  perform private.limit_for('admin.regions');
  if _status not in ('rascunho', 'ativa', 'pausada', 'desativada') then raise exception 'Situação inválida.' using errcode = 'P0001'; end if;
  select * into r from public.commercial_regions where id = _id for update;
  if not found then raise exception 'Região não encontrada.' using errcode = 'P0001'; end if;
  if _status <> 'ativa' and r.status = 'ativa' and private.region_in_use(_id) then
    raise exception 'Há campanhas pagas em andamento nesta região. Pause ou encerre as campanhas antes.' using errcode = 'P0001';
  end if;
  update public.commercial_regions set status = _status, updated_at = now() where id = _id;
  perform private.assign_coverage();
  perform private.audit('regions.status', 'commercial_regions', _id::text, jsonb_build_object('from', r.status, 'to', _status, 'reason', _reason));
end $$;

-- incluir município manualmente ou retirá-lo do raio (a retirada é lembrada ao recalcular)
create or replace function public.admin_region_member(_region uuid, _ibge integer, _include boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.commercial_regions%rowtype; m public.municipalities%rowtype; cur public.region_municipalities%rowtype;
begin
  perform private.require_master();
  perform private.limit_for('admin.regions');
  select * into r from public.commercial_regions where id = _region for update;
  if not found or r.kind <> 'raio' then raise exception 'Região inválida.' using errcode = 'P0001'; end if;
  select * into m from public.municipalities where ibge_code = _ibge;
  if not found then raise exception 'Município não encontrado.' using errcode = 'P0001'; end if;
  select * into cur from public.region_municipalities where region_id = _region and ibge_code = _ibge;
  if _include then
    insert into public.region_municipalities(region_id, ibge_code, distance_km, source)
    values (_region, _ibge, case when m.lat is not null then round(private.haversine_km(r.center_lat, r.center_lng, m.lat, m.lng), 1) end, 'manual')
    on conflict (region_id, ibge_code) do update set excluded = false;
  else
    if private.region_in_use(_region) then raise exception 'Há campanhas em andamento nesta região: não é possível retirar municípios agora.' using errcode = 'P0001'; end if;
    if cur.source = 'manual' then delete from public.region_municipalities where region_id = _region and ibge_code = _ibge;
    else update public.region_municipalities set excluded = true, is_primary = false where region_id = _region and ibge_code = _ibge; end if;
  end if;
  perform private.assign_coverage();
  perform private.audit('regions.member', 'commercial_regions', _region::text, jsonb_build_object('ibge', _ibge, 'include', _include));
end $$;

-- gerador: sugere centros até cobrir os municípios sem raio (guloso; até _max por chamada)
create or replace function public.admin_suggest_regions(_radius_km numeric default 100, _max integer default 20, _uf text default null, _create boolean default false)
returns table (seq integer, center_ibge integer, center_name text, uf text, newly_covered integer, region_id uuid)
language plpgsql security definer set search_path = '' as $$
declare seed public.municipalities%rowtype; best_code int; best_n int; c record; n int; i int := 0; dlat numeric; dlng numeric; rid uuid; ufc smallint;
begin
  perform private.require_master();
  perform private.limit_for('admin.regions');
  if _radius_km is null or _radius_km < 10 or _radius_km > 500 then raise exception 'Raio entre 10 e 500 km.' using errcode = 'P0001'; end if;
  if _uf is not null then select code into ufc from public.ufs where sigla = upper(_uf); end if;
  create temp table if not exists _cov (ibge_code integer primary key) on commit drop;
  truncate _cov;
  insert into _cov select distinct x.ibge_code from public.region_municipalities x join public.commercial_regions r on r.id = x.region_id
                    where r.kind = 'raio' and r.status <> 'desativada' and not x.excluded;
  while i < least(greatest(coalesce(_max, 20), 1), 100) loop
    select m.* into seed from public.municipalities m
     where m.active and m.lat is not null and (ufc is null or m.uf_code = ufc) and not exists (select 1 from _cov k where k.ibge_code = m.ibge_code)
     order by m.is_capital desc, m.lat desc, m.lng limit 1;
    exit when not found;
    best_code := seed.ibge_code; best_n := 0;
    dlat := (_radius_km / 2) / 110.574; dlng := (_radius_km / 2) / (111.320 * greatest(cos(radians(seed.lat::float8)), 0.01)::numeric);
    -- candidatos: municípios não cobertos perto da semente; vence quem cobre mais municípios ainda sem raio
    for c in select m.ibge_code, m.lat, m.lng from public.municipalities m
              where m.active and m.lat between seed.lat - dlat and seed.lat + dlat and m.lng between seed.lng - dlng and seed.lng + dlng
                and private.haversine_km(seed.lat, seed.lng, m.lat, m.lng) <= _radius_km / 2
                and not exists (select 1 from _cov k where k.ibge_code = m.ibge_code)
              order by private.haversine_km(seed.lat, seed.lng, m.lat, m.lng) limit 40 loop
      select count(*) into n from public.municipalities m
       where m.active and m.lat between c.lat - _radius_km / 110.574 and c.lat + _radius_km / 110.574
         and m.lng between c.lng - _radius_km / (111.320 * greatest(cos(radians(c.lat::float8)), 0.01)::numeric)
                       and c.lng + _radius_km / (111.320 * greatest(cos(radians(c.lat::float8)), 0.01)::numeric)
         and private.haversine_km(c.lat, c.lng, m.lat, m.lng) <= _radius_km
         and not exists (select 1 from _cov k where k.ibge_code = m.ibge_code);
      if n > best_n then best_n := n; best_code := c.ibge_code; end if;
    end loop;
    select m.* into seed from public.municipalities m where m.ibge_code = best_code;
    insert into _cov select m.ibge_code from public.municipalities m
     where m.active and m.lat between seed.lat - _radius_km / 110.574 and seed.lat + _radius_km / 110.574
       and private.haversine_km(seed.lat, seed.lng, m.lat, m.lng) <= _radius_km
    on conflict do nothing;
    insert into _cov values (seed.ibge_code) on conflict do nothing;
    i := i + 1;
    rid := null;
    if _create then
      rid := private.create_region('Região de ' || seed.name, seed.ibge_code, _radius_km, true, auth.uid());
    end if;
    seq := i; center_ibge := seed.ibge_code; center_name := seed.name; uf := (select sigla from public.ufs where code = seed.uf_code);
    newly_covered := greatest(best_n, 1); region_id := rid;
    return next;
  end loop;
  if _create and i > 0 then
    perform private.assign_coverage();
    perform private.audit('regions.suggest_create', 'commercial_regions', null, jsonb_build_object('created', i, 'radius_km', _radius_km, 'uf', _uf));
  end if;
end $$;

-- ---------- uso pelo app (anunciante, seletor) ----------
create or replace function public.active_regions(_q text default null, _uf text default null, _limit integer default 30)
returns table (id uuid, name text, uf text, center_name text, radius_km numeric, municipalities bigint)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, u.sigla, m.name, r.radius_km,
         (select count(*) from public.region_municipalities x where x.region_id = r.id and not x.excluded)
    from public.commercial_regions r join public.ufs u on u.code = r.uf_code left join public.municipalities m on m.ibge_code = r.center_ibge
   where auth.uid() is not null and r.status = 'ativa' and r.kind = 'raio'
     and (_uf is null or u.sigla = upper(_uf))
     and (_q is null or btrim(_q) = '' or private.fold(r.name) like '%' || private.fold(_q) || '%'
          or exists (select 1 from public.region_municipalities x join public.municipalities mm on mm.ibge_code = x.ibge_code
                      where x.region_id = r.id and not x.excluded and mm.name_fold like '%' || private.fold(_q) || '%'))
   order by r.name limit least(greatest(coalesce(_limit, 30), 1), 100)
$$;

-- regiões ativas que incluem uma cidade atendida (sem localização precisa: só a cidade escolhida)
create or replace function public.city_regions(_city uuid) returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name from public.cities c
    join public.region_municipalities x on x.ibge_code = c.ibge_code and not x.excluded
    join public.commercial_regions r on r.id = x.region_id and r.status = 'ativa' and r.kind = 'raio'
   where c.id = _city
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.fold(text)', 'private.haversine_km(numeric, numeric, numeric, numeric)', 'private.import_municipalities(jsonb, text)',
    'private.link_cities_ibge()', 'private.region_in_use(uuid)', 'private.region_campaign_count(uuid)', 'private.region_compute(uuid)',
    'private.assign_coverage()', 'private.region_slug(text, smallint)', 'private.create_region(text, integer, numeric, boolean, uuid)',
    'private.seed_initial_regions()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_coverage_summary()', 'public.admin_regions(text, text, text, integer, integer)', 'public.admin_region_map()',
    'public.admin_region_municipalities(uuid, text, integer, integer)', 'public.admin_uncovered_municipalities(text, text, integer, integer)',
    'public.admin_municipality_search(text, text, integer)', 'public.admin_save_region(uuid, text, integer, numeric, text)',
    'public.admin_set_region_status(uuid, text, text)', 'public.admin_region_member(uuid, integer, boolean)',
    'public.admin_suggest_regions(numeric, integer, text, boolean)', 'public.active_regions(text, text, integer)', 'public.city_regions(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- se os municípios já tiverem sido importados, cria as regiões de exemplo (rascunho) e liga as cidades
do $$
begin
  if exists (select 1 from public.municipalities limit 1) then
    perform private.link_cities_ibge();
    perform private.seed_initial_regions();
  end if;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0028', '0028_cobertura_nacional.sql', 'applied');
    raise notice 'Tucaí 0028: aplicada agora';
  end if;
end $tucai_0028$;

-- ===================== supabase/migrations/0029_publicidade.sql =====================
do $tucai_0029$
begin
  if exists (select 1 from private.tucai_migrations where version = '0029') then
    raise notice 'Tucaí 0029: já aplicada';
  else
    execute $tucai_sql$
-- 0029_publicidade: publicações patrocinadas ("Turbinar publicação") no Conecta, por região comercial.
--  * Proprietário/gerente escolhe publicação do estabelecimento, objetivo, regiões ATIVAS, dias e orçamento total.
--    Preço mínimo (configurável pelo Master): R$ 10 por campanha e R$ 5/dia por região. Diário = total ÷ dias.
--    Cobrança fixa pelo período e abrangência contratados — sem promessa de alcance ou resultado.
--  * Pagamento pelo sistema existente: a campanha gera uma cobrança (platform_charges, tipo 'outro') paga pelo
--    checkout do Mercado Pago (/api/pagamentos/checkout). A baixa (webhook com valor conferido, sem duplicidade)
--    dispara a campanha. Ativa só com PAGAMENTO CONFIRMADO + APROVAÇÃO do Master; o período começa na ativação.
--  * Uma campanha em andamento por publicação; repetir a mesma operação (op_id) não cria outra cobrança.
--  * Distribuição: cidade escolhida pela pessoa → município IBGE → regiões ativas da campanha. Sem localização precisa.
--  * Métricas verificáveis: impressão e clique únicos por pessoa/campanha/dia (chave com hash, sem o id da pessoa);
--    clique só conta com impressão; equipe do próprio estabelecimento não conta. Expiradas encerram sozinhas.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('ads.create', 30, 600), ('ads.track', 900, 600), ('admin.ads', 600, 600)
on conflict (action) do nothing;

create table if not exists private.ad_settings (
  id boolean primary key default true check (id),
  min_total_cents integer not null default 1000 check (min_total_cents >= 100),
  min_daily_cents_per_region integer not null default 500 check (min_daily_cents_per_region >= 0),
  min_days smallint not null default 1 check (min_days >= 1),
  max_days smallint not null default 30 check (max_days between 1 and 90),
  max_regions smallint not null default 10 check (max_regions between 1 and 50),
  feed_every smallint not null default 6 check (feed_every between 3 and 50),            -- 1 patrocinado a cada N publicações
  max_campaigns_per_viewer_day smallint not null default 8 check (max_campaigns_per_viewer_day between 1 and 50),
  updated_by uuid, updated_at timestamptz not null default now()
);
insert into private.ad_settings(id) values (true) on conflict do nothing;
revoke all on private.ad_settings from public, anon, authenticated;

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  objective text not null check (objective in ('alcance', 'visitas', 'pedidos', 'mensagens')),
  total_cents integer not null check (total_cents between 100 and 100000000),
  days smallint not null check (days between 1 and 90),
  daily_cents integer generated always as (total_cents / days) stored,
  status text not null default 'pendente' check (status in ('pendente', 'ativa', 'pausada', 'recusada', 'encerrada', 'cancelada')),
  charge_id uuid unique references public.platform_charges(id) on delete restrict,
  paid_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 300),
  starts_at timestamptz,
  ends_at timestamptz,
  pricing jsonb not null default '{}'::jsonb,
  op_id uuid not null unique,
  is_test boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'ativa') <= (paid_at is not null and approved_at is not null and starts_at is not null))
);
create unique index if not exists ad_campaigns_post_running_idx on public.ad_campaigns(post_id) where status in ('pendente', 'ativa', 'pausada');
create index if not exists ad_campaigns_business_idx on public.ad_campaigns(business_id, created_at desc);
create index if not exists ad_campaigns_post_idx on public.ad_campaigns(post_id);
create index if not exists ad_campaigns_active_idx on public.ad_campaigns(status, ends_at);
create index if not exists ad_campaigns_approved_by_idx on public.ad_campaigns(approved_by);
create index if not exists ad_campaigns_created_by_idx on public.ad_campaigns(created_by);

create table if not exists public.ad_campaign_regions (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  region_id uuid not null references public.commercial_regions(id) on delete restrict,
  primary key (campaign_id, region_id)
);
create index if not exists ad_campaign_regions_region_idx on public.ad_campaign_regions(region_id);

create table if not exists public.ad_events (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  kind text not null check (kind in ('impressao', 'clique')),
  viewer_key text not null check (char_length(viewer_key) = 64),
  day date not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, kind, viewer_key, day)
);
create index if not exists ad_events_viewer_day_idx on public.ad_events(viewer_key, day);
alter table public.ad_campaigns enable row level security;
alter table public.ad_campaign_regions enable row level security;
alter table public.ad_events enable row level security;
-- tudo pelas funções abaixo (anunciante, feed e Master)
revoke all on public.ad_campaigns, public.ad_campaign_regions, public.ad_events from public, anon, authenticated;

-- regiões: campanha paga em andamento trava centro, raio, status e retirada de municípios (0028)
create or replace function private.region_in_use(_region uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ad_campaign_regions cr join public.ad_campaigns c on c.id = cr.campaign_id
                  where cr.region_id = _region
                    and (c.status in ('ativa', 'pausada') or (c.status = 'pendente' and c.paid_at is not null)))
$$;
create or replace function private.region_campaign_count(_region uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.ad_campaign_regions cr join public.ad_campaigns c on c.id = cr.campaign_id
   where cr.region_id = _region and c.status = 'ativa' and c.ends_at > now()
$$;

create or replace function private.ad_status_label(c public.ad_campaigns) returns text
language sql stable set search_path = '' as $$
  select case
    when c.status = 'pendente' and c.paid_at is null then 'aguardando_pagamento'
    when c.status = 'pendente' then 'aguardando_aprovacao'
    when c.status = 'ativa' and c.ends_at <= now() then 'encerrada'
    else c.status end
$$;

-- ativa quando pago + aprovado; o período contratado começa agora
create or replace function private.ad_try_activate(_campaign uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.ad_campaigns set status = 'ativa', starts_at = now(), ends_at = now() + make_interval(days => days), updated_at = now()
   where id = _campaign and status = 'pendente' and paid_at is not null and approved_at is not null;
end $$;

create or replace function private.ad_sweep() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.ad_campaigns set status = 'encerrada', updated_at = now() where status in ('ativa', 'pausada') and ends_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- baixa da cobrança (webhook do Mercado Pago ou registro manual do Master) → campanha
create or replace function private.ad_on_charge_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if new.status = 'paga' and old.status is distinct from 'paga' then
    update public.ad_campaigns set paid_at = coalesce(new.paid_at, now()), updated_at = now()
     where charge_id = new.id and paid_at is null and status = 'pendente' returning id into cid;
    if cid is not null then perform private.ad_try_activate(cid); end if;
  elsif new.status = 'cancelada' and old.status = 'aberta' then
    update public.ad_campaigns set status = 'cancelada', updated_at = now() where charge_id = new.id and status = 'pendente' and paid_at is null;
  end if;
  return new;
end $$;
drop trigger if exists platform_charges_ads on public.platform_charges;
create trigger platform_charges_ads after update of status on public.platform_charges for each row execute function private.ad_on_charge_change();

-- ---------- anunciante ----------
create or replace function private.ad_price(_regions integer, _days integer, _total integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'min_cents', greatest(s.min_total_cents, s.min_daily_cents_per_region * greatest(_regions, 1) * greatest(_days, 1)),
    'min_total_cents', s.min_total_cents, 'min_daily_cents_per_region', s.min_daily_cents_per_region,
    'min_days', s.min_days, 'max_days', s.max_days, 'max_regions', s.max_regions,
    'total_cents', _total, 'daily_cents', case when _days > 0 then _total / _days end)
    from private.ad_settings s where s.id
$$;

create or replace function public.ad_quote(_regions uuid[], _days integer, _total_cents integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb; n int := coalesce(cardinality(_regions), 0); ok_regions int;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*) into ok_regions from public.commercial_regions where id = any(coalesce(_regions, '{}')) and status = 'ativa' and kind = 'raio';
  p := private.ad_price(n, coalesce(_days, 0), coalesce(_total_cents, 0));
  return p || jsonb_build_object('regions', n, 'valid_regions', ok_regions,
    'ok', n > 0 and ok_regions = n and n <= (p->>'max_regions')::int and _days between (p->>'min_days')::int and (p->>'max_days')::int
          and _total_cents >= (p->>'min_cents')::int);
end $$;

create or replace function public.merchant_create_campaign(_business uuid, _post uuid, _objective text, _regions uuid[], _days integer, _total_cents integer, _op uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.businesses%rowtype; p jsonb; n int; cid uuid; chid uuid; existing public.ad_campaigns%rowtype; names text;
begin
  if not public.has_business_permission(_business, 'store.customize') then raise exception 'forbidden' using errcode = '42501'; end if;
  if _op is null then raise exception 'Operação inválida.' using errcode = 'P0001'; end if;
  select * into existing from public.ad_campaigns where op_id = _op;
  if found then
    if existing.business_id <> _business then raise exception 'forbidden' using errcode = '42501'; end if;
    return jsonb_build_object('campaign_id', existing.id, 'charge_id', existing.charge_id, 'amount_cents', existing.total_cents, 'repetida', true);
  end if;
  perform private.limit_for('ads.create');
  select * into b from public.businesses where id = _business;
  if b.status <> 'active' then raise exception 'O estabelecimento precisa estar publicado para anunciar.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.posts where id = _post and business_id = _business and status = 'published') then
    raise exception 'Escolha uma publicação do próprio estabelecimento.' using errcode = 'P0001';
  end if;
  if _objective not in ('alcance', 'visitas', 'pedidos', 'mensagens') then raise exception 'Objetivo inválido.' using errcode = 'P0001'; end if;
  select array_agg(distinct x) into _regions from unnest(coalesce(_regions, '{}')) x;
  n := coalesce(cardinality(_regions), 0);
  p := private.ad_price(n, coalesce(_days, 0), coalesce(_total_cents, 0));
  if n = 0 then raise exception 'Escolha ao menos uma região.' using errcode = 'P0001'; end if;
  if n > (p->>'max_regions')::int then raise exception 'Máximo de % regiões por campanha.', p->>'max_regions' using errcode = 'P0001'; end if;
  if (select count(*) from public.commercial_regions where id = any(_regions) and status = 'ativa' and kind = 'raio') <> n then
    raise exception 'Alguma região escolhida não está ativa.' using errcode = 'P0001';
  end if;
  if _days is null or _days < (p->>'min_days')::int or _days > (p->>'max_days')::int then
    raise exception 'Duração entre % e % dias.', p->>'min_days', p->>'max_days' using errcode = 'P0001';
  end if;
  if _total_cents is null or _total_cents < (p->>'min_cents')::int then
    raise exception 'Investimento mínimo para esta abrangência: R$ %.', to_char((p->>'min_cents')::int / 100.0, 'FM999990D00') using errcode = 'P0001';
  end if;
  if exists (select 1 from public.ad_campaigns where post_id = _post and status in ('pendente', 'ativa', 'pausada')) then
    raise exception 'Esta publicação já tem uma campanha em andamento.' using errcode = 'P0001';
  end if;
  select string_agg(name, ', ' order by name) into names from public.commercial_regions where id = any(_regions);
  insert into public.platform_charges(business_id, kind, description, amount_cents, due_on, created_by)
  values (_business, 'outro', left('Publicação patrocinada · ' || _days || ' dia(s) · ' || names, 200), _total_cents, current_date + 3, auth.uid())
  returning id into chid;
  insert into public.ad_campaigns(business_id, post_id, objective, total_cents, days, charge_id, pricing, op_id, is_test, created_by)
  values (_business, _post, _objective, _total_cents, _days, chid, p, _op, coalesce(b.is_test, false), auth.uid())
  returning id into cid;
  insert into public.ad_campaign_regions(campaign_id, region_id) select cid, r from unnest(_regions) r;
  perform private.audit('ads.create', 'ad_campaigns', cid::text, jsonb_build_object('business', _business, 'total', _total_cents, 'days', _days, 'regions', _regions));
  return jsonb_build_object('campaign_id', cid, 'charge_id', chid, 'amount_cents', _total_cents, 'repetida', false);
exception when unique_violation then
  raise exception 'Esta publicação já tem uma campanha em andamento.' using errcode = 'P0001';
end $$;

create or replace function public.merchant_cancel_campaign(_campaign uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.ad_campaigns%rowtype;
begin
  select * into c from public.ad_campaigns where id = _campaign for update;
  if not found or not public.has_business_permission(c.business_id, 'store.customize') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status <> 'pendente' or c.paid_at is not null then
    raise exception 'Campanha já paga: fale com a Tucaí para pausar ou encerrar.' using errcode = 'P0001';
  end if;
  update public.ad_campaigns set status = 'cancelada', updated_at = now() where id = _campaign;
  update public.platform_charges set status = 'cancelada' where id = c.charge_id and status = 'aberta';
  perform private.audit('ads.cancel', 'ad_campaigns', _campaign::text, '{}'::jsonb);
end $$;

create or replace function public.merchant_campaigns(_business uuid)
returns table (id uuid, post_id uuid, post_excerpt text, objective text, status text, total_cents integer, days smallint, daily_cents integer,
               regions text[], starts_at timestamptz, ends_at timestamptz, paid boolean, approved boolean, review_note text,
               charge_id uuid, charge_status text, impressions bigint, clicks bigint, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'store.customize') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.ad_sweep();
  return query
    select c.id, c.post_id, left(p.body, 120), c.objective, private.ad_status_label(c), c.total_cents, c.days, c.daily_cents,
           (select array_agg(r.name order by r.name) from public.ad_campaign_regions cr join public.commercial_regions r on r.id = cr.region_id where cr.campaign_id = c.id),
           c.starts_at, c.ends_at, c.paid_at is not null, c.approved_at is not null, c.review_note, c.charge_id, ch.status::text,
           (select count(*) from public.ad_events e where e.campaign_id = c.id and e.kind = 'impressao'),
           (select count(*) from public.ad_events e where e.campaign_id = c.id and e.kind = 'clique'),
           c.created_at
      from public.ad_campaigns c left join public.posts p on p.id = c.post_id left join public.platform_charges ch on ch.id = c.charge_id
     where c.business_id = _business
     order by c.created_at desc limit 100;
end $$;

-- ---------- feed ----------
create or replace function public.sponsored_feed(_city uuid, _limit integer default 3)
returns table (campaign_id uuid, post_id uuid, slot_every smallint)
language plpgsql security definer set search_path = '' as $$
declare s private.ad_settings%rowtype; seen_today int;
begin
  if auth.uid() is null or _city is null then return; end if;
  perform private.ad_sweep();
  select * into s from private.ad_settings where id;
  -- teto diário de campanhas diferentes por pessoa (evita excesso)
  select count(distinct e.campaign_id) into seen_today from public.ad_events e
   where e.kind = 'impressao' and e.day = (now() at time zone 'America/Sao_Paulo')::date
     and e.viewer_key = encode(extensions.digest(auth.uid()::text || ':' || e.campaign_id::text, 'sha256'), 'hex');
  return query
    with eligible as (
      select distinct c.id, c.post_id,
             exists (select 1 from public.ad_events e where e.campaign_id = c.id and e.kind = 'impressao'
                      and e.day = (now() at time zone 'America/Sao_Paulo')::date
                      and e.viewer_key = encode(extensions.digest(auth.uid()::text || ':' || c.id::text, 'sha256'), 'hex')) as seen
        from public.ad_campaigns c
        join public.posts p on p.id = c.post_id and p.status = 'published'
        join public.ad_campaign_regions cr on cr.campaign_id = c.id
        join public.commercial_regions r on r.id = cr.region_id and r.status = 'ativa'
        join public.region_municipalities x on x.region_id = r.id and not x.excluded
        join public.cities ci on ci.ibge_code = x.ibge_code and ci.id = _city
       where c.status = 'ativa' and now() >= c.starts_at and now() < c.ends_at
         and (not c.is_test or public.viewer_sees_tests())
         and not public.is_blocked_between(auth.uid(), p.author_id))
    select e.id, e.post_id, s.feed_every from eligible e
     where e.seen or seen_today < s.max_campaigns_per_viewer_day
     order by e.seen, random()
     limit least(greatest(coalesce(_limit, 3), 1), 5);
end $$;

-- impressão/clique válidos: únicos por pessoa/campanha/dia; clique exige impressão; equipe da loja não conta
create or replace function public.ad_track(_campaign uuid, _kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c public.ad_campaigns%rowtype; vk text; d date := (now() at time zone 'America/Sao_Paulo')::date; n int;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if _kind not in ('impressao', 'clique') then raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  perform private.limit_for('ads.track');
  select * into c from public.ad_campaigns where id = _campaign;
  if not found or c.status <> 'ativa' or now() < c.starts_at or now() >= c.ends_at then return false; end if;
  if public.is_business_member(c.business_id) then return false; end if;
  vk := encode(extensions.digest(auth.uid()::text || ':' || _campaign::text, 'sha256'), 'hex');
  if _kind = 'clique' and not exists (select 1 from public.ad_events where campaign_id = _campaign and kind = 'impressao' and viewer_key = vk and day = d) then
    return false;
  end if;
  insert into public.ad_events(campaign_id, kind, viewer_key, day) values (_campaign, _kind, vk, d) on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---------- Master ----------
create or replace function public.admin_ads_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.ad_sweep();
  return jsonb_build_object(
    'receita_cents', coalesce((select sum(total_cents) from public.ad_campaigns where paid_at is not null and not is_test and status <> 'recusada'), 0),
    'receita_mes_cents', coalesce((select sum(total_cents) from public.ad_campaigns where paid_at >= date_trunc('month', now()) and not is_test and status <> 'recusada'), 0),
    'ativas', (select count(*) from public.ad_campaigns where status = 'ativa' and ends_at > now()),
    'aguardando_aprovacao', (select count(*) from public.ad_campaigns where status = 'pendente' and paid_at is not null),
    'aguardando_pagamento', (select count(*) from public.ad_campaigns where status = 'pendente' and paid_at is null),
    'reembolso_pendente', (select count(*) from public.ad_campaigns where status = 'recusada' and paid_at is not null),
    'impressoes', (select count(*) from public.ad_events where kind = 'impressao'),
    'cliques', (select count(*) from public.ad_events where kind = 'clique'),
    'config', (select to_jsonb(s) - 'id' - 'updated_by' from private.ad_settings s where s.id));
end $$;

create or replace function public.admin_ad_campaigns(_status text default null, _region uuid default null, _q text default null, _limit integer default 20, _offset integer default 0)
returns table (id uuid, business_id uuid, business_name text, post_excerpt text, objective text, status text, total_cents integer, days smallint,
               regions text[], starts_at timestamptz, ends_at timestamptz, paid boolean, approved boolean, review_note text, is_test boolean,
               impressions bigint, clicks bigint, created_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select c.id, c.business_id, b.name, left(p.body, 160), c.objective, private.ad_status_label(c), c.total_cents, c.days,
           (select array_agg(r.name order by r.name) from public.ad_campaign_regions cr join public.commercial_regions r on r.id = cr.region_id where cr.campaign_id = c.id),
           c.starts_at, c.ends_at, c.paid_at is not null, c.approved_at is not null, c.review_note, c.is_test,
           (select count(*) from public.ad_events e where e.campaign_id = c.id and e.kind = 'impressao'),
           (select count(*) from public.ad_events e where e.campaign_id = c.id and e.kind = 'clique'),
           c.created_at, count(*) over ()
      from public.ad_campaigns c join public.businesses b on b.id = c.business_id left join public.posts p on p.id = c.post_id
     where (_status is null or private.ad_status_label(c) = _status)
       and (_region is null or exists (select 1 from public.ad_campaign_regions cr where cr.campaign_id = c.id and cr.region_id = _region))
       and (_q is null or btrim(_q) = '' or private.fold(b.name) like '%' || private.fold(_q) || '%')
     order by (c.status = 'pendente' and c.paid_at is not null) desc, c.created_at desc
     limit least(greatest(coalesce(_limit, 20), 1), 100) offset greatest(coalesce(_offset, 0), 0);
end $$;

create or replace function public.admin_review_campaign(_campaign uuid, _approve boolean, _note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.ad_campaigns%rowtype; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_master();
  perform private.limit_for('admin.ads');
  select * into c from public.ad_campaigns where id = _campaign for update;
  if not found then raise exception 'Campanha não encontrada.' using errcode = 'P0001'; end if;
  if c.status <> 'pendente' then raise exception 'Só campanhas pendentes passam por aprovação.' using errcode = 'P0001'; end if;
  if _approve then
    update public.ad_campaigns set approved_at = now(), approved_by = auth.uid(), review_note = note, updated_at = now() where id = _campaign;
    perform private.ad_try_activate(_campaign);
    perform private.audit('ads.approve', 'ad_campaigns', _campaign::text, jsonb_build_object('note', note));
    return case when c.paid_at is null then 'aprovada_aguardando_pagamento' else 'ativa' end;
  end if;
  if note is null then raise exception 'Informe o motivo da recusa (o anunciante verá).' using errcode = 'P0001'; end if;
  update public.ad_campaigns set status = 'recusada', review_note = note, approved_by = auth.uid(), updated_at = now() where id = _campaign;
  if c.paid_at is null then update public.platform_charges set status = 'cancelada' where id = c.charge_id and status = 'aberta'; end if;
  perform private.audit('ads.reject', 'ad_campaigns', _campaign::text, jsonb_build_object('note', note, 'paid', c.paid_at is not null));
  return case when c.paid_at is not null then 'recusada_reembolso_pendente' else 'recusada' end;
end $$;

-- pausar/retomar/encerrar (pausa não estende o período contratado)
create or replace function public.admin_set_campaign_status(_campaign uuid, _status text, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.ad_campaigns%rowtype;
begin
  perform private.require_master();
  perform private.limit_for('admin.ads');
  if nullif(btrim(coalesce(_reason, '')), '') is null then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  select * into c from public.ad_campaigns where id = _campaign for update;
  if not found then raise exception 'Campanha não encontrada.' using errcode = 'P0001'; end if;
  if not ((c.status = 'ativa' and _status in ('pausada', 'encerrada')) or (c.status = 'pausada' and _status in ('ativa', 'encerrada'))) then
    raise exception 'Mudança não permitida.' using errcode = 'P0001';
  end if;
  update public.ad_campaigns set status = _status, review_note = left(_reason, 300), updated_at = now() where id = _campaign;
  perform private.audit('ads.status', 'ad_campaigns', _campaign::text, jsonb_build_object('from', c.status, 'to', _status, 'reason', _reason));
end $$;

create or replace function public.admin_ad_settings_set(_min_total_cents integer, _min_daily_cents_per_region integer, _min_days integer, _max_days integer,
                                                        _max_regions integer, _feed_every integer, _max_campaigns_per_viewer_day integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.ads');
  update private.ad_settings set min_total_cents = _min_total_cents, min_daily_cents_per_region = _min_daily_cents_per_region, min_days = _min_days,
         max_days = _max_days, max_regions = _max_regions, feed_every = _feed_every, max_campaigns_per_viewer_day = _max_campaigns_per_viewer_day,
         updated_by = auth.uid(), updated_at = now() where id;
  if _min_days > _max_days then raise exception 'Duração mínima maior que a máxima.' using errcode = 'P0001'; end if;
  perform private.audit('ads.settings', 'ad_settings', 'ads', jsonb_build_object('min_total', _min_total_cents, 'min_daily_region', _min_daily_cents_per_region,
    'days', jsonb_build_array(_min_days, _max_days), 'max_regions', _max_regions, 'feed_every', _feed_every, 'cap', _max_campaigns_per_viewer_day));
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.ad_status_label(public.ad_campaigns)', 'private.ad_try_activate(uuid)', 'private.ad_sweep()', 'private.ad_on_charge_change()',
                           'private.ad_price(integer, integer, integer)', 'private.region_in_use(uuid)', 'private.region_campaign_count(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.ad_quote(uuid[], integer, integer)', 'public.merchant_create_campaign(uuid, uuid, text, uuid[], integer, integer, uuid)',
    'public.merchant_cancel_campaign(uuid)', 'public.merchant_campaigns(uuid)', 'public.sponsored_feed(uuid, integer)', 'public.ad_track(uuid, text)',
    'public.admin_ads_summary()', 'public.admin_ad_campaigns(text, uuid, text, integer, integer)', 'public.admin_review_campaign(uuid, boolean, text)',
    'public.admin_set_campaign_status(uuid, text, text)', 'public.admin_ad_settings_set(integer, integer, integer, integer, integer, integer, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0029', '0029_publicidade.sql', 'applied');
    raise notice 'Tucaí 0029: aplicada agora';
  end if;
end $tucai_0029$;

-- ===================== supabase/migrations/0030_manutencao.sql =====================
do $tucai_0030$
begin
  if exists (select 1 from private.tucai_migrations where version = '0030') then
    raise notice 'Tucaí 0030: já aplicada';
  else
    execute $tucai_sql$
-- 0030_manutencao: modo manutenção global, controlado pelo Master (com MFA).
--  Estados: normal → preparando (novas operações bloqueadas; o que já começou pode terminar) → manutencao
--  (bloqueio total para usuários comuns; só concluir entregas em rota e fechar comandas/caixas já abertos) → normal.
--  * Bloqueio NO BANCO: gatilho único (private.maintenance_guard) nas tabelas de escrita — vale para RPCs e para
--    escrita direta pela API. Não depende de esconder telas.
--  * Não bloqueia: Master (MFA), processos do sistema sem usuário (webhook de pagamento via Worker, varreduras),
--    notificações/auditoria/eventos gerados dentro de operações permitidas. Nenhuma transação é interrompida:
--    o gatilho só recusa a próxima gravação; nada é cancelado ou apagado.
--  * Recuperação independente: supabase/admin/manutencao_recuperar.sql (SQL Editor) e /api/health no Worker.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.maintenance', 60, 600)
on conflict (action) do nothing;

create table if not exists private.platform_state (
  id boolean primary key default true check (id),
  mode text not null default 'normal' check (mode in ('normal', 'preparando', 'manutencao')),
  reason text check (reason is null or char_length(reason) <= 300),
  eta timestamptz,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  prepared_at timestamptz,
  started_at timestamptz
);
insert into private.platform_state(id) values (true) on conflict do nothing;
revoke all on private.platform_state from public, anon, authenticated;

create or replace function private.platform_mode() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select mode from private.platform_state where id), 'normal')
$$;

create or replace function private.maintenance_block() returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'A Tucaí está em manutenção. Tente novamente em breve.' using errcode = 'P0001', hint = 'manutencao';
end $$;

-- operações comuns bloqueadas fora do modo normal (para RPCs que não gravam, ex.: abrir checkout)
create or replace function private.require_operational() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.platform_mode() <> 'normal' and auth.uid() is not null and not private.is_master_ok() then
    perform private.maintenance_block();
  end if;
end $$;

create or replace function private.maintenance_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m text := private.platform_mode(); v_full boolean;
begin
  if m = 'normal' or auth.uid() is null or private.is_master_ok() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_full := m = 'manutencao';
  case tg_table_name
    when 'orders' then
      -- sem pedidos novos; em manutenção só avanços que encerram (rota, entregue, retirado, cancelado, recusado)
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;
      if v_full and tg_op = 'UPDATE' and new.status is distinct from old.status
         and new.status::text not in ('out_for_delivery', 'delivered', 'picked_up', 'cancelled', 'rejected') then
        perform private.maintenance_block();
      end if;
    when 'deliveries' then
      -- corridas em andamento continuam (coleta, código, entrega, liberação); em manutenção ninguém assume corrida nova
      if v_full and tg_op = 'UPDATE' and new.status::text = 'accepted' and old.status::text is distinct from 'accepted' then
        perform private.maintenance_block();
      end if;
    when 'business_tabs' then
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;
      if v_full and tg_op = 'UPDATE' and new.status not in ('fechada', 'cancelada') and new.status is distinct from old.status then
        perform private.maintenance_block();
      end if;
    when 'business_tab_items' then
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;
    when 'cash_sessions' then
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;      -- fechar caixa aberto continua possível
    when 'cash_movements' then
      if tg_op = 'INSERT' and new.tab_id is null then perform private.maintenance_block(); end if;  -- só o pagamento ao fechar comanda
    when 'couriers' then
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;      -- ficar indisponível continua possível
    else
      perform private.maintenance_block();                                       -- novas publicações, cardápio, loja, cobranças…
  end case;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'orders', 'deliveries', 'business_tabs', 'business_tab_items', 'cash_sessions', 'cash_movements', 'couriers',
    'platform_charges', 'ad_campaigns', 'posts', 'post_comments', 'post_likes', 'scraps', 'testimonials', 'community_topics', 'topic_replies',
    'communities', 'community_members', 'poll_votes', 'follows', 'friendships', 'business_follows', 'reviews', 'products', 'menu_categories',
    'option_groups', 'options', 'services', 'business_hours', 'businesses', 'business_members', 'business_tables', 'business_expenses',
    'business_ingredients', 'product_recipe_items', 'business_product_costs', 'jobs', 'job_applications', 'profiles', 'social_profiles'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_maintenance', t);
      execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.maintenance_guard()', t || '_maintenance', t);
    end if;
  end loop;
end $$;

-- checkout de cobrança (Worker) também respeita a manutenção; a confirmação do webhook não passa por aqui
create or replace function public.payable_charge(_charge uuid)
returns table (id uuid, business_id uuid, business_name text, description text, amount_cents integer, kind public.charge_kind)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_operational();
  perform private.limit_for('payments.checkout');
  return query
    select ch.id, ch.business_id, b.name, ch.description, ch.amount_cents, ch.kind
      from public.platform_charges ch join public.businesses b on b.id = ch.business_id
     where ch.id = _charge and ch.status = 'aberta'
       and (public.has_business_permission(ch.business_id, 'settings.manage') or public.has_business_permission(ch.business_id, 'reports.view')
            or private.is_master_ok());
end $$;

-- ---------- público: só o necessário para a página de manutenção ----------
create or replace function public.platform_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('mode', s.mode, 'eta', s.eta) from private.platform_state s where s.id
$$;

-- ---------- Master ----------
create or replace function private.maintenance_inflight() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pedidos_abertos', (select count(*) from public.orders where status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery')),
    'pedidos_aguardando_aceite', (select count(*) from public.orders where status = 'placed'),
    'entregas_em_rota', (select count(*) from public.deliveries where status in ('accepted', 'picked_up')),
    'comandas_abertas', (select count(*) from public.business_tabs where status in ('aberta', 'aguardando_pagamento')),
    'caixas_abertos', (select count(*) from public.cash_sessions where status = 'aberto'),
    'cobrancas_em_aberto', (select count(*) from public.platform_charges where status = 'aberta'),
    'campanhas_aguardando_pagamento', (select count(*) from public.ad_campaigns where status = 'pendente' and paid_at is null))
$$;

-- verificações de integridade (relatório; não corrige nada sozinho)
create or replace function private.maintenance_integrity() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pedido_em_rota_sem_coleta', (select count(*) from public.orders o join public.deliveries d on d.order_id = o.id
                                   where o.status = 'out_for_delivery' and d.status not in ('picked_up', 'delivered')),
    'entrega_coletada_pedido_inconsistente', (select count(*) from public.deliveries d join public.orders o on o.id = d.order_id
                                               where d.status = 'picked_up' and o.status not in ('out_for_delivery', 'delivered')),
    'comanda_fechada_pagamento_diferente', (select count(*) from public.business_tabs t
                                             where t.status = 'fechada' and coalesce((select sum(amount_cents) from public.cash_movements m where m.tab_id = t.id and m.kind = 'venda'), 0)
                                                   <> private.tab_total(t.id) - t.discount_cents),
    'caixa_aberto_mais_de_24h', (select count(*) from public.cash_sessions where status = 'aberto' and opened_at < now() - interval '24 hours'),
    'campanha_ativa_vencida', (select count(*) from public.ad_campaigns where status = 'ativa' and ends_at <= now()))
$$;

create or replace function public.admin_maintenance_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.platform_state%rowtype;
begin
  perform private.require_master();
  select * into s from private.platform_state where id;
  return jsonb_build_object('mode', s.mode, 'reason', s.reason, 'eta', s.eta, 'changed_at', s.changed_at,
    'changed_by', (select full_name from public.profiles where id = s.changed_by), 'prepared_at', s.prepared_at, 'started_at', s.started_at,
    'em_andamento', private.maintenance_inflight(), 'integridade', private.maintenance_integrity(),
    'mfa', private.current_aal() = 'aal2');
end $$;

-- transições: normal→preparando→manutencao; preparando/manutencao→normal. Exige MFA, motivo e confirmação digitada.
create or replace function public.admin_set_maintenance(_mode text, _reason text, _eta timestamptz, _confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.platform_state%rowtype; r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  perform private.require_master_mfa();
  perform private.limit_for('admin.maintenance');
  select * into s from private.platform_state where id for update;
  if _mode not in ('normal', 'preparando', 'manutencao') then raise exception 'Estado inválido.' using errcode = 'P0001'; end if;
  if _mode = s.mode then raise exception 'A plataforma já está neste estado.' using errcode = 'P0001'; end if;
  if s.mode = 'normal' and _mode = 'manutencao' then
    raise exception 'Passe primeiro por "Preparando manutenção" para as operações em andamento terminarem.' using errcode = 'P0001';
  end if;
  if upper(btrim(coalesce(_confirm, ''))) <> (case when _mode = 'normal' then 'NORMAL' else 'MANUTENCAO' end) then
    raise exception 'Digite % para confirmar.', (case when _mode = 'normal' then 'NORMAL' else 'MANUTENCAO' end) using errcode = 'P0001';
  end if;
  if _mode <> 'normal' and (r is null or char_length(r) < 5) then raise exception 'Informe o motivo (mínimo 5 caracteres).' using errcode = 'P0001'; end if;
  if _eta is not null and _eta <= now() then raise exception 'A previsão de retorno precisa ser no futuro.' using errcode = 'P0001'; end if;
  update private.platform_state set mode = _mode, reason = case when _mode = 'normal' then null else coalesce(r, reason) end,
         eta = case when _mode = 'normal' then null else coalesce(_eta, eta) end, changed_by = auth.uid(), changed_at = now(),
         prepared_at = case when _mode = 'preparando' then now() when _mode = 'normal' then null else prepared_at end,
         started_at = case when _mode = 'manutencao' then now() when _mode = 'normal' then null else started_at end
   where id;
  perform private.audit('platform.maintenance', 'platform_state', _mode, jsonb_build_object('from', s.mode, 'to', _mode, 'reason', r, 'eta', _eta,
    'em_andamento', private.maintenance_inflight()));
  if _mode = 'normal' then perform private.ad_sweep(); end if;
  return jsonb_build_object('mode', _mode, 'em_andamento', private.maintenance_inflight(), 'integridade', private.maintenance_integrity());
end $$;

-- recuperação independente do app (SQL Editor, como postgres): volta ao normal e registra na auditoria
create or replace function private.maintenance_force_normal(_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.platform_state%rowtype;
begin
  select * into s from private.platform_state where id for update;
  update private.platform_state set mode = 'normal', reason = null, eta = null, changed_by = null, changed_at = now(), prepared_at = null, started_at = null where id;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'platform.maintenance_recovery', 'platform_state', 'normal', jsonb_build_object('from', s.mode, 'reason', coalesce(_reason, 'recuperação manual')));
  return jsonb_build_object('mode', 'normal', 'anterior', s.mode, 'integridade', private.maintenance_integrity());
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.maintenance_force_normal(text)', 'private.platform_mode()', 'private.maintenance_block()', 'private.require_operational()', 'private.maintenance_guard()',
                           'private.maintenance_inflight()', 'private.maintenance_integrity()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.platform_status() from public;
  grant execute on function public.platform_status() to anon, authenticated;
  foreach f in array array['public.admin_maintenance_status()', 'public.admin_set_maintenance(text, text, timestamptz, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0030', '0030_manutencao.sql', 'applied');
    raise notice 'Tucaí 0030: aplicada agora';
  end if;
end $tucai_0030$;

-- ===================== supabase/migrations/0031_excluir_dados_teste.sql =====================
do $tucai_0031$
begin
  if exists (select 1 from private.tucai_migrations where version = '0031') then
    raise notice 'Tucaí 0031: já aplicada';
  else
    execute $tucai_sql$
-- 0031_excluir_dados_teste: botão "Excluir todos os dados de teste" (Master, aba Logins).
--  * Remove TODOS os lotes de homologação ativos (estabelecimentos [Teste], pedidos, entregas, comandas, caixas,
--    campanhas, cobranças e logins de teste) e qualquer resto marcado como teste (estabelecimento/pedido is_test).
--  * Dados reais nunca entram: só o que está nos lotes de teste ou marcado is_test pela plataforma.
--  * Exige Master e a palavra EXCLUIR digitada. Auditado com as contagens. A remoção por lote usa a mesma rotina.

-- remoção de um lote (corpo da 0015, agora compartilhado)
create or replace function private.remove_test_run(_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r private.test_data_runs%rowtype; u uuid; n_orders int; n_biz int; n_users int := 0;
begin
  select * into r from private.test_data_runs where id = _run and removed_at is null for update;
  if not found then return null; end if;
  perform set_config('tucai.internal', 'on', true);
  delete from public.orders where business_id = any(r.business_ids) or customer_id = any(r.user_ids);
  get diagnostics n_orders = row_count;
  delete from public.businesses where id = any(r.business_ids);
  get diagnostics n_biz = row_count;
  delete from public.couriers where user_id = any(r.user_ids);
  foreach u in array r.user_ids loop
    begin
      delete from auth.users where id = u;
      if found then n_users := n_users + 1; end if;
    exception when foreign_key_violation then
      -- conta citada em registros que devem ser preservados (ex.: auditoria): bloqueia e anonimiza
      perform private.anonymize_user(u);
      update auth.users set banned_until = 'infinity', email = 'removido-' || u::text || '@teste.example.com' where id = u;
      n_users := n_users + 1;
    end;
  end loop;
  update private.test_data_runs set removed_at = now() where id = r.id;
  return jsonb_build_object('pedidos', n_orders, 'estabelecimentos', n_biz, 'logins', n_users);
end $$;

create or replace function public.admin_remove_test_data(_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  res := private.remove_test_run(_run);
  if res is null then raise exception 'Lote de teste não encontrado.' using errcode = 'P0001'; end if;
  perform private.audit('test_data.remove', 'test_data_runs', _run::text, res);
end $$;

create or replace function public.admin_remove_all_test_data(_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run uuid; res jsonb; lotes int := 0; pedidos int := 0; estab int := 0; logins int := 0; n int;
begin
  perform private.require_master();
  if upper(btrim(coalesce(_confirm, ''))) <> 'EXCLUIR' then
    raise exception 'Digite EXCLUIR para confirmar.' using errcode = 'P0001';
  end if;
  perform private.limit_for('admin.test_data');
  for run in select id from private.test_data_runs where removed_at is null order by created_at loop
    res := private.remove_test_run(run);
    if res is not null then
      lotes := lotes + 1;
      pedidos := pedidos + (res->>'pedidos')::int; estab := estab + (res->>'estabelecimentos')::int; logins := logins + (res->>'logins')::int;
    end if;
  end loop;
  -- restos marcados como teste fora de lotes ativos (nunca dados reais)
  perform set_config('tucai.internal', 'on', true);
  delete from public.orders where is_test;
  get diagnostics n = row_count; pedidos := pedidos + n;
  delete from public.businesses where is_test;
  get diagnostics n = row_count; estab := estab + n;
  res := jsonb_build_object('lotes', lotes, 'pedidos', pedidos, 'estabelecimentos', estab, 'logins', logins);
  perform private.audit('test_data.remove_all', 'test_data_runs', null, res);
  return res;
end $$;

do $$
begin
  revoke all on function private.remove_test_run(uuid) from public, anon, authenticated;
  revoke all on function public.admin_remove_test_data(uuid) from public, anon;
  grant execute on function public.admin_remove_test_data(uuid) to authenticated;
  revoke all on function public.admin_remove_all_test_data(text) from public, anon;
  grant execute on function public.admin_remove_all_test_data(text) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0031', '0031_excluir_dados_teste.sql', 'applied');
    raise notice 'Tucaí 0031: aplicada agora';
  end if;
end $tucai_0031$;

-- ===================== supabase/migrations/0032_perfis_simplificados.sql =====================
do $tucai_0032$
begin
  if exists (select 1 from private.tucai_migrations where version = '0032') then
    raise notice 'Tucaí 0032: já aplicada';
  else
    execute $tucai_sql$
-- 0032_perfis_simplificados: quatro perfis operacionais (Empresário, Funcionário, Entregador, Cliente) + Master.
--  * Nada é removido do esquema: enums, colunas e papéis internos continuam (owner/manager/attendant/kitchen/courier_own).
--    A simplificação é de experiência e de contas de teste.
--  * Funcionário (attendant) acumula atendimento e cozinha: pedidos, comandas, preparo e status. Sem financeiro,
--    configurações críticas nem permissões — só com permissão explícita do empresário (0027).
--  * Entregador próprio (courier_own): recebe só as entregas que o próprio comércio atribuir a ele. Não vê os demais
--    pedidos da loja e não recebe ofertas da rede de entregadores independentes (que exige courier_partner + cadastro).
--  * Contas de teste: exatamente sete (Empresário 1 — Lanchonete, Empresário 2 — Supermercado, Funcionário — Lanchonete,
--    Entregador 1 — Independente, Entregador 2 — Próprio do supermercado, Cliente 1, Cliente 2). Lotes antigos não são
--    apagados nem reaproveitados: continuam até o Master removê-los.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('own_courier.update', 300, 600), ('merchant.own_courier', 300, 600)
on conflict (action) do nothing;

-- ---------- entregador próprio ----------
-- antes: courier_own via todos os pedidos da loja (orders.view). Agora só os atribuídos a ele (funções abaixo).
delete from public.role_permissions where member_role = 'courier_own' and permission = 'orders.view';

alter table public.orders add column if not exists own_courier_id uuid references auth.users(id) on delete set null;
create index if not exists orders_own_courier_idx on public.orders(own_courier_id);

create or replace function private.is_own_courier(_business uuid, _user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members where business_id = _business and user_id = _user and member_role = 'courier_own')
$$;

-- visibilidade do pedido: + entregador próprio atribuído (enquanto continuar na equipe)
create or replace function public.can_view_order(_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = _order and (
    o.customer_id = auth.uid()
    or public.has_business_permission(o.business_id, 'orders.view')
    or public.has_platform_permission('orders.view')
    or exists (select 1 from public.deliveries d where d.order_id = o.id and d.courier_id = auth.uid())
    or (o.own_courier_id = auth.uid() and private.is_own_courier(o.business_id, auth.uid()))))
$$;

-- equipe atribui (ou retira) o entregador próprio de um pedido de entrega própria
create or replace function public.merchant_assign_own_courier(_order uuid, _courier uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  if not public.has_business_permission(o.business_id, 'orders.update_status') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.own_courier');
  if o.fulfillment <> 'delivery_own' then raise exception 'Só pedidos com entrega própria do estabelecimento.' using errcode = 'P0001'; end if;
  if o.status not in ('accepted', 'preparing', 'ready') then raise exception 'Atribua o entregador antes da saída para entrega.' using errcode = 'P0001'; end if;
  if _courier is not null and not private.is_own_courier(o.business_id, _courier) then
    raise exception 'Escolha um entregador próprio da equipe.' using errcode = 'P0001';
  end if;
  update public.orders set own_courier_id = _courier where id = _order;
  insert into public.order_events(order_id, status, actor_id, note)
  values (_order, o.status, auth.uid(), case when _courier is null then 'Entregador próprio retirado' else 'Entregador próprio atribuído' end);
  if _courier is not null then
    perform private.notify_link(_courier, 'delivery_offer', o.customer_id, '/entregador/entregas', left('Nova entrega da loja: pedido #' || o.code || '.', 280));
  end if;
  perform private.audit('orders.own_courier', 'orders', _order::text, jsonb_build_object('courier', _courier));
end $$;

create or replace function public.merchant_own_couriers(_business uuid) returns table (user_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'orders.update_status') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.user_id, coalesce(p.full_name, 'Entregador') from public.business_members m left join public.profiles p on p.id = m.user_id
     where m.business_id = _business and m.member_role = 'courier_own' order by 2;
end $$;

-- painel do entregador próprio: só os pedidos atribuídos a ele
create or replace function public.own_courier_deliveries(_active boolean default true)
returns table (order_id uuid, order_code text, order_status public.order_status, business_id uuid, business_name text, business_address text,
               business_phone text, customer_name text, customer_phone text, delivery_address text, delivery_reference text,
               payment_method public.order_payment, total_cents integer, change_for_cents integer, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.code, o.status, b.id, b.name, b.address_line, b.phone, o.customer_name, o.customer_phone, o.delivery_address, o.delivery_reference,
         o.payment_method, o.total_cents, o.change_for_cents, o.created_at, o.updated_at
    from public.orders o join public.businesses b on b.id = o.business_id
   where auth.uid() is not null and o.own_courier_id = auth.uid() and private.is_own_courier(o.business_id, auth.uid())
     and o.fulfillment = 'delivery_own'
     and (case when _active then o.status in ('accepted', 'preparing', 'ready', 'out_for_delivery') else o.status in ('delivered', 'cancelled', 'rejected') end)
   order by o.created_at desc
   limit 100
$$;

-- saída e conclusão pelo entregador próprio atribuído
create or replace function public.own_courier_set_status(_order uuid, _status public.order_status) returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.orders where id = _order for update;
  if not found or o.own_courier_id is distinct from auth.uid() or not private.is_own_courier(o.business_id, auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.limit_for('own_courier.update');
  if not ((o.status = 'ready' and _status = 'out_for_delivery') or (o.status = 'out_for_delivery' and _status = 'delivered')) then
    raise exception 'Mudança de status não permitida (% → %).', o.status, _status using errcode = 'P0001';
  end if;
  update public.orders set status = _status where id = o.id;
  insert into public.order_events(order_id, status, actor_id, note) values (o.id, _status, auth.uid(), 'Entregador próprio');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id,
    'Pedido #' || o.code || ': ' || case _status when 'out_for_delivery' then 'saiu para entrega.' else 'entregue. Bom apetite!' end);
  return _status;
end $$;

-- ---------- contas de teste: sete perfis operacionais ----------
create or replace function private.test_login_key(l jsonb) returns text language sql immutable as $$
  select coalesce(l->>'key', case
    when l->>'role' = 'lojista' and l->>'label' like '%Lanchonete%' then 'restaurante'
    when l->>'role' = 'lojista' then 'lojista'
    when l->>'role' = 'entregador' then 'entregador'
    when l->>'label' = 'Cliente 2' then 'cliente2'
    when l->>'role' = 'cliente' then 'cliente1' end)
$$;

create or replace function private.admin_create_test_data_impl(_city uuid) returns jsonb
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
  b_lan uuid; b_sup uuid;
  u uuid; cat uuid; mc uuid; p uuid; g uuid; run uuid;
  k text; nome text;
  keys constant text[] := array['empresario1', 'empresario2', 'funcionario', 'entregador', 'entregador2', 'cliente1', 'cliente2'];
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  select * into c from public.cities where id = _city and is_active;
  if not found then raise exception 'Cidade não encontrada ou inativa.' using errcode = 'P0001'; end if;

  -- só reaproveita lote no formato novo (sete perfis); lote antigo fica como está até o Master remover
  select * into r from private.test_data_runs
   where city_id = c.id and removed_at is null and logins @> '[{"key":"empresario1"}]'::jsonb
   order by created_at desc limit 1 for update;
  if found then
    reuse := true;
    select coalesce(array_agg(l->>'key'), '{}') into have from jsonb_array_elements(r.logins) l;
    select id into b_lan from public.businesses where id = any(r.business_ids) and business_type = 'restaurante' order by created_at limit 1;
    select id into b_sup from public.businesses where id = any(r.business_ids) and business_type = 'loja' order by created_at limit 1;
  end if;

  foreach k in array keys loop
    continue when k = any(have);
    if k = 'funcionario' and b_lan is null then continue; end if;
    if k = 'entregador2' and b_sup is null then continue; end if;
    nome := case k
      when 'empresario1' then 'Empresário 1 — Lanchonete' when 'empresario2' then 'Empresário 2 — Supermercado'
      when 'funcionario' then 'Funcionário — Lanchonete' when 'entregador' then 'Entregador 1 — Independente'
      when 'entregador2' then 'Entregador 2 — Próprio do supermercado' when 'cliente1' then 'Cliente 1' else 'Cliente 2' end;
    u := private.create_auth_user(k || '-' || sfx || '@teste.example.com', pwd, nome);
    update public.profiles set phone = '(35) 99999-0000' where id = u;
    new_users := new_users || u;

    if k = 'empresario1' then
      select id into cat from public.categories where kind = 'restaurante' and not is_demo
       order by (slug ilike '%lanch%' or slug ilike '%hamburg%') desc, sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
      values ('[Teste] Lanchonete do Tuca', private.unique_business_slug('teste lanchonete ' || sfx), u, 'active', 'restaurante', cat, c.id,
              'Estabelecimento de HOMOLOGAÇÃO: entregas com entregador parceiro independente. Não aparece para clientes reais.',
              'Rua de Teste, 100 - Centro', '(35) 99999-0001', '(35) 99999-0001', 'partner', true, 1000, 30, 45)
      returning id into b_lan;
      insert into public.business_members(business_id, user_id, member_role) values (b_lan, u, 'owner') on conflict do nothing;
      insert into public.menu_categories(business_id, name, sort_order) values (b_lan, 'Lanches', 10) returning id into mc;
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b_lan, mc, 'X-Burger', 'Pão, hambúrguer, queijo e molho da casa.', 2500, 10) returning id into p;
      insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
      values (b_lan, p, 'Ponto da carne', 1, 1, 10) returning id into g;
      insert into public.options(business_id, group_id, name, sort_order) values (b_lan, g, 'Ao ponto', 10), (b_lan, g, 'Bem passado', 20);
      insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
      values (b_lan, p, 'Adicionais', 0, 2, 20) returning id into g;
      insert into public.options(business_id, group_id, name, price_delta_cents, sort_order) values (b_lan, g, 'Bacon', 500, 10), (b_lan, g, 'Ovo', 300, 20);
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b_lan, mc, 'Cheeseburger', 'Pão, hambúrguer, queijo e molho. Produto de homologação.', 2200, 15),
             (b_lan, mc, 'X-Salada', 'Hambúrguer, queijo, alface e tomate.', 2800, 20);
      insert into public.menu_categories(business_id, name, sort_order) values (b_lan, 'Bebidas', 20) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order)
      values (b_lan, mc, 'Refrigerante lata', 600, 10), (b_lan, mc, 'Suco natural 500 ml', 900, 20);
      insert into public.business_hours(business_id, weekday, opens, closes) select b_lan, d, '00:00', '24:00' from generate_series(0, 6) d;
      insert into public.jobs(business_id, city_id, title, area, description, employment_type, created_by)
      values (b_lan, c.id, '[Teste] Atendente', 'atendimento', 'Vaga de TESTE para validar candidaturas: atendimento ao público no balcão.', 'clt', u);
      new_biz := new_biz || b_lan;
    elsif k = 'empresario2' then
      select id into cat from public.categories where kind = 'loja' and not is_demo
       order by (slug ilike '%mercad%' or slug ilike '%super%') desc, sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, own_delivery_fee_cents, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
      values ('[Teste] Supermercado do Tuca', private.unique_business_slug('teste supermercado ' || sfx), u, 'active', 'loja', cat, c.id,
              'Estabelecimento de HOMOLOGAÇÃO: entregas com entregador próprio do supermercado. Não aparece para clientes reais.',
              'Avenida de Teste, 200 - Centro', '(35) 99999-0002', '(35) 99999-0002', 'own', 500, true, 0, 40, 60)
      returning id into b_sup;
      insert into public.business_members(business_id, user_id, member_role) values (b_sup, u, 'owner') on conflict do nothing;
      insert into public.menu_categories(business_id, name, sort_order) values (b_sup, 'Mercearia', 10) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order)
      values (b_sup, mc, 'Arroz 5 kg', 2990, 10), (b_sup, mc, 'Feijão 1 kg', 899, 20), (b_sup, mc, 'Café 500 g', 1690, 30);
      insert into public.menu_categories(business_id, name, sort_order) values (b_sup, 'Bebidas', 20) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order) values (b_sup, mc, 'Refrigerante 2 L', 999, 10);
      insert into public.business_hours(business_id, weekday, opens, closes) select b_sup, d, '00:00', '24:00' from generate_series(0, 6) d;
      new_biz := new_biz || b_sup;
    elsif k = 'funcionario' then
      insert into public.business_members(business_id, user_id, member_role) values (b_lan, u, 'attendant');
    elsif k = 'entregador' then
      insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category, status,
                                  terms_version, terms_accepted_at, reviewed_by, reviewed_at, review_note)
      values (u, 'Entregador 1 — Independente', '(35) 99999-0003', c.id, 'moto', 'TST1A23', 'A', 'approved',
              'teste', now(), auth.uid(), now(), 'Cadastro de teste gerado pelo Painel Master.');
      insert into public.user_roles(user_id, role, granted_by) values (u, 'courier_partner', auth.uid()) on conflict do nothing;
    elsif k = 'entregador2' then
      -- vínculo com o supermercado; sem courier_partner e sem cadastro na rede independente
      insert into public.business_members(business_id, user_id, member_role) values (b_sup, u, 'courier_own');
    end if;
    created := created || jsonb_build_object('key', k, 'role', case when k like 'empresario%' then 'empresario' when k like 'entregador%' then 'entregador'
                                                                     when k like 'cliente%' then 'cliente' else 'funcionario' end,
                                             'label', nome, 'email', k || '-' || sfx || '@teste.example.com');
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
                        jsonb_build_object('city', c.id, 'reused', reuse, 'new_accounts', coalesce(array_length(new_users, 1), 0), 'formato', 'sete_perfis'));
  return jsonb_build_object('run_id', run, 'city', c.name || ' - ' || c.state, 'reused', reuse,
                            'password', case when array_length(new_users, 1) is null then null else pwd end, 'logins', created);
end $$;

-- Lanchonete de teste com Premium de homologação (comandas, caixa, Insights) — sem cobrança; Supermercado no Padrão
create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[]; b uuid;
begin
  res := private.admin_create_test_data_impl(_city);
  select business_ids into ids from private.test_data_runs where id = (res->>'run_id')::uuid;
  perform private.label_test_businesses(ids);
  for b in select id from public.businesses where id = any(ids) and business_type = 'restaurante' and name like '[Teste] Lanchonete%'
             and not exists (select 1 from private.plan_grants g where g.business_id = businesses.id) loop
    perform public.admin_grant_test_plan(b, 'presencial_delivery', 'Homologação: Lanchonete de teste com todos os recursos');
  end loop;
  return res;
end $$;

do $$
declare f text;
begin
  revoke all on function private.is_own_courier(uuid, uuid) from public, anon, authenticated;
  revoke all on function private.admin_create_test_data_impl(uuid) from public, anon, authenticated;
  revoke all on function private.test_login_key(jsonb) from public, anon, authenticated;
  foreach f in array array['public.merchant_assign_own_courier(uuid, uuid)', 'public.merchant_own_couriers(uuid)',
                           'public.own_courier_deliveries(boolean)', 'public.own_courier_set_status(uuid, public.order_status)',
                           'public.admin_create_test_data(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0032', '0032_perfis_simplificados.sql', 'applied');
    raise notice 'Tucaí 0032: aplicada agora';
  end if;
end $tucai_0032$;

-- ===================== supabase/migrations/0033_sete_contas_globais.sql =====================
do $tucai_0033$
begin
  if exists (select 1 from private.tucai_migrations where version = '0033') then
    raise notice 'Tucaí 0033: já aplicada';
  else
    execute $tucai_sql$
-- 0033_sete_contas_globais: exatamente sete contas operacionais de teste em TODA a Tucaí (não sete por cidade).
--  * Um único conjunto ativo: Empresário 1 — Lanchonete, Empresário 2 — Supermercado, Funcionário — Lanchonete,
--    Entregador 1 — Independente, Entregador 2 — Próprio, Cliente 1, Cliente 2. Master continua separado.
--  * Criar em outra cidade ou com lote antigo ativo é recusado: o Master usa "Padronizar as 7 contas".
--  * Padronizar remove contas de teste excedentes (lotes antigos: cozinha, prestador, restaurante, lojista, operador,
--    2º entregador independente…) SOMENTE depois de verificar dependências. Se alguma conta de teste tiver vínculo com
--    dado real (estabelecimento real, pedido em loja real, papel administrativo concedido fora do gerador), nada é
--    removido e o Master recebe a lista. Usuários reais nunca entram: só quem está nos lotes de teste.

create or replace function private.test_keys() returns text[] language sql immutable as $$
  select array['empresario1', 'empresario2', 'funcionario', 'entregador', 'entregador2', 'cliente1', 'cliente2']
$$;

-- lote no padrão = formato novo com as sete chaves, nada além delas
create or replace function private.test_run_is_standard(_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select array_agg(distinct l->>'key' order by l->>'key') from private.test_data_runs r, jsonb_array_elements(r.logins) l where r.id = _run)
                  <@ private.test_keys()
              and (select logins @> '[{"key":"empresario1"}]'::jsonb from private.test_data_runs where id = _run), false)
$$;

-- vínculos de uma conta de teste com dados reais (impedem a remoção automática)
create or replace function private.test_user_real_links(_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.business_members m join public.businesses b on b.id = m.business_id where m.user_id = _user and not b.is_test)
         then 'vinculada a estabelecimento real' end,
    case when exists (select 1 from public.businesses b where b.owner_id = _user and not b.is_test) then 'dona de estabelecimento real' end,
    case when exists (select 1 from public.orders o join public.businesses b on b.id = o.business_id where o.customer_id = _user and not b.is_test)
         then 'tem pedido em estabelecimento real' end,
    case when exists (select 1 from public.user_roles r where r.user_id = _user and r.role = 'platform_master') then 'é Master' end
  ], null)
$$;

create or replace function public.admin_test_accounts_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare std uuid; n_std int;
begin
  perform private.require_master();
  select id into std from private.test_data_runs r where removed_at is null and private.test_run_is_standard(r.id) order by created_at desc limit 1;
  select count(*) into n_std from private.test_data_runs r where removed_at is null and private.test_run_is_standard(r.id);
  return jsonb_build_object(
    'contas', (select count(distinct u) from private.test_data_runs r, unnest(r.user_ids) u where r.removed_at is null),
    'lotes', (select count(*) from private.test_data_runs where removed_at is null),
    'padrao', n_std = 1 and (select count(*) from private.test_data_runs where removed_at is null) = 1
              and (select jsonb_array_length(logins) from private.test_data_runs where id = std) = 7,
    'cidade', (select c.name || ' - ' || c.state from private.test_data_runs r join public.cities c on c.id = r.city_id where r.id = std),
    'faltando', coalesce((select to_jsonb(array_agg(k)) from unnest(private.test_keys()) k
                           where std is null or not exists (select 1 from private.test_data_runs r, jsonb_array_elements(r.logins) l where r.id = std and l->>'key' = k)), '[]'::jsonb),
    'excedentes', coalesce((select jsonb_agg(jsonb_build_object('label', l->>'label', 'email', l->>'email') order by l->>'label')
                             from private.test_data_runs r, jsonb_array_elements(r.logins) l
                            where r.removed_at is null and (r.id is distinct from std or not (l->>'key' = any(private.test_keys())))), '[]'::jsonb),
    'bloqueios', coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'motivos', to_jsonb(private.test_user_real_links(u.id))))
                            from private.test_data_runs r, unnest(r.user_ids) x join auth.users u on u.id = x
                           where r.removed_at is null and cardinality(private.test_user_real_links(u.id)) > 0), '[]'::jsonb));
end $$;

-- gerador: um único conjunto global
create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[]; b uuid; other record;
begin
  perform private.require_master();
  select r.id, c.name || ' - ' || c.state as cidade, private.test_run_is_standard(r.id) as std, r.city_id into other
    from private.test_data_runs r left join public.cities c on c.id = r.city_id
   where r.removed_at is null and not (r.city_id = _city and private.test_run_is_standard(r.id))
   order by r.created_at limit 1;
  if found then
    if other.std then
      raise exception 'As 7 contas de teste já existem em %. Use "Padronizar as 7 contas" para levá-las a outra cidade.', coalesce(other.cidade, 'outra cidade') using errcode = 'P0001';
    end if;
    raise exception 'Há contas de teste fora do padrão (lote antigo em %). Use "Padronizar as 7 contas".', coalesce(other.cidade, 'cidade removida') using errcode = 'P0001';
  end if;
  res := private.admin_create_test_data_impl(_city);
  select business_ids into ids from private.test_data_runs where id = (res->>'run_id')::uuid;
  perform private.label_test_businesses(ids);
  for b in select id from public.businesses where id = any(ids) and business_type = 'restaurante' and name like '[Teste] Lanchonete%'
             and not exists (select 1 from private.plan_grants g where g.business_id = businesses.id) loop
    perform public.admin_grant_test_plan(b, 'presencial_delivery', 'Homologação: Lanchonete de teste com todos os recursos');
  end loop;
  return res;
end $$;

-- padronização: remove excedentes (com verificação de dependências) e garante as sete contas na cidade escolhida
create or replace function public.admin_standardize_test_accounts(_city uuid, _confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare keep uuid; run record; res jsonb; lotes int := 0; contas int := 0; blocked jsonb; created jsonb;
begin
  perform private.require_master();
  if upper(btrim(coalesce(_confirm, ''))) <> 'PADRONIZAR' then raise exception 'Digite PADRONIZAR para confirmar.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.cities where id = _city and is_active) then raise exception 'Cidade não encontrada ou inativa.' using errcode = 'P0001'; end if;
  perform private.limit_for('admin.test_data');
  select id into keep from private.test_data_runs r
   where removed_at is null and city_id = _city and private.test_run_is_standard(r.id) order by created_at desc limit 1;
  -- dependências primeiro: se qualquer conta a remover tiver vínculo real, nada é removido
  select jsonb_agg(jsonb_build_object('email', u.email, 'motivos', to_jsonb(private.test_user_real_links(u.id)))) into blocked
    from private.test_data_runs r, unnest(r.user_ids) x join auth.users u on u.id = x
   where r.removed_at is null and r.id is distinct from keep and cardinality(private.test_user_real_links(u.id)) > 0;
  if blocked is not null then
    raise exception 'Padronização cancelada: contas de teste com vínculo real (%). Nada foi removido.', blocked::text using errcode = 'P0001';
  end if;
  for run in select id from private.test_data_runs where removed_at is null and id is distinct from keep order by created_at loop
    res := private.remove_test_run(run.id);
    if res is not null then lotes := lotes + 1; contas := contas + (res->>'logins')::int; end if;
  end loop;
  -- cria as que faltam (ou o conjunto inteiro) na cidade escolhida
  created := public.admin_create_test_data(_city);
  perform private.audit('test_data.standardize', 'test_data_runs', (created->>'run_id'), jsonb_build_object('lotes_removidos', lotes, 'contas_removidas', contas, 'city', _city));
  return jsonb_build_object('lotes_removidos', lotes, 'contas_removidas', contas, 'criadas', created);
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.test_keys()', 'private.test_run_is_standard(uuid)', 'private.test_user_real_links(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.admin_test_accounts_status()', 'public.admin_create_test_data(uuid)', 'public.admin_standardize_test_accounts(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0033', '0033_sete_contas_globais.sql', 'applied');
    raise notice 'Tucaí 0033: aplicada agora';
  end if;
end $tucai_0033$;

select version, name, how, applied_at from private.tucai_migrations order by version;
