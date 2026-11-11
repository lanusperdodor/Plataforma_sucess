-- =====================================================================================
-- TUCAÍ — TODAS AS MIGRATIONS (0001 a 0008) PARA O SQL EDITOR DO SUPABASE
-- Gerado automaticamente a partir de supabase/migrations. NÃO editar aqui.
-- Uso: copie TODO este conteúdo, cole no SQL Editor (banco vazio) e clique em Run UMA vez.
-- Regenerar: npm run sql:bundle
-- =====================================================================================

-- ===================== supabase/migrations/0001_foundation.sql =====================
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


-- ===================== supabase/migrations/0002_catalog_core.sql =====================
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


-- ===================== supabase/migrations/0003_public_real_data_only.sql =====================
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


-- ===================== supabase/migrations/0004_business_status_rejected.sql =====================
-- 0004: novo estado de estabelecimento "rejected" (solicitação recusada pelo Master).
-- Isolado em migration própria: um valor novo de enum não pode ser usado na mesma transação.
alter type public.business_status add value if not exists 'rejected';


-- ===================== supabase/migrations/0005_platform_admin.sql =====================
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


-- ===================== supabase/migrations/0006_security_privacy.sql =====================
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


-- ===================== supabase/migrations/0007_merchant_panel.sql =====================
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


-- ===================== supabase/migrations/0008_conecta_feed.sql =====================
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
