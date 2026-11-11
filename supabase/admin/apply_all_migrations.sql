-- =====================================================================================
-- TUCAÍ — TODAS AS MIGRATIONS (0001 a 0010) PARA O SQL EDITOR DO SUPABASE
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


-- ===================== supabase/migrations/0009_ibge_municipios_mg_sp.sql =====================
-- 0009_ibge_municipios_mg_sp: base de referência de municípios (IBGE) de MG e SP.
-- GERADO por scripts/ibge-municipios.mjs a partir de supabase/reference/ibge_municipios_mg_sp.csv
-- (sha256 62172c88279872cba4bff7b34f380d446416be132a60dbc1edfaca36f56f1fdd). NÃO editar à mão: regenere com o script.
-- Fonte: https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv
-- Coordenadas = sede municipal. Validações aplicadas: código de 7 dígitos com dígito verificador
-- do IBGE, prefixo da UF, contagem oficial (MG 853, SP 645), nomes únicos por UF e
-- coordenadas dentro dos limites do estado.
-- Tabela de referência no schema private (sem acesso pela API); lida por funções do painel Master.

create table private.ibge_municipalities (
  code integer primary key check (code between 1100000 and 5399999),
  name text not null check (char_length(name) between 2 and 120),
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  unique (uf, name)
);
comment on table private.ibge_municipalities is
  'Referência IBGE (código, nome, UF, coordenadas da sede). Origem: https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv';
revoke all on private.ibge_municipalities from public, anon, authenticated;

insert into private.ibge_municipalities (code, name, uf, lat, lng) values
  (3100104, 'Abadia dos Dourados', 'MG', -18.4831, -47.3916),
  (3100203, 'Abaeté', 'MG', -19.1551, -45.4444),
  (3100302, 'Abre Campo', 'MG', -20.2996, -42.4743),
  (3100401, 'Acaiaca', 'MG', -20.359, -43.1439),
  (3100500, 'Açucena', 'MG', -19.0671, -42.5419),
  (3100609, 'Água Boa', 'MG', -17.9914, -42.3806),
  (3100708, 'Água Comprida', 'MG', -20.0576, -48.1069),
  (3100807, 'Aguanil', 'MG', -20.9439, -45.3915),
  (3100906, 'Águas Formosas', 'MG', -17.0802, -40.9384),
  (3101003, 'Águas Vermelhas', 'MG', -15.7431, -41.4571),
  (3101102, 'Aimorés', 'MG', -19.5007, -41.0746),
  (3101201, 'Aiuruoca', 'MG', -21.9736, -44.6042),
  (3101300, 'Alagoa', 'MG', -22.171, -44.6413),
  (3101409, 'Albertina', 'MG', -22.2018, -46.6139),
  (3101508, 'Além Paraíba', 'MG', -21.8797, -42.7176),
  (3101607, 'Alfenas', 'MG', -21.4256, -45.9477),
  (3101631, 'Alfredo Vasconcelos', 'MG', -21.1535, -43.7718),
  (3101706, 'Almenara', 'MG', -16.1785, -40.6942),
  (3101805, 'Alpercata', 'MG', -18.974, -41.97),
  (3101904, 'Alpinópolis', 'MG', -20.8631, -46.3878),
  (3102001, 'Alterosa', 'MG', -21.2488, -46.1387),
  (3102050, 'Alto Caparaó', 'MG', -20.431, -41.8738),
  (3102100, 'Alto Rio Doce', 'MG', -21.0281, -43.4067),
  (3102209, 'Alvarenga', 'MG', -19.4174, -41.7317),
  (3102308, 'Alvinópolis', 'MG', -20.1098, -43.0535),
  (3102407, 'Alvorada de Minas', 'MG', -18.7334, -43.3638),
  (3102506, 'Amparo do Serra', 'MG', -20.5051, -42.8009),
  (3102605, 'Andradas', 'MG', -22.0695, -46.5724),
  (3102704, 'Cachoeira de Pajeú', 'MG', -15.9688, -41.4948),
  (3102803, 'Andrelândia', 'MG', -21.7411, -44.3117),
  (3102852, 'Angelândia', 'MG', -17.7279, -42.2641),
  (3102902, 'Antônio Carlos', 'MG', -21.321, -43.7451),
  (3103009, 'Antônio Dias', 'MG', -19.6491, -42.8732),
  (3103108, 'Antônio Prado de Minas', 'MG', -21.0192, -42.1109),
  (3103207, 'Araçaí', 'MG', -19.1955, -44.2493),
  (3103306, 'Aracitaba', 'MG', -21.3446, -43.3736),
  (3103405, 'Araçuaí', 'MG', -16.8523, -42.0637),
  (3103504, 'Araguari', 'MG', -18.6456, -48.1934),
  (3103603, 'Arantina', 'MG', -21.9102, -44.2555),
  (3103702, 'Araponga', 'MG', -20.6686, -42.5178),
  (3103751, 'Araporã', 'MG', -18.4357, -49.1847),
  (3103801, 'Arapuá', 'MG', -19.0268, -46.1484),
  (3103900, 'Araújos', 'MG', -19.9405, -45.1671),
  (3104007, 'Araxá', 'MG', -19.5902, -46.9438),
  (3104106, 'Arceburgo', 'MG', -21.359, -46.9401),
  (3104205, 'Arcos', 'MG', -20.2863, -45.5373),
  (3104304, 'Areado', 'MG', -21.3572, -46.1421),
  (3104403, 'Argirita', 'MG', -21.6083, -42.8292),
  (3104452, 'Aricanduva', 'MG', -17.8666, -42.5533),
  (3104502, 'Arinos', 'MG', -15.9187, -46.1043),
  (3104601, 'Astolfo Dutra', 'MG', -21.3184, -42.8572),
  (3104700, 'Ataléia', 'MG', -18.0438, -41.1149),
  (3104809, 'Augusto de Lima', 'MG', -18.0997, -44.2655),
  (3104908, 'Baependi', 'MG', -21.957, -44.8874),
  (3105004, 'Baldim', 'MG', -19.2832, -43.9613),
  (3105103, 'Bambuí', 'MG', -20.0166, -45.9754),
  (3105202, 'Bandeira', 'MG', -15.8783, -40.5622),
  (3105301, 'Bandeira do Sul', 'MG', -21.7308, -46.3833),
  (3105400, 'Barão de Cocais', 'MG', -19.9389, -43.4755),
  (3105509, 'Barão de Monte Alto', 'MG', -21.2444, -42.2372),
  (3105608, 'Barbacena', 'MG', -21.2214, -43.7703),
  (3105707, 'Barra Longa', 'MG', -20.2869, -43.0402),
  (3105905, 'Barroso', 'MG', -21.1907, -43.972),
  (3106002, 'Bela Vista de Minas', 'MG', -19.8302, -43.0922),
  (3106101, 'Belmiro Braga', 'MG', -21.944, -43.4084),
  (3106200, 'Belo Horizonte', 'MG', -19.9102, -43.9266),
  (3106309, 'Belo Oriente', 'MG', -19.2199, -42.4828),
  (3106408, 'Belo Vale', 'MG', -20.4077, -44.0275),
  (3106507, 'Berilo', 'MG', -16.9567, -42.4606),
  (3106606, 'Bertópolis', 'MG', -17.059, -40.58),
  (3106655, 'Berizal', 'MG', -15.61, -41.7432),
  (3106705, 'Betim', 'MG', -19.9668, -44.2008),
  (3106804, 'Bias Fortes', 'MG', -21.602, -43.7574),
  (3106903, 'Bicas', 'MG', -21.7232, -43.056),
  (3107000, 'Biquinhas', 'MG', -18.7754, -45.4974),
  (3107109, 'Boa Esperança', 'MG', -21.0927, -45.5612),
  (3107208, 'Bocaina de Minas', 'MG', -22.1697, -44.3972),
  (3107307, 'Bocaiúva', 'MG', -17.1135, -43.8104),
  (3107406, 'Bom Despacho', 'MG', -19.7386, -45.2622),
  (3107505, 'Bom Jardim de Minas', 'MG', -21.9479, -44.1885),
  (3107604, 'Bom Jesus da Penha', 'MG', -21.0148, -46.5174),
  (3107703, 'Bom Jesus do Amparo', 'MG', -19.7054, -43.4782),
  (3107802, 'Bom Jesus do Galho', 'MG', -19.836, -42.3165),
  (3107901, 'Bom Repouso', 'MG', -22.4675, -46.144),
  (3108008, 'Bom Sucesso', 'MG', -21.0329, -44.7537),
  (3108107, 'Bonfim', 'MG', -20.3302, -44.2366),
  (3108206, 'Bonfinópolis de Minas', 'MG', -16.568, -45.9839),
  (3108255, 'Bonito de Minas', 'MG', -15.3231, -44.7543),
  (3108305, 'Borda da Mata', 'MG', -22.2707, -46.1653),
  (3108404, 'Botelhos', 'MG', -21.6412, -46.391),
  (3108503, 'Botumirim', 'MG', -16.8657, -43.0086),
  (3108552, 'Brasilândia de Minas', 'MG', -16.9999, -46.0081),
  (3108602, 'Brasília de Minas', 'MG', -16.2104, -44.4299),
  (3108701, 'Brás Pires', 'MG', -20.8419, -43.2406),
  (3108800, 'Braúnas', 'MG', -19.0562, -42.7099),
  (3108909, 'Brazópolis', 'MG', -22.4743, -45.6166),
  (3109006, 'Brumadinho', 'MG', -20.151, -44.2007),
  (3109105, 'Bueno Brandão', 'MG', -22.4383, -46.3491),
  (3109204, 'Buenópolis', 'MG', -17.8744, -44.1775),
  (3109253, 'Bugre', 'MG', -19.4231, -42.2552),
  (3109303, 'Buritis', 'MG', -15.6218, -46.4221),
  (3109402, 'Buritizeiro', 'MG', -17.3656, -44.9606),
  (3109451, 'Cabeceira Grande', 'MG', -16.0335, -47.0862),
  (3109501, 'Cabo Verde', 'MG', -21.4699, -46.3919),
  (3109600, 'Cachoeira da Prata', 'MG', -19.521, -44.4544),
  (3109709, 'Cachoeira de Minas', 'MG', -22.3511, -45.7809),
  (3109808, 'Cachoeira Dourada', 'MG', -18.5161, -49.5039),
  (3109907, 'Caetanópolis', 'MG', -19.2971, -44.4189),
  (3110004, 'Caeté', 'MG', -19.8826, -43.6704),
  (3110103, 'Caiana', 'MG', -20.6956, -41.9292),
  (3110202, 'Cajuri', 'MG', -20.7903, -42.7925),
  (3110301, 'Caldas', 'MG', -21.9183, -46.3843),
  (3110400, 'Camacho', 'MG', -20.6294, -45.1593),
  (3110509, 'Camanducaia', 'MG', -22.7515, -46.1494),
  (3110608, 'Cambuí', 'MG', -22.6115, -46.0572),
  (3110707, 'Cambuquira', 'MG', -21.854, -45.2896),
  (3110806, 'Campanário', 'MG', -18.2427, -41.7355),
  (3110905, 'Campanha', 'MG', -21.836, -45.4004),
  (3111002, 'Campestre', 'MG', -21.7079, -46.2381),
  (3111101, 'Campina Verde', 'MG', -19.5382, -49.4862),
  (3111150, 'Campo Azul', 'MG', -16.5028, -44.8096),
  (3111200, 'Campo Belo', 'MG', -20.8932, -45.2699),
  (3111309, 'Campo do Meio', 'MG', -21.1127, -45.8273),
  (3111408, 'Campo Florido', 'MG', -19.7631, -48.5716),
  (3111507, 'Campos Altos', 'MG', -19.6914, -46.1725),
  (3111606, 'Campos Gerais', 'MG', -21.237, -45.7569),
  (3111705, 'Canaã', 'MG', -20.6869, -42.6167),
  (3111804, 'Canápolis', 'MG', -18.7212, -49.2035),
  (3111903, 'Cana Verde', 'MG', -21.0232, -45.1801),
  (3112000, 'Candeias', 'MG', -20.7692, -45.2765),
  (3112059, 'Cantagalo', 'MG', -18.5248, -42.6223),
  (3112109, 'Caparaó', 'MG', -20.5289, -41.9061),
  (3112208, 'Capela Nova', 'MG', -20.9179, -43.622),
  (3112307, 'Capelinha', 'MG', -17.6888, -42.5147),
  (3112406, 'Capetinga', 'MG', -20.6163, -47.0571),
  (3112505, 'Capim Branco', 'MG', -19.5471, -44.1304),
  (3112604, 'Capinópolis', 'MG', -18.6862, -49.5706),
  (3112653, 'Capitão Andrade', 'MG', -19.0748, -41.8614),
  (3112703, 'Capitão Enéas', 'MG', -16.3265, -43.7084),
  (3112802, 'Capitólio', 'MG', -20.6164, -46.0493),
  (3112901, 'Caputira', 'MG', -20.1703, -42.2683),
  (3113008, 'Caraí', 'MG', -17.1862, -41.7004),
  (3113107, 'Caranaíba', 'MG', -20.8707, -43.7417),
  (3113206, 'Carandaí', 'MG', -20.9566, -43.811),
  (3113305, 'Carangola', 'MG', -20.7343, -42.0313),
  (3113404, 'Caratinga', 'MG', -19.7868, -42.1292),
  (3113503, 'Carbonita', 'MG', -17.5255, -43.0137),
  (3113602, 'Careaçu', 'MG', -22.0424, -45.696),
  (3113701, 'Carlos Chagas', 'MG', -17.6973, -40.7723),
  (3113800, 'Carmésia', 'MG', -19.0877, -43.1382),
  (3113909, 'Carmo da Cachoeira', 'MG', -21.4633, -45.2201),
  (3114006, 'Carmo da Mata', 'MG', -20.5575, -44.8735),
  (3114105, 'Carmo de Minas', 'MG', -22.1204, -45.1307),
  (3114204, 'Carmo do Cajuru', 'MG', -20.1912, -44.7664),
  (3114303, 'Carmo do Paranaíba', 'MG', -18.991, -46.3167),
  (3114402, 'Carmo do Rio Claro', 'MG', -20.9736, -46.1149),
  (3114501, 'Carmópolis de Minas', 'MG', -20.5396, -44.6336),
  (3114550, 'Carneirinho', 'MG', -19.6987, -50.6894),
  (3114600, 'Carrancas', 'MG', -21.4898, -44.6446),
  (3114709, 'Carvalhópolis', 'MG', -21.7735, -45.8421),
  (3114808, 'Carvalhos', 'MG', -22.0, -44.4632),
  (3114907, 'Casa Grande', 'MG', -20.7925, -43.9343),
  (3115003, 'Cascalho Rico', 'MG', -18.5772, -47.8716),
  (3115102, 'Cássia', 'MG', -20.5831, -46.9201),
  (3115201, 'Conceição da Barra de Minas', 'MG', -21.1316, -44.4729),
  (3115300, 'Cataguases', 'MG', -21.3924, -42.6896),
  (3115359, 'Catas Altas', 'MG', -20.0734, -43.4061),
  (3115409, 'Catas Altas da Noruega', 'MG', -20.6901, -43.4939),
  (3115458, 'Catuji', 'MG', -17.3018, -41.5276),
  (3115474, 'Catuti', 'MG', -15.3616, -42.9627),
  (3115508, 'Caxambu', 'MG', -21.9753, -44.9319),
  (3115607, 'Cedro do Abaeté', 'MG', -19.1458, -45.712),
  (3115706, 'Central de Minas', 'MG', -18.7612, -41.3143),
  (3115805, 'Centralina', 'MG', -18.5852, -49.2014),
  (3115904, 'Chácara', 'MG', -21.6733, -43.215),
  (3116001, 'Chalé', 'MG', -20.0453, -41.6897),
  (3116100, 'Chapada do Norte', 'MG', -17.0881, -42.5392),
  (3116159, 'Chapada Gaúcha', 'MG', -15.3014, -45.6116),
  (3116209, 'Chiador', 'MG', -21.9996, -43.0617),
  (3116308, 'Cipotânea', 'MG', -20.9026, -43.3629),
  (3116407, 'Claraval', 'MG', -20.397, -47.2768),
  (3116506, 'Claro dos Poções', 'MG', -17.082, -44.2061),
  (3116605, 'Cláudio', 'MG', -20.4437, -44.7673),
  (3116704, 'Coimbra', 'MG', -20.8535, -42.8008),
  (3116803, 'Coluna', 'MG', -18.2311, -42.8352),
  (3116902, 'Comendador Gomes', 'MG', -19.6973, -49.0789),
  (3117009, 'Comercinho', 'MG', -16.2963, -41.7945),
  (3117108, 'Conceição da Aparecida', 'MG', -21.096, -46.2049),
  (3117207, 'Conceição das Pedras', 'MG', -22.1576, -45.4562),
  (3117306, 'Conceição das Alagoas', 'MG', -19.9172, -48.3839),
  (3117405, 'Conceição de Ipanema', 'MG', -19.9326, -41.6908),
  (3117504, 'Conceição do Mato Dentro', 'MG', -19.0344, -43.4221),
  (3117603, 'Conceição do Pará', 'MG', -19.7456, -44.8945),
  (3117702, 'Conceição do Rio Verde', 'MG', -21.8778, -45.087),
  (3117801, 'Conceição dos Ouros', 'MG', -22.4078, -45.7996),
  (3117836, 'Cônego Marinho', 'MG', -15.2892, -44.4181),
  (3117876, 'Confins', 'MG', -19.6282, -43.9931),
  (3117900, 'Congonhal', 'MG', -22.1488, -46.043),
  (3118007, 'Congonhas', 'MG', -20.4958, -43.851),
  (3118106, 'Congonhas do Norte', 'MG', -18.8021, -43.6767),
  (3118205, 'Conquista', 'MG', -19.9312, -47.5492),
  (3118304, 'Conselheiro Lafaiete', 'MG', -20.6634, -43.7846),
  (3118403, 'Conselheiro Pena', 'MG', -19.1789, -41.4736),
  (3118502, 'Consolação', 'MG', -22.5493, -45.9255),
  (3118601, 'Contagem', 'MG', -19.9321, -44.0539),
  (3118700, 'Coqueiral', 'MG', -21.1858, -45.4366),
  (3118809, 'Coração de Jesus', 'MG', -16.6841, -44.3635),
  (3118908, 'Cordisburgo', 'MG', -19.1224, -44.3224),
  (3119005, 'Cordislândia', 'MG', -21.7891, -45.6999),
  (3119104, 'Corinto', 'MG', -18.369, -44.4542),
  (3119203, 'Coroaci', 'MG', -18.6156, -42.2791),
  (3119302, 'Coromandel', 'MG', -18.4734, -47.1933),
  (3119401, 'Coronel Fabriciano', 'MG', -19.5179, -42.6276),
  (3119500, 'Coronel Murta', 'MG', -16.6148, -42.184),
  (3119609, 'Coronel Pacheco', 'MG', -21.5898, -43.256),
  (3119708, 'Coronel Xavier Chaves', 'MG', -21.0277, -44.2206),
  (3119807, 'Córrego Danta', 'MG', -19.8198, -45.9032),
  (3119906, 'Córrego do Bom Jesus', 'MG', -22.6269, -46.0241),
  (3119955, 'Córrego Fundo', 'MG', -20.4474, -45.5617),
  (3120003, 'Córrego Novo', 'MG', -19.8361, -42.3988),
  (3120102, 'Couto de Magalhães de Minas', 'MG', -18.0727, -43.4648),
  (3120151, 'Crisólita', 'MG', -17.2381, -40.9184),
  (3120201, 'Cristais', 'MG', -20.8733, -45.5167),
  (3120300, 'Cristália', 'MG', -16.716, -42.8571),
  (3120409, 'Cristiano Otoni', 'MG', -20.8324, -43.8166),
  (3120508, 'Cristina', 'MG', -22.208, -45.2673),
  (3120607, 'Crucilândia', 'MG', -20.3923, -44.3334),
  (3120706, 'Cruzeiro da Fortaleza', 'MG', -18.944, -46.6669),
  (3120805, 'Cruzília', 'MG', -21.84, -44.8067),
  (3120839, 'Cuparaque', 'MG', -18.9648, -41.0986),
  (3120870, 'Curral de Dentro', 'MG', -15.9327, -41.8557),
  (3120904, 'Curvelo', 'MG', -18.7527, -44.4303),
  (3121001, 'Datas', 'MG', -18.4478, -43.6591),
  (3121100, 'Delfim Moreira', 'MG', -22.5036, -45.2792),
  (3121209, 'Delfinópolis', 'MG', -20.3468, -46.8456),
  (3121258, 'Delta', 'MG', -19.9721, -47.7841),
  (3121308, 'Descoberto', 'MG', -21.46, -42.9618),
  (3121407, 'Desterro de Entre Rios', 'MG', -20.665, -44.3334),
  (3121506, 'Desterro do Melo', 'MG', -21.143, -43.5178),
  (3121605, 'Diamantina', 'MG', -18.2413, -43.6031),
  (3121704, 'Diogo de Vasconcelos', 'MG', -20.4879, -43.1953),
  (3121803, 'Dionísio', 'MG', -19.8433, -42.7701),
  (3121902, 'Divinésia', 'MG', -20.9917, -43.0003),
  (3122009, 'Divino', 'MG', -20.6134, -42.1438),
  (3122108, 'Divino das Laranjeiras', 'MG', -18.7755, -41.4781),
  (3122207, 'Divinolândia de Minas', 'MG', -18.8004, -42.6103),
  (3122306, 'Divinópolis', 'MG', -20.1446, -44.8912),
  (3122355, 'Divisa Alegre', 'MG', -15.7221, -41.3463),
  (3122405, 'Divisa Nova', 'MG', -21.5092, -46.1904),
  (3122454, 'Divisópolis', 'MG', -15.7254, -40.9997),
  (3122470, 'Dom Bosco', 'MG', -16.652, -46.2597),
  (3122504, 'Dom Cavati', 'MG', -19.3735, -42.1121),
  (3122603, 'Dom Joaquim', 'MG', -18.961, -43.2544),
  (3122702, 'Dom Silvério', 'MG', -20.1627, -42.9627),
  (3122801, 'Dom Viçoso', 'MG', -22.2511, -45.1643),
  (3122900, 'Dona Eusébia', 'MG', -21.319, -42.807),
  (3123007, 'Dores de Campos', 'MG', -21.1139, -44.0207),
  (3123106, 'Dores de Guanhães', 'MG', -19.0516, -42.9254),
  (3123205, 'Dores do Indaiá', 'MG', -19.4628, -45.5927),
  (3123304, 'Dores do Turvo', 'MG', -20.9785, -43.1834),
  (3123403, 'Doresópolis', 'MG', -20.2868, -45.9007),
  (3123502, 'Douradoquara', 'MG', -18.4338, -47.5993),
  (3123528, 'Durandé', 'MG', -20.2058, -41.7977),
  (3123601, 'Elói Mendes', 'MG', -21.6088, -45.5691),
  (3123700, 'Engenheiro Caldas', 'MG', -19.2065, -42.0503),
  (3123809, 'Engenheiro Navarro', 'MG', -17.2831, -43.947),
  (3123858, 'Entre Folhas', 'MG', -19.6218, -42.2306),
  (3123908, 'Entre Rios de Minas', 'MG', -20.6706, -44.0654),
  (3124005, 'Ervália', 'MG', -20.8403, -42.6544),
  (3124104, 'Esmeraldas', 'MG', -19.764, -44.3065),
  (3124203, 'Espera Feliz', 'MG', -20.6508, -41.9119),
  (3124302, 'Espinosa', 'MG', -14.9249, -42.809),
  (3124401, 'Espírito Santo do Dourado', 'MG', -22.0454, -45.9548),
  (3124500, 'Estiva', 'MG', -22.4577, -46.0191),
  (3124609, 'Estrela Dalva', 'MG', -21.7412, -42.4574),
  (3124708, 'Estrela do Indaiá', 'MG', -19.5169, -45.7859),
  (3124807, 'Estrela do Sul', 'MG', -18.7399, -47.6956),
  (3124906, 'Eugenópolis', 'MG', -21.1002, -42.1878),
  (3125002, 'Ewbank da Câmara', 'MG', -21.5498, -43.5068),
  (3125101, 'Extrema', 'MG', -22.854, -46.3178),
  (3125200, 'Fama', 'MG', -21.4089, -45.8286),
  (3125309, 'Faria Lemos', 'MG', -20.8097, -42.0213),
  (3125408, 'Felício dos Santos', 'MG', -18.0755, -43.2422),
  (3125507, 'São Gonçalo do Rio Preto', 'MG', -18.0025, -43.3854),
  (3125606, 'Felisburgo', 'MG', -16.6348, -40.7605),
  (3125705, 'Felixlândia', 'MG', -18.7507, -44.9004),
  (3125804, 'Fernandes Tourinho', 'MG', -19.1541, -42.0803),
  (3125903, 'Ferros', 'MG', -19.2343, -43.0192),
  (3125952, 'Fervedouro', 'MG', -20.726, -42.279),
  (3126000, 'Florestal', 'MG', -19.888, -44.4318),
  (3126109, 'Formiga', 'MG', -20.4618, -45.4268),
  (3126208, 'Formoso', 'MG', -14.9446, -46.2371),
  (3126307, 'Fortaleza de Minas', 'MG', -20.8508, -46.712),
  (3126406, 'Fortuna de Minas', 'MG', -19.5578, -44.4472),
  (3126505, 'Francisco Badaró', 'MG', -16.9883, -42.3568),
  (3126604, 'Francisco Dumont', 'MG', -17.3107, -44.2317),
  (3126703, 'Francisco Sá', 'MG', -16.4827, -43.4896),
  (3126752, 'Franciscópolis', 'MG', -17.9578, -42.0094),
  (3126802, 'Frei Gaspar', 'MG', -18.0709, -41.4325),
  (3126901, 'Frei Inocêncio', 'MG', -18.5556, -41.9121),
  (3126950, 'Frei Lagonegro', 'MG', -18.1751, -42.7617),
  (3127008, 'Fronteira', 'MG', -20.2748, -49.1984),
  (3127057, 'Fronteira dos Vales', 'MG', -16.8898, -40.923),
  (3127073, 'Fruta de Leite', 'MG', -16.1225, -42.5288),
  (3127107, 'Frutal', 'MG', -20.0259, -48.9355),
  (3127206, 'Funilândia', 'MG', -19.3661, -44.061),
  (3127305, 'Galiléia', 'MG', -19.0005, -41.5387),
  (3127339, 'Gameleiras', 'MG', -15.0829, -43.125),
  (3127354, 'Glaucilândia', 'MG', -16.8481, -43.692),
  (3127370, 'Goiabeira', 'MG', -18.9807, -41.2235),
  (3127388, 'Goianá', 'MG', -21.536, -43.1957),
  (3127404, 'Gonçalves', 'MG', -22.6545, -45.8556),
  (3127503, 'Gonzaga', 'MG', -18.8196, -42.4769),
  (3127602, 'Gouveia', 'MG', -18.4519, -43.7423),
  (3127701, 'Governador Valadares', 'MG', -18.8545, -41.9555),
  (3127800, 'Grão Mogol', 'MG', -16.5662, -42.8923),
  (3127909, 'Grupiara', 'MG', -18.5003, -47.7318),
  (3128006, 'Guanhães', 'MG', -18.7713, -42.9312),
  (3128105, 'Guapé', 'MG', -20.7631, -45.9152),
  (3128204, 'Guaraciaba', 'MG', -20.5716, -43.0094),
  (3128253, 'Guaraciama', 'MG', -17.0142, -43.6675),
  (3128303, 'Guaranésia', 'MG', -21.3009, -46.7964),
  (3128402, 'Guarani', 'MG', -21.3563, -43.0328),
  (3128501, 'Guarará', 'MG', -21.7304, -43.0334),
  (3128600, 'Guarda-Mor', 'MG', -17.7673, -47.0998),
  (3128709, 'Guaxupé', 'MG', -21.305, -46.7081),
  (3128808, 'Guidoval', 'MG', -21.155, -42.7887),
  (3128907, 'Guimarânia', 'MG', -18.8425, -46.7901),
  (3129004, 'Guiricema', 'MG', -21.0098, -42.7207),
  (3129103, 'Gurinhatã', 'MG', -19.2143, -49.7876),
  (3129202, 'Heliodora', 'MG', -22.0644, -45.5453),
  (3129301, 'Iapu', 'MG', -19.4387, -42.2147),
  (3129400, 'Ibertioga', 'MG', -21.433, -43.9639),
  (3129509, 'Ibiá', 'MG', -19.4749, -46.5474),
  (3129608, 'Ibiaí', 'MG', -16.8591, -44.9046),
  (3129657, 'Ibiracatu', 'MG', -15.6605, -44.1667),
  (3129707, 'Ibiraci', 'MG', -20.4611, -47.1222),
  (3129806, 'Ibirité', 'MG', -20.0252, -44.0569),
  (3129905, 'Ibitiúra de Minas', 'MG', -22.0604, -46.4368),
  (3130002, 'Ibituruna', 'MG', -21.1541, -44.7479),
  (3130051, 'Icaraí de Minas', 'MG', -16.214, -44.9034),
  (3130101, 'Igarapé', 'MG', -20.0707, -44.2994),
  (3130200, 'Igaratinga', 'MG', -19.9476, -44.7063),
  (3130309, 'Iguatama', 'MG', -20.1776, -45.7111),
  (3130408, 'Ijaci', 'MG', -21.1738, -44.9233),
  (3130507, 'Ilicínea', 'MG', -20.9402, -45.8308),
  (3130556, 'Imbé de Minas', 'MG', -19.6017, -41.9695),
  (3130606, 'Inconfidentes', 'MG', -22.3136, -46.3264),
  (3130655, 'Indaiabira', 'MG', -15.4911, -42.2005),
  (3130705, 'Indianópolis', 'MG', -19.0341, -47.9155),
  (3130804, 'Ingaí', 'MG', -21.4024, -44.9152),
  (3130903, 'Inhapim', 'MG', -19.5476, -42.1147),
  (3131000, 'Inhaúma', 'MG', -19.4898, -44.3934),
  (3131109, 'Inimutaba', 'MG', -18.7271, -44.3584),
  (3131158, 'Ipaba', 'MG', -19.4158, -42.4139),
  (3131208, 'Ipanema', 'MG', -19.7992, -41.7164),
  (3131307, 'Ipatinga', 'MG', -19.4703, -42.5476),
  (3131406, 'Ipiaçu', 'MG', -18.6927, -49.9436),
  (3131505, 'Ipuiúna', 'MG', -22.1013, -46.1915),
  (3131604, 'Iraí de Minas', 'MG', -18.9819, -47.461),
  (3131703, 'Itabira', 'MG', -19.6239, -43.2312),
  (3131802, 'Itabirinha', 'MG', -18.5712, -41.234),
  (3131901, 'Itabirito', 'MG', -20.2501, -43.8038),
  (3132008, 'Itacambira', 'MG', -17.0625, -43.3069),
  (3132107, 'Itacarambi', 'MG', -15.089, -44.095),
  (3132206, 'Itaguara', 'MG', -20.3947, -44.4875),
  (3132305, 'Itaipé', 'MG', -17.4014, -41.6697),
  (3132404, 'Itajubá', 'MG', -22.4225, -45.4598),
  (3132503, 'Itamarandiba', 'MG', -17.8552, -42.8561),
  (3132602, 'Itamarati de Minas', 'MG', -21.4179, -42.813),
  (3132701, 'Itambacuri', 'MG', -18.035, -41.683),
  (3132800, 'Itambé do Mato Dentro', 'MG', -19.4158, -43.3182),
  (3132909, 'Itamogi', 'MG', -21.0758, -47.046),
  (3133006, 'Itamonte', 'MG', -22.2859, -44.868),
  (3133105, 'Itanhandu', 'MG', -22.2942, -44.9382),
  (3133204, 'Itanhomi', 'MG', -19.1736, -41.863),
  (3133303, 'Itaobim', 'MG', -16.5571, -41.5017),
  (3133402, 'Itapagipe', 'MG', -19.9062, -49.3781),
  (3133501, 'Itapecerica', 'MG', -20.4704, -45.127),
  (3133600, 'Itapeva', 'MG', -22.7665, -46.2241),
  (3133709, 'Itatiaiuçu', 'MG', -20.1983, -44.4211),
  (3133758, 'Itaú de Minas', 'MG', -20.7375, -46.7525),
  (3133808, 'Itaúna', 'MG', -20.0818, -44.5801),
  (3133907, 'Itaverava', 'MG', -20.6769, -43.6141),
  (3134004, 'Itinga', 'MG', -16.61, -41.7672),
  (3134103, 'Itueta', 'MG', -19.3999, -41.1746),
  (3134202, 'Ituiutaba', 'MG', -18.9772, -49.4639),
  (3134301, 'Itumirim', 'MG', -21.3171, -44.8724),
  (3134400, 'Iturama', 'MG', -19.7276, -50.1966),
  (3134509, 'Itutinga', 'MG', -21.3, -44.6567),
  (3134608, 'Jaboticatubas', 'MG', -19.5119, -43.7373),
  (3134707, 'Jacinto', 'MG', -16.1428, -40.295),
  (3134806, 'Jacuí', 'MG', -21.0137, -46.7359),
  (3134905, 'Jacutinga', 'MG', -22.286, -46.6166),
  (3135001, 'Jaguaraçu', 'MG', -19.647, -42.7498),
  (3135050, 'Jaíba', 'MG', -15.3432, -43.6688),
  (3135076, 'Jampruca', 'MG', -18.461, -41.809),
  (3135100, 'Janaúba', 'MG', -15.8022, -43.3132),
  (3135209, 'Januária', 'MG', -15.4802, -44.3639),
  (3135308, 'Japaraíba', 'MG', -20.1442, -45.5015),
  (3135357, 'Japonvar', 'MG', -15.9891, -44.2758),
  (3135407, 'Jeceaba', 'MG', -20.5339, -43.9894),
  (3135456, 'Jenipapo de Minas', 'MG', -17.0831, -42.2589),
  (3135506, 'Jequeri', 'MG', -20.4542, -42.6651),
  (3135605, 'Jequitaí', 'MG', -17.229, -44.4376),
  (3135704, 'Jequitibá', 'MG', -19.2345, -44.0304),
  (3135803, 'Jequitinhonha', 'MG', -16.4375, -41.0117),
  (3135902, 'Jesuânia', 'MG', -21.9887, -45.2911),
  (3136009, 'Joaíma', 'MG', -16.6522, -41.0229),
  (3136108, 'Joanésia', 'MG', -19.1729, -42.6775),
  (3136207, 'João Monlevade', 'MG', -19.8126, -43.1735),
  (3136306, 'João Pinheiro', 'MG', -17.7398, -46.1715),
  (3136405, 'Joaquim Felício', 'MG', -17.758, -44.1643),
  (3136504, 'Jordânia', 'MG', -15.9009, -40.1841),
  (3136520, 'José Gonçalves de Minas', 'MG', -16.9053, -42.6014),
  (3136553, 'José Raydan', 'MG', -18.2195, -42.4946),
  (3136579, 'Josenópolis', 'MG', -16.5417, -42.5151),
  (3136603, 'Nova União', 'MG', -19.6876, -43.583),
  (3136652, 'Juatuba', 'MG', -19.9448, -44.3451),
  (3136702, 'Juiz de Fora', 'MG', -21.7595, -43.3398),
  (3136801, 'Juramento', 'MG', -16.8473, -43.5865),
  (3136900, 'Juruaia', 'MG', -21.2493, -46.5735),
  (3136959, 'Juvenília', 'MG', -14.2662, -44.1597),
  (3137007, 'Ladainha', 'MG', -17.6279, -41.7488),
  (3137106, 'Lagamar', 'MG', -18.1759, -46.8063),
  (3137205, 'Lagoa da Prata', 'MG', -20.0237, -45.5401),
  (3137304, 'Lagoa dos Patos', 'MG', -16.978, -44.5754),
  (3137403, 'Lagoa Dourada', 'MG', -20.9139, -44.0797),
  (3137502, 'Lagoa Formosa', 'MG', -18.7715, -46.4012),
  (3137536, 'Lagoa Grande', 'MG', -17.8323, -46.5165),
  (3137601, 'Lagoa Santa', 'MG', -19.6397, -43.8932),
  (3137700, 'Lajinha', 'MG', -20.1539, -41.6228),
  (3137809, 'Lambari', 'MG', -21.9671, -45.3498),
  (3137908, 'Lamim', 'MG', -20.79, -43.4706),
  (3138005, 'Laranjal', 'MG', -21.3715, -42.4732),
  (3138104, 'Lassance', 'MG', -17.887, -44.5735),
  (3138203, 'Lavras', 'MG', -21.248, -45.0009),
  (3138302, 'Leandro Ferreira', 'MG', -19.7193, -45.0279),
  (3138351, 'Leme do Prado', 'MG', -17.0793, -42.6936),
  (3138401, 'Leopoldina', 'MG', -21.5296, -42.6421),
  (3138500, 'Liberdade', 'MG', -22.0275, -44.3208),
  (3138609, 'Lima Duarte', 'MG', -21.8386, -43.7934),
  (3138625, 'Limeira do Oeste', 'MG', -19.5512, -50.5815),
  (3138658, 'Lontra', 'MG', -15.9013, -44.306),
  (3138674, 'Luisburgo', 'MG', -20.4468, -42.0976),
  (3138682, 'Luislândia', 'MG', -16.1095, -44.5886),
  (3138708, 'Luminárias', 'MG', -21.5145, -44.9034),
  (3138807, 'Luz', 'MG', -19.7911, -45.6794),
  (3138906, 'Machacalis', 'MG', -17.0723, -40.7245),
  (3139003, 'Machado', 'MG', -21.6778, -45.9219),
  (3139102, 'Madre de Deus de Minas', 'MG', -21.483, -44.3287),
  (3139201, 'Malacacheta', 'MG', -17.8456, -42.0769),
  (3139250, 'Mamonas', 'MG', -15.0479, -42.9469),
  (3139300, 'Manga', 'MG', -14.7529, -43.9391),
  (3139409, 'Manhuaçu', 'MG', -20.2572, -42.028),
  (3139508, 'Manhumirim', 'MG', -20.3591, -41.9589),
  (3139607, 'Mantena', 'MG', -18.7761, -40.9874),
  (3139706, 'Maravilhas', 'MG', -19.5076, -44.6779),
  (3139805, 'Mar de Espanha', 'MG', -21.8707, -43.0062),
  (3139904, 'Maria da Fé', 'MG', -22.3044, -45.3773),
  (3140001, 'Mariana', 'MG', -20.3765, -43.414),
  (3140100, 'Marilac', 'MG', -18.5079, -42.0822),
  (3140159, 'Mário Campos', 'MG', -20.0582, -44.1883),
  (3140209, 'Maripá de Minas', 'MG', -21.6979, -42.9546),
  (3140308, 'Marliéria', 'MG', -19.7096, -42.7327),
  (3140407, 'Marmelópolis', 'MG', -22.447, -45.1645),
  (3140506, 'Martinho Campos', 'MG', -19.3306, -45.2434),
  (3140530, 'Martins Soares', 'MG', -20.2546, -41.8786),
  (3140555, 'Mata Verde', 'MG', -15.6869, -40.7366),
  (3140605, 'Materlândia', 'MG', -18.4699, -43.0579),
  (3140704, 'Mateus Leme', 'MG', -19.9794, -44.4318),
  (3140803, 'Matias Barbosa', 'MG', -21.869, -43.3135),
  (3140852, 'Matias Cardoso', 'MG', -14.8563, -43.9146),
  (3140902, 'Matipó', 'MG', -20.2873, -42.3401),
  (3141009, 'Mato Verde', 'MG', -15.3944, -42.86),
  (3141108, 'Matozinhos', 'MG', -19.5543, -44.0868),
  (3141207, 'Matutina', 'MG', -19.2179, -45.9664),
  (3141306, 'Medeiros', 'MG', -19.9865, -46.2181),
  (3141405, 'Medina', 'MG', -16.2245, -41.4728),
  (3141504, 'Mendes Pimentel', 'MG', -18.6631, -41.4052),
  (3141603, 'Mercês', 'MG', -21.1976, -43.3337),
  (3141702, 'Mesquita', 'MG', -19.224, -42.6079),
  (3141801, 'Minas Novas', 'MG', -17.2156, -42.5884),
  (3141900, 'Minduri', 'MG', -21.6797, -44.6051),
  (3142007, 'Mirabela', 'MG', -16.256, -44.1602),
  (3142106, 'Miradouro', 'MG', -20.8899, -42.3458),
  (3142205, 'Miraí', 'MG', -21.2021, -42.6122),
  (3142254, 'Miravânia', 'MG', -14.7348, -44.4092),
  (3142304, 'Moeda', 'MG', -20.3399, -44.0509),
  (3142403, 'Moema', 'MG', -19.8387, -45.4127),
  (3142502, 'Monjolos', 'MG', -18.3245, -44.118),
  (3142601, 'Monsenhor Paulo', 'MG', -21.7579, -45.5391),
  (3142700, 'Montalvânia', 'MG', -14.4197, -44.3719),
  (3142809, 'Monte Alegre de Minas', 'MG', -18.869, -48.881),
  (3142908, 'Monte Azul', 'MG', -15.1514, -42.8718),
  (3143005, 'Monte Belo', 'MG', -21.3271, -46.3635),
  (3143104, 'Monte Carmelo', 'MG', -18.7302, -47.4912),
  (3143153, 'Monte Formoso', 'MG', -16.8691, -41.2473),
  (3143203, 'Monte Santo de Minas', 'MG', -21.1873, -46.9753),
  (3143302, 'Montes Claros', 'MG', -16.7282, -43.8578),
  (3143401, 'Monte Sião', 'MG', -22.4335, -46.573),
  (3143450, 'Montezuma', 'MG', -15.1702, -42.4941),
  (3143500, 'Morada Nova de Minas', 'MG', -18.5998, -45.3584),
  (3143609, 'Morro da Garça', 'MG', -18.5356, -44.601),
  (3143708, 'Morro do Pilar', 'MG', -19.2236, -43.3795),
  (3143807, 'Munhoz', 'MG', -22.6092, -46.362),
  (3143906, 'Muriaé', 'MG', -21.13, -42.3693),
  (3144003, 'Mutum', 'MG', -19.8121, -41.4407),
  (3144102, 'Muzambinho', 'MG', -21.3692, -46.5213),
  (3144201, 'Nacip Raydan', 'MG', -18.4544, -42.2481),
  (3144300, 'Nanuque', 'MG', -17.8481, -40.3533),
  (3144359, 'Naque', 'MG', -19.2291, -42.3312),
  (3144375, 'Natalândia', 'MG', -16.5021, -46.4874),
  (3144409, 'Natércia', 'MG', -22.1158, -45.5123),
  (3144508, 'Nazareno', 'MG', -21.2168, -44.6138),
  (3144607, 'Nepomuceno', 'MG', -21.2324, -45.235),
  (3144656, 'Ninheira', 'MG', -15.3148, -41.7564),
  (3144672, 'Nova Belém', 'MG', -18.4925, -41.1107),
  (3144706, 'Nova Era', 'MG', -19.7577, -43.0333),
  (3144805, 'Nova Lima', 'MG', -19.9758, -43.8509),
  (3144904, 'Nova Módica', 'MG', -18.4417, -41.4984),
  (3145000, 'Nova Ponte', 'MG', -19.1461, -47.6779),
  (3145059, 'Nova Porteirinha', 'MG', -15.7993, -43.2941),
  (3145109, 'Nova Resende', 'MG', -21.1286, -46.4157),
  (3145208, 'Nova Serrana', 'MG', -19.8713, -44.9847),
  (3145307, 'Novo Cruzeiro', 'MG', -17.4654, -41.8826),
  (3145356, 'Novo Oriente de Minas', 'MG', -17.4089, -41.2194),
  (3145372, 'Novorizonte', 'MG', -16.0162, -42.4044),
  (3145406, 'Olaria', 'MG', -21.8598, -43.9356),
  (3145455, 'Olhos d''Água', 'MG', -17.3982, -43.5719),
  (3145505, 'Olímpio Noronha', 'MG', -22.0685, -45.2657),
  (3145604, 'Oliveira', 'MG', -20.6982, -44.829),
  (3145703, 'Oliveira Fortes', 'MG', -21.3401, -43.4499),
  (3145802, 'Onça de Pitangui', 'MG', -19.7276, -44.8058),
  (3145851, 'Oratórios', 'MG', -20.4298, -42.7977),
  (3145877, 'Orizânia', 'MG', -20.5142, -42.1991),
  (3145901, 'Ouro Branco', 'MG', -20.5263, -43.6962),
  (3146008, 'Ouro Fino', 'MG', -22.2779, -46.3716),
  (3146107, 'Ouro Preto', 'MG', -20.3796, -43.512),
  (3146206, 'Ouro Verde de Minas', 'MG', -18.0719, -41.2734),
  (3146255, 'Padre Carvalho', 'MG', -16.3646, -42.5088),
  (3146305, 'Padre Paraíso', 'MG', -17.0758, -41.4821),
  (3146404, 'Paineiras', 'MG', -18.8993, -45.5321),
  (3146503, 'Pains', 'MG', -20.3705, -45.6627),
  (3146552, 'Pai Pedro', 'MG', -15.5271, -43.07),
  (3146602, 'Paiva', 'MG', -21.2913, -43.4088),
  (3146701, 'Palma', 'MG', -21.3748, -42.3123),
  (3146750, 'Palmópolis', 'MG', -16.7364, -40.4296),
  (3146909, 'Papagaios', 'MG', -19.4419, -44.7468),
  (3147006, 'Paracatu', 'MG', -17.2252, -46.8711),
  (3147105, 'Pará de Minas', 'MG', -19.8534, -44.6114),
  (3147204, 'Paraguaçu', 'MG', -21.5465, -45.7374),
  (3147303, 'Paraisópolis', 'MG', -22.5539, -45.7803),
  (3147402, 'Paraopeba', 'MG', -19.2732, -44.4044),
  (3147501, 'Passabém', 'MG', -19.3509, -43.1383),
  (3147600, 'Passa Quatro', 'MG', -22.3871, -44.9709),
  (3147709, 'Passa Tempo', 'MG', -20.6539, -44.4926),
  (3147808, 'Passa-Vinte', 'MG', -22.2097, -44.2344),
  (3147907, 'Passos', 'MG', -20.7193, -46.609),
  (3147956, 'Patis', 'MG', -16.0773, -44.0787),
  (3148004, 'Patos de Minas', 'MG', -18.5699, -46.5013),
  (3148103, 'Patrocínio', 'MG', -18.9379, -46.9934),
  (3148202, 'Patrocínio do Muriaé', 'MG', -21.1544, -42.2125),
  (3148301, 'Paula Cândido', 'MG', -20.8754, -42.9752),
  (3148400, 'Paulistas', 'MG', -18.4276, -42.8628),
  (3148509, 'Pavão', 'MG', -17.4267, -41.0035),
  (3148608, 'Peçanha', 'MG', -18.5441, -42.5583),
  (3148707, 'Pedra Azul', 'MG', -16.0086, -41.2909),
  (3148756, 'Pedra Bonita', 'MG', -20.5219, -42.3304),
  (3148806, 'Pedra do Anta', 'MG', -20.5968, -42.7123),
  (3148905, 'Pedra do Indaiá', 'MG', -20.2563, -45.2107),
  (3149002, 'Pedra Dourada', 'MG', -20.8266, -42.1515),
  (3149101, 'Pedralva', 'MG', -22.2386, -45.4654),
  (3149150, 'Pedras de Maria da Cruz', 'MG', -15.6032, -44.391),
  (3149200, 'Pedrinópolis', 'MG', -19.2241, -47.4579),
  (3149309, 'Pedro Leopoldo', 'MG', -19.6308, -44.0383),
  (3149408, 'Pedro Teixeira', 'MG', -21.7076, -43.743),
  (3149507, 'Pequeri', 'MG', -21.8341, -43.1145),
  (3149606, 'Pequi', 'MG', -19.6284, -44.6604),
  (3149705, 'Perdigão', 'MG', -19.9411, -45.078),
  (3149804, 'Perdizes', 'MG', -19.3434, -47.2963),
  (3149903, 'Perdões', 'MG', -21.0932, -45.0896),
  (3149952, 'Periquito', 'MG', -19.1573, -42.2333),
  (3150000, 'Pescador', 'MG', -18.357, -41.6006),
  (3150109, 'Piau', 'MG', -21.5096, -43.313),
  (3150158, 'Piedade de Caratinga', 'MG', -19.7593, -42.0756),
  (3150208, 'Piedade de Ponte Nova', 'MG', -20.2438, -42.7379),
  (3150307, 'Piedade do Rio Grande', 'MG', -21.469, -44.1938),
  (3150406, 'Piedade dos Gerais', 'MG', -20.4715, -44.2243),
  (3150505, 'Pimenta', 'MG', -20.4827, -45.8049),
  (3150539, 'Pingo-d''Água', 'MG', -19.7287, -42.4095),
  (3150570, 'Pintópolis', 'MG', -16.0572, -45.1402),
  (3150604, 'Piracema', 'MG', -20.5089, -44.4783),
  (3150703, 'Pirajuba', 'MG', -19.9092, -48.7027),
  (3150802, 'Piranga', 'MG', -20.6834, -43.2967),
  (3150901, 'Piranguçu', 'MG', -22.5249, -45.4945),
  (3151008, 'Piranguinho', 'MG', -22.395, -45.5324),
  (3151107, 'Pirapetinga', 'MG', -21.6554, -42.3434),
  (3151206, 'Pirapora', 'MG', -17.3392, -44.934),
  (3151305, 'Piraúba', 'MG', -21.2825, -43.0172),
  (3151404, 'Pitangui', 'MG', -19.6741, -44.8964),
  (3151503, 'Piumhi', 'MG', -20.4762, -45.9589),
  (3151602, 'Planura', 'MG', -20.1376, -48.7),
  (3151701, 'Poço Fundo', 'MG', -21.78, -45.9658),
  (3151800, 'Poços de Caldas', 'MG', -21.78, -46.5692),
  (3151909, 'Pocrane', 'MG', -19.6208, -41.6334),
  (3152006, 'Pompéu', 'MG', -19.2257, -45.0141),
  (3152105, 'Ponte Nova', 'MG', -20.4111, -42.8978),
  (3152131, 'Ponto Chique', 'MG', -16.6282, -45.0588),
  (3152170, 'Ponto dos Volantes', 'MG', -16.7473, -41.5025),
  (3152204, 'Porteirinha', 'MG', -15.7404, -43.0281),
  (3152303, 'Porto Firme', 'MG', -20.6642, -43.0834),
  (3152402, 'Poté', 'MG', -17.8077, -41.786),
  (3152501, 'Pouso Alegre', 'MG', -22.2266, -45.9389),
  (3152600, 'Pouso Alto', 'MG', -22.1964, -44.9748),
  (3152709, 'Prados', 'MG', -21.0597, -44.0778),
  (3152808, 'Prata', 'MG', -19.3086, -48.9276),
  (3152907, 'Pratápolis', 'MG', -20.7411, -46.8624),
  (3153004, 'Pratinha', 'MG', -19.739, -46.3755),
  (3153103, 'Presidente Bernardes', 'MG', -20.7656, -43.1895),
  (3153202, 'Presidente Juscelino', 'MG', -18.6401, -44.06),
  (3153301, 'Presidente Kubitschek', 'MG', -18.6193, -43.5628),
  (3153400, 'Presidente Olegário', 'MG', -18.4096, -46.4165),
  (3153509, 'Alto Jequitibá', 'MG', -20.4208, -41.967),
  (3153608, 'Prudente de Morais', 'MG', -19.4742, -44.1591),
  (3153707, 'Quartel Geral', 'MG', -19.2703, -45.5569),
  (3153806, 'Queluzito', 'MG', -20.7416, -43.8851),
  (3153905, 'Raposos', 'MG', -19.9636, -43.8079),
  (3154002, 'Raul Soares', 'MG', -20.1061, -42.4502),
  (3154101, 'Recreio', 'MG', -21.5289, -42.4676),
  (3154150, 'Reduto', 'MG', -20.2401, -41.9848),
  (3154200, 'Resende Costa', 'MG', -20.9171, -44.2407),
  (3154309, 'Resplendor', 'MG', -19.3194, -41.2462),
  (3154408, 'Ressaquinha', 'MG', -21.0642, -43.7598),
  (3154457, 'Riachinho', 'MG', -16.2258, -45.9888),
  (3154507, 'Riacho dos Machados', 'MG', -16.0091, -43.0488),
  (3154606, 'Ribeirão das Neves', 'MG', -19.7621, -44.0844),
  (3154705, 'Ribeirão Vermelho', 'MG', -21.1879, -45.0637),
  (3154804, 'Rio Acima', 'MG', -20.0876, -43.7878),
  (3154903, 'Rio Casca', 'MG', -20.2285, -42.6462),
  (3155009, 'Rio Doce', 'MG', -20.2412, -42.8995),
  (3155108, 'Rio do Prado', 'MG', -16.6056, -40.5714),
  (3155207, 'Rio Espera', 'MG', -20.855, -43.4721),
  (3155306, 'Rio Manso', 'MG', -20.2666, -44.3069),
  (3155405, 'Rio Novo', 'MG', -21.4649, -43.1168),
  (3155504, 'Rio Paranaíba', 'MG', -19.1861, -46.2455),
  (3155603, 'Rio Pardo de Minas', 'MG', -15.616, -42.5405),
  (3155702, 'Rio Piracicaba', 'MG', -19.9284, -43.1829),
  (3155801, 'Rio Pomba', 'MG', -21.2712, -43.1696),
  (3155900, 'Rio Preto', 'MG', -22.0861, -43.8293),
  (3156007, 'Rio Vermelho', 'MG', -18.2922, -43.0018),
  (3156106, 'Ritápolis', 'MG', -21.0276, -44.3204),
  (3156205, 'Rochedo de Minas', 'MG', -21.6284, -43.0165),
  (3156304, 'Rodeiro', 'MG', -21.2035, -42.8586),
  (3156403, 'Romaria', 'MG', -18.8838, -47.5782),
  (3156452, 'Rosário da Limeira', 'MG', -20.9812, -42.5112),
  (3156502, 'Rubelita', 'MG', -16.4053, -42.261),
  (3156601, 'Rubim', 'MG', -16.3775, -40.5397),
  (3156700, 'Sabará', 'MG', -19.884, -43.8263),
  (3156809, 'Sabinópolis', 'MG', -18.6653, -43.0752),
  (3156908, 'Sacramento', 'MG', -19.8622, -47.4508),
  (3157005, 'Salinas', 'MG', -16.1753, -42.2964),
  (3157104, 'Salto da Divisa', 'MG', -16.0063, -39.9391),
  (3157203, 'Santa Bárbara', 'MG', -19.9604, -43.4101),
  (3157252, 'Santa Bárbara do Leste', 'MG', -19.9753, -42.1457),
  (3157278, 'Santa Bárbara do Monte Verde', 'MG', -21.9592, -43.7027),
  (3157302, 'Santa Bárbara do Tugúrio', 'MG', -21.2431, -43.5607),
  (3157336, 'Santa Cruz de Minas', 'MG', -21.1241, -44.2202),
  (3157377, 'Santa Cruz de Salinas', 'MG', -16.0967, -41.7418),
  (3157401, 'Santa Cruz do Escalvado', 'MG', -20.2372, -42.8169),
  (3157500, 'Santa Efigênia de Minas', 'MG', -18.8235, -42.4388),
  (3157609, 'Santa Fé de Minas', 'MG', -16.6859, -45.4102),
  (3157658, 'Santa Helena de Minas', 'MG', -16.9707, -40.6727),
  (3157708, 'Santa Juliana', 'MG', -19.3108, -47.5322),
  (3157807, 'Santa Luzia', 'MG', -19.7548, -43.8497),
  (3157906, 'Santa Margarida', 'MG', -20.3839, -42.2519),
  (3158003, 'Santa Maria de Itabira', 'MG', -19.4431, -43.1064),
  (3158102, 'Santa Maria do Salto', 'MG', -16.2479, -40.1512),
  (3158201, 'Santa Maria do Suaçuí', 'MG', -18.1896, -42.4139),
  (3158300, 'Santana da Vargem', 'MG', -21.2449, -45.5005),
  (3158409, 'Santana de Cataguases', 'MG', -21.2893, -42.5524),
  (3158508, 'Santana de Pirapama', 'MG', -18.9962, -44.0409),
  (3158607, 'Santana do Deserto', 'MG', -21.9512, -43.1583),
  (3158706, 'Santana do Garambéu', 'MG', -21.5983, -44.105),
  (3158805, 'Santana do Jacaré', 'MG', -20.9007, -45.1285),
  (3158904, 'Santana do Manhuaçu', 'MG', -20.1031, -41.9278),
  (3158953, 'Santana do Paraíso', 'MG', -19.3661, -42.5446),
  (3159001, 'Santana do Riacho', 'MG', -19.1662, -43.722),
  (3159100, 'Santana dos Montes', 'MG', -20.7868, -43.6949),
  (3159209, 'Santa Rita de Caldas', 'MG', -22.0292, -46.3385),
  (3159308, 'Santa Rita de Jacutinga', 'MG', -22.1474, -44.0977),
  (3159357, 'Santa Rita de Minas', 'MG', -19.876, -42.1363),
  (3159407, 'Santa Rita de Ibitipoca', 'MG', -21.5658, -43.9163),
  (3159506, 'Santa Rita do Itueto', 'MG', -19.3576, -41.3821),
  (3159605, 'Santa Rita do Sapucaí', 'MG', -22.2461, -45.7034),
  (3159704, 'Santa Rosa da Serra', 'MG', -19.5186, -45.9611),
  (3159803, 'Santa Vitória', 'MG', -18.8414, -50.1208),
  (3159902, 'Santo Antônio do Amparo', 'MG', -20.943, -44.9176),
  (3160009, 'Santo Antônio do Aventureiro', 'MG', -21.7606, -42.8115),
  (3160108, 'Santo Antônio do Grama', 'MG', -20.3185, -42.6047),
  (3160207, 'Santo Antônio do Itambé', 'MG', -18.4609, -43.3006),
  (3160306, 'Santo Antônio do Jacinto', 'MG', -16.5332, -40.1817),
  (3160405, 'Santo Antônio do Monte', 'MG', -20.085, -45.2947),
  (3160454, 'Santo Antônio do Retiro', 'MG', -15.3393, -42.6171),
  (3160504, 'Santo Antônio do Rio Abaixo', 'MG', -19.2374, -43.2604),
  (3160603, 'Santo Hipólito', 'MG', -18.2968, -44.2229),
  (3160702, 'Santos Dumont', 'MG', -21.4634, -43.5499),
  (3160801, 'São Bento Abade', 'MG', -21.5839, -45.0699),
  (3160900, 'São Brás do Suaçuí', 'MG', -20.6242, -43.9515),
  (3160959, 'São Domingos das Dores', 'MG', -19.5246, -42.0106),
  (3161007, 'São Domingos do Prata', 'MG', -19.8678, -42.971),
  (3161056, 'São Félix de Minas', 'MG', -18.5959, -41.4889),
  (3161106, 'São Francisco', 'MG', -15.9514, -44.8593),
  (3161205, 'São Francisco de Paula', 'MG', -20.7036, -44.9838),
  (3161304, 'São Francisco de Sales', 'MG', -19.8611, -49.7727),
  (3161403, 'São Francisco do Glória', 'MG', -20.7923, -42.2673),
  (3161502, 'São Geraldo', 'MG', -20.9252, -42.8364),
  (3161601, 'São Geraldo da Piedade', 'MG', -18.8411, -42.2867),
  (3161650, 'São Geraldo do Baixio', 'MG', -18.9097, -41.363),
  (3161700, 'São Gonçalo do Abaeté', 'MG', -18.3315, -45.8265),
  (3161809, 'São Gonçalo do Pará', 'MG', -19.9822, -44.8593),
  (3161908, 'São Gonçalo do Rio Abaixo', 'MG', -19.8221, -43.366),
  (3162005, 'São Gonçalo do Sapucaí', 'MG', -21.8932, -45.5893),
  (3162104, 'São Gotardo', 'MG', -19.3087, -46.0465),
  (3162203, 'São João Batista do Glória', 'MG', -20.635, -46.508),
  (3162252, 'São João da Lagoa', 'MG', -16.8455, -44.3507),
  (3162302, 'São João da Mata', 'MG', -21.928, -45.9297),
  (3162401, 'São João da Ponte', 'MG', -15.9271, -44.0096),
  (3162450, 'São João das Missões', 'MG', -14.8859, -44.0922),
  (3162500, 'São João del Rei', 'MG', -21.1311, -44.2526),
  (3162559, 'São João do Manhuaçu', 'MG', -20.3933, -42.1533),
  (3162575, 'São João do Manteninha', 'MG', -18.723, -41.1628),
  (3162609, 'São João do Oriente', 'MG', -19.3384, -42.1575),
  (3162658, 'São João do Pacuí', 'MG', -16.5373, -44.5134),
  (3162708, 'São João do Paraíso', 'MG', -15.3168, -42.0213),
  (3162807, 'São João Evangelista', 'MG', -18.548, -42.7655),
  (3162906, 'São João Nepomuceno', 'MG', -21.5381, -43.0069),
  (3162922, 'São Joaquim de Bicas', 'MG', -20.048, -44.2749),
  (3162948, 'São José da Barra', 'MG', -20.7178, -46.313),
  (3162955, 'São José da Lapa', 'MG', -19.6971, -43.9586),
  (3163003, 'São José da Safira', 'MG', -18.3243, -42.1431),
  (3163102, 'São José da Varginha', 'MG', -19.7006, -44.556),
  (3163201, 'São José do Alegre', 'MG', -22.3243, -45.5258),
  (3163300, 'São José do Divino', 'MG', -18.4793, -41.3907),
  (3163409, 'São José do Goiabal', 'MG', -19.9214, -42.7035),
  (3163508, 'São José do Jacuri', 'MG', -18.281, -42.6729),
  (3163607, 'São José do Mantimento', 'MG', -20.0058, -41.7486),
  (3163706, 'São Lourenço', 'MG', -22.1166, -45.0506),
  (3163805, 'São Miguel do Anta', 'MG', -20.7067, -42.7174),
  (3163904, 'São Pedro da União', 'MG', -21.131, -46.6123),
  (3164001, 'São Pedro dos Ferros', 'MG', -20.1732, -42.5251),
  (3164100, 'São Pedro do Suaçuí', 'MG', -18.3609, -42.5981),
  (3164209, 'São Romão', 'MG', -16.3641, -45.0749),
  (3164308, 'São Roque de Minas', 'MG', -20.249, -46.3639),
  (3164407, 'São Sebastião da Bela Vista', 'MG', -22.1583, -45.7546),
  (3164431, 'São Sebastião da Vargem Alegre', 'MG', -19.7477, -43.3679),
  (3164472, 'São Sebastião do Anta', 'MG', -19.5064, -41.985),
  (3164506, 'São Sebastião do Maranhão', 'MG', -18.0873, -42.5659),
  (3164605, 'São Sebastião do Oeste', 'MG', -20.2758, -45.0063),
  (3164704, 'São Sebastião do Paraíso', 'MG', -20.9167, -46.9837),
  (3164803, 'São Sebastião do Rio Preto', 'MG', -19.2959, -43.1757),
  (3164902, 'São Sebastião do Rio Verde', 'MG', -22.2183, -44.9761),
  (3165008, 'São Tiago', 'MG', -20.9075, -44.5098),
  (3165107, 'São Tomás de Aquino', 'MG', -20.7791, -47.0962),
  (3165206, 'São Thomé das Letras', 'MG', -21.7218, -44.9849),
  (3165305, 'São Vicente de Minas', 'MG', -21.7042, -44.4431),
  (3165404, 'Sapucaí-Mirim', 'MG', -22.7409, -45.738),
  (3165503, 'Sardoá', 'MG', -18.7828, -42.3629),
  (3165537, 'Sarzedo', 'MG', -20.0367, -44.1446),
  (3165552, 'Setubinha', 'MG', -17.6002, -42.1587),
  (3165560, 'Sem-Peixe', 'MG', -20.1008, -42.8483),
  (3165578, 'Senador Amaral', 'MG', -22.5869, -46.1763),
  (3165602, 'Senador Cortes', 'MG', -21.7986, -42.9424),
  (3165701, 'Senador Firmino', 'MG', -20.9158, -43.0904),
  (3165800, 'Senador José Bento', 'MG', -22.1633, -46.1792),
  (3165909, 'Senador Modestino Gonçalves', 'MG', -17.9465, -43.2172),
  (3166006, 'Senhora de Oliveira', 'MG', -20.7972, -43.3394),
  (3166105, 'Senhora do Porto', 'MG', -18.8909, -43.0799),
  (3166204, 'Senhora dos Remédios', 'MG', -21.0351, -43.5812),
  (3166303, 'Sericita', 'MG', -20.4748, -42.4828),
  (3166402, 'Seritinga', 'MG', -21.9134, -44.518),
  (3166501, 'Serra Azul de Minas', 'MG', -18.3602, -43.1675),
  (3166600, 'Serra da Saudade', 'MG', -19.4447, -45.795),
  (3166709, 'Serra dos Aimorés', 'MG', -17.7872, -40.2453),
  (3166808, 'Serra do Salitre', 'MG', -19.1083, -46.6961),
  (3166907, 'Serrania', 'MG', -21.5441, -46.0417),
  (3166956, 'Serranópolis de Minas', 'MG', -15.8176, -42.8732),
  (3167004, 'Serranos', 'MG', -21.8857, -44.5125),
  (3167103, 'Serro', 'MG', -18.5991, -43.3744),
  (3167202, 'Sete Lagoas', 'MG', -19.4569, -44.2413),
  (3167301, 'Silveirânia', 'MG', -21.1615, -43.2128),
  (3167400, 'Silvianópolis', 'MG', -22.0274, -45.8385),
  (3167509, 'Simão Pereira', 'MG', -21.964, -43.3088),
  (3167608, 'Simonésia', 'MG', -20.1341, -42.0091),
  (3167707, 'Sobrália', 'MG', -19.2345, -42.0998),
  (3167806, 'Soledade de Minas', 'MG', -22.0554, -45.0464),
  (3167905, 'Tabuleiro', 'MG', -21.3632, -43.2381),
  (3168002, 'Taiobeiras', 'MG', -15.8106, -42.2259),
  (3168051, 'Taparuba', 'MG', -19.7621, -41.608),
  (3168101, 'Tapira', 'MG', -19.9166, -46.8264),
  (3168200, 'Tapiraí', 'MG', -19.8936, -46.0221),
  (3168309, 'Taquaraçu de Minas', 'MG', -19.6652, -43.6922),
  (3168408, 'Tarumirim', 'MG', -19.2835, -42.0097),
  (3168507, 'Teixeiras', 'MG', -20.6561, -42.8564),
  (3168606, 'Teófilo Otoni', 'MG', -17.8595, -41.5087),
  (3168705, 'Timóteo', 'MG', -19.5811, -42.6471),
  (3168804, 'Tiradentes', 'MG', -21.1102, -44.1744),
  (3168903, 'Tiros', 'MG', -19.0037, -45.9626),
  (3169000, 'Tocantins', 'MG', -21.1774, -43.0127),
  (3169059, 'Tocos do Moji', 'MG', -22.3698, -46.0971),
  (3169109, 'Toledo', 'MG', -22.7421, -46.3728),
  (3169208, 'Tombos', 'MG', -20.9086, -42.0228),
  (3169307, 'Três Corações', 'MG', -21.6921, -45.2511),
  (3169356, 'Três Marias', 'MG', -18.2048, -45.2473),
  (3169406, 'Três Pontas', 'MG', -21.3694, -45.5109),
  (3169505, 'Tumiritinga', 'MG', -18.9844, -41.6527),
  (3169604, 'Tupaciguara', 'MG', -18.5866, -48.6985),
  (3169703, 'Turmalina', 'MG', -17.2828, -42.7285),
  (3169802, 'Turvolândia', 'MG', -21.8733, -45.7859),
  (3169901, 'Ubá', 'MG', -21.1204, -42.9359),
  (3170008, 'Ubaí', 'MG', -16.2885, -44.7783),
  (3170057, 'Ubaporanga', 'MG', -19.6351, -42.1059),
  (3170107, 'Uberaba', 'MG', -19.7472, -47.9381),
  (3170206, 'Uberlândia', 'MG', -18.9141, -48.2749),
  (3170305, 'Umburatiba', 'MG', -17.2548, -40.5779),
  (3170404, 'Unaí', 'MG', -16.3592, -46.9022),
  (3170438, 'União de Minas', 'MG', -19.5299, -50.338),
  (3170479, 'Uruana de Minas', 'MG', -16.0634, -46.2443),
  (3170503, 'Urucânia', 'MG', -20.3521, -42.737),
  (3170529, 'Urucuia', 'MG', -16.1244, -45.7352),
  (3170578, 'Vargem Alegre', 'MG', -19.5988, -42.2949),
  (3170602, 'Vargem Bonita', 'MG', -20.3333, -46.3688),
  (3170651, 'Vargem Grande do Rio Pardo', 'MG', -15.3987, -42.3085),
  (3170701, 'Varginha', 'MG', -21.5556, -45.4364),
  (3170750, 'Varjão de Minas', 'MG', -18.3741, -46.0313),
  (3170800, 'Várzea da Palma', 'MG', -17.5944, -44.7226),
  (3170909, 'Varzelândia', 'MG', -15.6992, -44.0278),
  (3171006, 'Vazante', 'MG', -17.9827, -46.9088),
  (3171030, 'Verdelândia', 'MG', -15.5845, -43.6121),
  (3171071, 'Veredinha', 'MG', -17.3974, -42.7307),
  (3171105, 'Veríssimo', 'MG', -19.6657, -48.3118),
  (3171154, 'Vermelho Novo', 'MG', -20.0406, -42.2688),
  (3171204, 'Vespasiano', 'MG', -19.6883, -43.9239),
  (3171303, 'Viçosa', 'MG', -20.7559, -42.8742),
  (3171402, 'Vieiras', 'MG', -20.867, -42.2401),
  (3171501, 'Mathias Lobato', 'MG', -18.59, -41.9166),
  (3171600, 'Virgem da Lapa', 'MG', -16.807, -42.3431),
  (3171709, 'Virgínia', 'MG', -22.3264, -45.0965),
  (3171808, 'Virginópolis', 'MG', -18.8154, -42.7015),
  (3171907, 'Virgolândia', 'MG', -18.4738, -42.3067),
  (3172004, 'Visconde do Rio Branco', 'MG', -21.0127, -42.8361),
  (3172103, 'Volta Grande', 'MG', -21.7671, -42.5375),
  (3172202, 'Wenceslau Braz', 'MG', -22.5368, -45.3626),
  (3500105, 'Adamantina', 'SP', -21.682, -51.0737),
  (3500204, 'Adolfo', 'SP', -21.2325, -49.6451),
  (3500303, 'Aguaí', 'SP', -22.0572, -46.9735),
  (3500402, 'Águas da Prata', 'SP', -21.9319, -46.7176),
  (3500501, 'Águas de Lindóia', 'SP', -22.4733, -46.6314),
  (3500550, 'Águas de Santa Bárbara', 'SP', -22.8812, -49.2421),
  (3500600, 'Águas de São Pedro', 'SP', -22.5977, -47.8734),
  (3500709, 'Agudos', 'SP', -22.4694, -48.9863),
  (3500758, 'Alambari', 'SP', -23.5503, -47.898),
  (3500808, 'Alfredo Marcondes', 'SP', -21.9527, -51.414),
  (3500907, 'Altair', 'SP', -20.5242, -49.0571),
  (3501004, 'Altinópolis', 'SP', -21.0214, -47.3712),
  (3501103, 'Alto Alegre', 'SP', -21.5811, -50.168),
  (3501152, 'Alumínio', 'SP', -23.5306, -47.2546),
  (3501202, 'Álvares Florence', 'SP', -20.3203, -49.9141),
  (3501301, 'Álvares Machado', 'SP', -22.0764, -51.4722),
  (3501400, 'Álvaro de Carvalho', 'SP', -22.0841, -49.719),
  (3501509, 'Alvinlândia', 'SP', -22.4435, -49.7623),
  (3501608, 'Americana', 'SP', -22.7374, -47.3331),
  (3501707, 'Américo Brasiliense', 'SP', -21.7288, -48.1147),
  (3501806, 'Américo de Campos', 'SP', -20.2985, -49.7359),
  (3501905, 'Amparo', 'SP', -22.7088, -46.772),
  (3502002, 'Analândia', 'SP', -22.1289, -47.6619),
  (3502101, 'Andradina', 'SP', -20.8948, -51.3786),
  (3502200, 'Angatuba', 'SP', -23.4917, -48.4139),
  (3502309, 'Anhembi', 'SP', -22.793, -48.1336),
  (3502408, 'Anhumas', 'SP', -22.2934, -51.3895),
  (3502507, 'Aparecida', 'SP', -22.8495, -45.2325),
  (3502606, 'Aparecida d''Oeste', 'SP', -20.4487, -50.8835),
  (3502705, 'Apiaí', 'SP', -24.5108, -48.8443),
  (3502754, 'Araçariguama', 'SP', -23.4366, -47.0608),
  (3502804, 'Araçatuba', 'SP', -21.2076, -50.4401),
  (3502903, 'Araçoiaba da Serra', 'SP', -23.5029, -47.6166),
  (3503000, 'Aramina', 'SP', -20.0882, -47.7873),
  (3503109, 'Arandu', 'SP', -23.1386, -49.0487),
  (3503158, 'Arapeí', 'SP', -22.6717, -44.4441),
  (3503208, 'Araraquara', 'SP', -21.7845, -48.178),
  (3503307, 'Araras', 'SP', -22.3572, -47.3842),
  (3503356, 'Arco-Íris', 'SP', -21.7728, -50.466),
  (3503406, 'Arealva', 'SP', -22.031, -48.9135),
  (3503505, 'Areias', 'SP', -22.5786, -44.6992),
  (3503604, 'Areiópolis', 'SP', -22.6672, -48.6681),
  (3503703, 'Ariranha', 'SP', -21.1872, -48.7904),
  (3503802, 'Artur Nogueira', 'SP', -22.5727, -47.1727),
  (3503901, 'Arujá', 'SP', -23.3965, -46.32),
  (3503950, 'Aspásia', 'SP', -20.16, -50.728),
  (3504008, 'Assis', 'SP', -22.66, -50.4183),
  (3504107, 'Atibaia', 'SP', -23.1171, -46.5563),
  (3504206, 'Auriflama', 'SP', -20.6836, -50.5572),
  (3504305, 'Avaí', 'SP', -22.1514, -49.3356),
  (3504404, 'Avanhandava', 'SP', -21.4584, -49.9509),
  (3504503, 'Avaré', 'SP', -23.1067, -48.9251),
  (3504602, 'Bady Bassitt', 'SP', -20.9197, -49.4385),
  (3504701, 'Balbinos', 'SP', -21.8963, -49.3619),
  (3504800, 'Bálsamo', 'SP', -20.7348, -49.5865),
  (3504909, 'Bananal', 'SP', -22.6819, -44.3281),
  (3505005, 'Barão de Antonina', 'SP', -23.6284, -49.5634),
  (3505104, 'Barbosa', 'SP', -21.2657, -49.9518),
  (3505203, 'Bariri', 'SP', -22.073, -48.7438),
  (3505302, 'Barra Bonita', 'SP', -22.4909, -48.5583),
  (3505351, 'Barra do Chapéu', 'SP', -24.4722, -49.0238),
  (3505401, 'Barra do Turvo', 'SP', -24.759, -48.5013),
  (3505500, 'Barretos', 'SP', -20.5531, -48.5698),
  (3505609, 'Barrinha', 'SP', -21.1864, -48.1636),
  (3505708, 'Barueri', 'SP', -23.5057, -46.879),
  (3505807, 'Bastos', 'SP', -21.921, -50.7357),
  (3505906, 'Batatais', 'SP', -20.8929, -47.5921),
  (3506003, 'Bauru', 'SP', -22.3246, -49.0871),
  (3506102, 'Bebedouro', 'SP', -20.9491, -48.4791),
  (3506201, 'Bento de Abreu', 'SP', -21.2686, -50.814),
  (3506300, 'Bernardino de Campos', 'SP', -23.0164, -49.4679),
  (3506359, 'Bertioga', 'SP', -23.8486, -46.1396),
  (3506409, 'Bilac', 'SP', -21.404, -50.4746),
  (3506508, 'Birigui', 'SP', -21.291, -50.3432),
  (3506607, 'Biritiba-Mirim', 'SP', -23.5698, -46.0407),
  (3506706, 'Boa Esperança do Sul', 'SP', -21.9918, -48.3906),
  (3506805, 'Bocaina', 'SP', -22.1365, -48.523),
  (3506904, 'Bofete', 'SP', -23.1055, -48.2582),
  (3507001, 'Boituva', 'SP', -23.2855, -47.6786),
  (3507100, 'Bom Jesus dos Perdões', 'SP', -23.1356, -46.4675),
  (3507159, 'Bom Sucesso de Itararé', 'SP', -24.3155, -49.1451),
  (3507209, 'Borá', 'SP', -22.2696, -50.5409),
  (3507308, 'Boracéia', 'SP', -22.1926, -48.7808),
  (3507407, 'Borborema', 'SP', -21.6214, -49.0741),
  (3507456, 'Borebi', 'SP', -22.5728, -48.9707),
  (3507506, 'Botucatu', 'SP', -22.8837, -48.4437),
  (3507605, 'Bragança Paulista', 'SP', -22.9527, -46.5419),
  (3507704, 'Braúna', 'SP', -21.499, -50.3175),
  (3507753, 'Brejo Alegre', 'SP', -21.1651, -50.1861),
  (3507803, 'Brodowski', 'SP', -20.9845, -47.6572),
  (3507902, 'Brotas', 'SP', -22.2795, -48.1251),
  (3508009, 'Buri', 'SP', -23.7977, -48.5958),
  (3508108, 'Buritama', 'SP', -21.0661, -50.1475),
  (3508207, 'Buritizal', 'SP', -20.1911, -47.7096),
  (3508306, 'Cabrália Paulista', 'SP', -22.4576, -49.3393),
  (3508405, 'Cabreúva', 'SP', -23.3053, -47.1362),
  (3508504, 'Caçapava', 'SP', -23.0992, -45.7076),
  (3508603, 'Cachoeira Paulista', 'SP', -22.6665, -45.0154),
  (3508702, 'Caconde', 'SP', -21.528, -46.6437),
  (3508801, 'Cafelândia', 'SP', -21.8031, -49.6092),
  (3508900, 'Caiabu', 'SP', -22.0127, -51.2394),
  (3509007, 'Caieiras', 'SP', -23.3607, -46.7397),
  (3509106, 'Caiuá', 'SP', -21.8322, -51.9969),
  (3509205, 'Cajamar', 'SP', -23.355, -46.8781),
  (3509254, 'Cajati', 'SP', -24.7324, -48.1223),
  (3509304, 'Cajobi', 'SP', -20.8773, -48.8063),
  (3509403, 'Cajuru', 'SP', -21.2749, -47.303),
  (3509452, 'Campina do Monte Alegre', 'SP', -23.5895, -48.4758),
  (3509502, 'Campinas', 'SP', -22.9053, -47.0659),
  (3509601, 'Campo Limpo Paulista', 'SP', -23.2078, -46.7889),
  (3509700, 'Campos do Jordão', 'SP', -22.7296, -45.5833),
  (3509809, 'Campos Novos Paulista', 'SP', -22.602, -49.9987),
  (3509908, 'Cananéia', 'SP', -25.0144, -47.9341),
  (3509957, 'Canas', 'SP', -22.7003, -45.0521),
  (3510005, 'Cândido Mota', 'SP', -22.7471, -50.3873),
  (3510104, 'Cândido Rodrigues', 'SP', -21.3275, -48.6327),
  (3510153, 'Canitar', 'SP', -23.004, -49.7839),
  (3510203, 'Capão Bonito', 'SP', -24.0113, -48.3482),
  (3510302, 'Capela do Alto', 'SP', -23.4685, -47.7388),
  (3510401, 'Capivari', 'SP', -22.9951, -47.5071),
  (3510500, 'Caraguatatuba', 'SP', -23.6125, -45.4125),
  (3510609, 'Carapicuíba', 'SP', -23.5235, -46.8407),
  (3510708, 'Cardoso', 'SP', -20.08, -49.9183),
  (3510807, 'Casa Branca', 'SP', -21.7708, -47.0852),
  (3510906, 'Cássia dos Coqueiros', 'SP', -21.2801, -47.1643),
  (3511003, 'Castilho', 'SP', -20.8689, -51.4884),
  (3511102, 'Catanduva', 'SP', -21.1314, -48.977),
  (3511201, 'Catiguá', 'SP', -21.0519, -49.0616),
  (3511300, 'Cedral', 'SP', -20.9009, -49.2664),
  (3511409, 'Cerqueira César', 'SP', -23.038, -49.1655),
  (3511508, 'Cerquilho', 'SP', -23.1665, -47.7459),
  (3511607, 'Cesário Lange', 'SP', -23.226, -47.9545),
  (3511706, 'Charqueada', 'SP', -22.5096, -47.7755),
  (3511904, 'Clementina', 'SP', -21.5604, -50.4525),
  (3512001, 'Colina', 'SP', -20.7114, -48.5387),
  (3512100, 'Colômbia', 'SP', -20.1768, -48.6865),
  (3512209, 'Conchal', 'SP', -22.3375, -47.1729),
  (3512308, 'Conchas', 'SP', -23.0154, -48.0134),
  (3512407, 'Cordeirópolis', 'SP', -22.4778, -47.4519),
  (3512506, 'Coroados', 'SP', -21.3521, -50.2859),
  (3512605, 'Coronel Macedo', 'SP', -23.6261, -49.31),
  (3512704, 'Corumbataí', 'SP', -22.2213, -47.6215),
  (3512803, 'Cosmópolis', 'SP', -22.6419, -47.1926),
  (3512902, 'Cosmorama', 'SP', -20.4755, -49.7827),
  (3513009, 'Cotia', 'SP', -23.6022, -46.919),
  (3513108, 'Cravinhos', 'SP', -21.338, -47.7324),
  (3513207, 'Cristais Paulista', 'SP', -20.4036, -47.4209),
  (3513306, 'Cruzália', 'SP', -22.7373, -50.7909),
  (3513405, 'Cruzeiro', 'SP', -22.5728, -44.969),
  (3513504, 'Cubatão', 'SP', -23.8911, -46.424),
  (3513603, 'Cunha', 'SP', -23.0731, -44.9576),
  (3513702, 'Descalvado', 'SP', -21.9002, -47.6181),
  (3513801, 'Diadema', 'SP', -23.6813, -46.6205),
  (3513850, 'Dirce Reis', 'SP', -20.4642, -50.6073),
  (3513900, 'Divinolândia', 'SP', -21.6637, -46.7361),
  (3514007, 'Dobrada', 'SP', -21.5155, -48.3935),
  (3514106, 'Dois Córregos', 'SP', -22.3673, -48.3819),
  (3514205, 'Dolcinópolis', 'SP', -20.124, -50.5149),
  (3514304, 'Dourado', 'SP', -22.1044, -48.3178),
  (3514403, 'Dracena', 'SP', -21.4843, -51.535),
  (3514502, 'Duartina', 'SP', -22.4146, -49.4084),
  (3514601, 'Dumont', 'SP', -21.2324, -47.9756),
  (3514700, 'Echaporã', 'SP', -22.4326, -50.2038),
  (3514809, 'Eldorado', 'SP', -24.5281, -48.1141),
  (3514908, 'Elias Fausto', 'SP', -23.0428, -47.3682),
  (3514924, 'Elisiário', 'SP', -21.1678, -49.1146),
  (3514957, 'Embaúba', 'SP', -20.9796, -48.8325),
  (3515004, 'Embu das Artes', 'SP', -23.6437, -46.8579),
  (3515103, 'Embu-Guaçu', 'SP', -23.8297, -46.8136),
  (3515129, 'Emilianópolis', 'SP', -21.8314, -51.4832),
  (3515152, 'Engenheiro Coelho', 'SP', -22.4836, -47.211),
  (3515186, 'Espírito Santo do Pinhal', 'SP', -22.1909, -46.7477),
  (3515194, 'Espírito Santo do Turvo', 'SP', -22.6925, -49.4341),
  (3515202, 'Estrela d''Oeste', 'SP', -20.2875, -50.4049),
  (3515301, 'Estrela do Norte', 'SP', -22.4859, -51.6632),
  (3515350, 'Euclides da Cunha Paulista', 'SP', -22.5545, -52.5928),
  (3515400, 'Fartura', 'SP', -23.3916, -49.5124),
  (3515509, 'Fernandópolis', 'SP', -20.2806, -50.2471),
  (3515608, 'Fernando Prestes', 'SP', -21.2661, -48.6874),
  (3515657, 'Fernão', 'SP', -22.3607, -49.5187),
  (3515707, 'Ferraz de Vasconcelos', 'SP', -23.5411, -46.371),
  (3515806, 'Flora Rica', 'SP', -21.6727, -51.3821),
  (3515905, 'Floreal', 'SP', -20.6752, -50.1513),
  (3516002, 'Flórida Paulista', 'SP', -21.6127, -51.1724),
  (3516101, 'Florínia', 'SP', -22.868, -50.6814),
  (3516200, 'Franca', 'SP', -20.5352, -47.4039),
  (3516309, 'Francisco Morato', 'SP', -23.2792, -46.7448),
  (3516408, 'Franco da Rocha', 'SP', -23.3229, -46.729),
  (3516507, 'Gabriel Monteiro', 'SP', -21.5294, -50.5573),
  (3516606, 'Gália', 'SP', -22.2918, -49.5504),
  (3516705, 'Garça', 'SP', -22.2125, -49.6546),
  (3516804, 'Gastão Vidigal', 'SP', -20.7948, -50.1912),
  (3516853, 'Gavião Peixoto', 'SP', -21.8367, -48.4957),
  (3516903, 'General Salgado', 'SP', -20.6485, -50.364),
  (3517000, 'Getulina', 'SP', -21.7961, -49.9312),
  (3517109, 'Glicério', 'SP', -21.3812, -50.2123),
  (3517208, 'Guaiçara', 'SP', -21.6195, -49.8013),
  (3517307, 'Guaimbê', 'SP', -21.9091, -49.8986),
  (3517406, 'Guaíra', 'SP', -20.3196, -48.312),
  (3517505, 'Guapiaçu', 'SP', -20.7959, -49.2172),
  (3517604, 'Guapiara', 'SP', -24.1892, -48.5295),
  (3517703, 'Guará', 'SP', -20.4302, -47.8236),
  (3517802, 'Guaraçaí', 'SP', -21.0292, -51.2119),
  (3517901, 'Guaraci', 'SP', -20.4977, -48.9391),
  (3518008, 'Guarani d''Oeste', 'SP', -20.0746, -50.3411),
  (3518107, 'Guarantã', 'SP', -21.8942, -49.5914),
  (3518206, 'Guararapes', 'SP', -21.2544, -50.6453),
  (3518305, 'Guararema', 'SP', -23.4112, -46.0369),
  (3518404, 'Guaratinguetá', 'SP', -22.8075, -45.1938),
  (3518503, 'Guareí', 'SP', -23.3714, -48.1837),
  (3518602, 'Guariba', 'SP', -21.3594, -48.2316),
  (3518701, 'Guarujá', 'SP', -23.9888, -46.258),
  (3518800, 'Guarulhos', 'SP', -23.4538, -46.5333),
  (3518859, 'Guatapará', 'SP', -21.4944, -48.0356),
  (3518909, 'Guzolândia', 'SP', -20.6467, -50.6645),
  (3519006, 'Herculândia', 'SP', -22.0038, -50.3907),
  (3519055, 'Holambra', 'SP', -22.6405, -47.0487),
  (3519071, 'Hortolândia', 'SP', -22.8529, -47.2143),
  (3519105, 'Iacanga', 'SP', -21.8896, -49.031),
  (3519204, 'Iacri', 'SP', -21.8572, -50.6932),
  (3519253, 'Iaras', 'SP', -22.8682, -49.1634),
  (3519303, 'Ibaté', 'SP', -21.9584, -47.9882),
  (3519402, 'Ibirá', 'SP', -21.083, -49.2448),
  (3519501, 'Ibirarema', 'SP', -22.8185, -50.0739),
  (3519600, 'Ibitinga', 'SP', -21.7562, -48.8319),
  (3519709, 'Ibiúna', 'SP', -23.6596, -47.223),
  (3519808, 'Icém', 'SP', -20.3391, -49.1915),
  (3519907, 'Iepê', 'SP', -22.6602, -51.0779),
  (3520004, 'Igaraçu do Tietê', 'SP', -22.509, -48.5597),
  (3520103, 'Igarapava', 'SP', -20.0407, -47.7466),
  (3520202, 'Igaratá', 'SP', -23.2037, -46.157),
  (3520301, 'Iguape', 'SP', -24.699, -47.5537),
  (3520400, 'Ilhabela', 'SP', -23.7785, -45.3552),
  (3520426, 'Ilha Comprida', 'SP', -24.7307, -47.5383),
  (3520442, 'Ilha Solteira', 'SP', -20.4326, -51.3426),
  (3520509, 'Indaiatuba', 'SP', -23.0816, -47.2101),
  (3520608, 'Indiana', 'SP', -22.1738, -51.2555),
  (3520707, 'Indiaporã', 'SP', -19.979, -50.2909),
  (3520806, 'Inúbia Paulista', 'SP', -21.7695, -50.9633),
  (3520905, 'Ipaussu', 'SP', -23.0575, -49.6279),
  (3521002, 'Iperó', 'SP', -23.3513, -47.6927),
  (3521101, 'Ipeúna', 'SP', -22.4355, -47.7151),
  (3521150, 'Ipiguá', 'SP', -20.6557, -49.3842),
  (3521200, 'Iporanga', 'SP', -24.5847, -48.5971),
  (3521309, 'Ipuã', 'SP', -20.4438, -48.0129),
  (3521408, 'Iracemápolis', 'SP', -22.5832, -47.523),
  (3521507, 'Irapuã', 'SP', -21.2768, -49.4164),
  (3521606, 'Irapuru', 'SP', -21.5684, -51.3472),
  (3521705, 'Itaberá', 'SP', -23.8638, -49.14),
  (3521804, 'Itaí', 'SP', -23.4213, -49.092),
  (3521903, 'Itajobi', 'SP', -21.3123, -49.0629),
  (3522000, 'Itaju', 'SP', -21.9857, -48.8116),
  (3522109, 'Itanhaém', 'SP', -24.1736, -46.788),
  (3522158, 'Itaóca', 'SP', -24.6393, -48.8413),
  (3522208, 'Itapecerica da Serra', 'SP', -23.7161, -46.8572),
  (3522307, 'Itapetininga', 'SP', -23.5886, -48.0483),
  (3522406, 'Itapeva', 'SP', -23.9788, -48.8764),
  (3522505, 'Itapevi', 'SP', -23.5488, -46.9327),
  (3522604, 'Itapira', 'SP', -22.4357, -46.8224),
  (3522653, 'Itapirapuã Paulista', 'SP', -24.572, -49.1661),
  (3522703, 'Itápolis', 'SP', -21.5942, -48.8149),
  (3522802, 'Itaporanga', 'SP', -23.7043, -49.4819),
  (3522901, 'Itapuí', 'SP', -22.2324, -48.7197),
  (3523008, 'Itapura', 'SP', -20.6419, -51.5063),
  (3523107, 'Itaquaquecetuba', 'SP', -23.4835, -46.3457),
  (3523206, 'Itararé', 'SP', -24.1085, -49.3352),
  (3523305, 'Itariri', 'SP', -24.2834, -47.1736),
  (3523404, 'Itatiba', 'SP', -23.0035, -46.8464),
  (3523503, 'Itatinga', 'SP', -23.1047, -48.6157),
  (3523602, 'Itirapina', 'SP', -22.2562, -47.8166),
  (3523701, 'Itirapuã', 'SP', -20.6416, -47.2194),
  (3523800, 'Itobi', 'SP', -21.7309, -46.9743),
  (3523909, 'Itu', 'SP', -23.2544, -47.2927),
  (3524006, 'Itupeva', 'SP', -23.1526, -47.0593),
  (3524105, 'Ituverava', 'SP', -20.3355, -47.7902),
  (3524204, 'Jaborandi', 'SP', -20.6884, -48.4112),
  (3524303, 'Jaboticabal', 'SP', -21.252, -48.3252),
  (3524402, 'Jacareí', 'SP', -23.2983, -45.9658),
  (3524501, 'Jaci', 'SP', -20.8805, -49.5797),
  (3524600, 'Jacupiranga', 'SP', -24.6963, -48.0064),
  (3524709, 'Jaguariúna', 'SP', -22.7037, -46.9851),
  (3524808, 'Jales', 'SP', -20.2672, -50.5494),
  (3524907, 'Jambeiro', 'SP', -23.2522, -45.6942),
  (3525003, 'Jandira', 'SP', -23.5275, -46.9023),
  (3525102, 'Jardinópolis', 'SP', -21.0176, -47.7606),
  (3525201, 'Jarinu', 'SP', -23.1039, -46.728),
  (3525300, 'Jaú', 'SP', -22.2936, -48.5592),
  (3525409, 'Jeriquara', 'SP', -20.3116, -47.5918),
  (3525508, 'Joanópolis', 'SP', -22.927, -46.2741),
  (3525607, 'João Ramalho', 'SP', -22.2473, -50.7694),
  (3525706, 'José Bonifácio', 'SP', -21.0551, -49.6892),
  (3525805, 'Júlio Mesquita', 'SP', -22.0112, -49.7873),
  (3525854, 'Jumirim', 'SP', -23.0884, -47.7868),
  (3525904, 'Jundiaí', 'SP', -23.1852, -46.8974),
  (3526001, 'Junqueirópolis', 'SP', -21.5103, -51.4342),
  (3526100, 'Juquiá', 'SP', -24.3101, -47.6426),
  (3526209, 'Juquitiba', 'SP', -23.9244, -47.0653),
  (3526308, 'Lagoinha', 'SP', -23.0846, -45.1944),
  (3526407, 'Laranjal Paulista', 'SP', -23.0506, -47.8375),
  (3526506, 'Lavínia', 'SP', -21.1639, -51.0412),
  (3526605, 'Lavrinhas', 'SP', -22.57, -44.9024),
  (3526704, 'Leme', 'SP', -22.1809, -47.3841),
  (3526803, 'Lençóis Paulista', 'SP', -22.6027, -48.8037),
  (3526902, 'Limeira', 'SP', -22.566, -47.397),
  (3527009, 'Lindóia', 'SP', -22.5226, -46.65),
  (3527108, 'Lins', 'SP', -21.6718, -49.7526),
  (3527207, 'Lorena', 'SP', -22.7334, -45.1197),
  (3527256, 'Lourdes', 'SP', -20.966, -50.2263),
  (3527306, 'Louveira', 'SP', -23.0856, -46.9484),
  (3527405, 'Lucélia', 'SP', -21.7182, -51.0215),
  (3527504, 'Lucianópolis', 'SP', -22.4294, -49.522),
  (3527603, 'Luís Antônio', 'SP', -21.55, -47.7801),
  (3527702, 'Luiziânia', 'SP', -21.6737, -50.3294),
  (3527801, 'Lupércio', 'SP', -22.4146, -49.818),
  (3527900, 'Lutécia', 'SP', -22.3384, -50.394),
  (3528007, 'Macatuba', 'SP', -22.5002, -48.7102),
  (3528106, 'Macaubal', 'SP', -20.8022, -49.9687),
  (3528205, 'Macedônia', 'SP', -20.1444, -50.1973),
  (3528304, 'Magda', 'SP', -20.6445, -50.2305),
  (3528403, 'Mairinque', 'SP', -23.5398, -47.185),
  (3528502, 'Mairiporã', 'SP', -23.3171, -46.5897),
  (3528601, 'Manduri', 'SP', -23.0056, -49.3202),
  (3528700, 'Marabá Paulista', 'SP', -22.1068, -51.9617),
  (3528809, 'Maracaí', 'SP', -22.6149, -50.6713),
  (3528858, 'Marapoama', 'SP', -21.2587, -49.13),
  (3528908, 'Mariápolis', 'SP', -21.7959, -51.1824),
  (3529005, 'Marília', 'SP', -22.2171, -49.9501),
  (3529104, 'Marinópolis', 'SP', -20.4389, -50.8254),
  (3529203, 'Martinópolis', 'SP', -22.1462, -51.1709),
  (3529302, 'Matão', 'SP', -21.6025, -48.364),
  (3529401, 'Mauá', 'SP', -23.6677, -46.4613),
  (3529500, 'Mendonça', 'SP', -21.1757, -49.5791),
  (3529609, 'Meridiano', 'SP', -20.3579, -50.1811),
  (3529658, 'Mesópolis', 'SP', -19.9684, -50.6326),
  (3529708, 'Miguelópolis', 'SP', -20.1796, -48.031),
  (3529807, 'Mineiros do Tietê', 'SP', -22.412, -48.451),
  (3529906, 'Miracatu', 'SP', -24.2766, -47.4625),
  (3530003, 'Mira Estrela', 'SP', -19.9789, -50.139),
  (3530102, 'Mirandópolis', 'SP', -21.1313, -51.1035),
  (3530201, 'Mirante do Paranapanema', 'SP', -22.2904, -51.9084),
  (3530300, 'Mirassol', 'SP', -20.8169, -49.5206),
  (3530409, 'Mirassolândia', 'SP', -20.6179, -49.4617),
  (3530508, 'Mococa', 'SP', -21.4647, -47.0024),
  (3530607, 'Mogi das Cruzes', 'SP', -23.5208, -46.1854),
  (3530706, 'Mogi Guaçu', 'SP', -22.3675, -46.9428),
  (3530805, 'Mogi Mirim', 'SP', -22.4332, -46.9532),
  (3530904, 'Mombuca', 'SP', -22.9285, -47.559),
  (3531001, 'Monções', 'SP', -20.8509, -50.0975),
  (3531100, 'Mongaguá', 'SP', -24.0809, -46.6265),
  (3531209, 'Monte Alegre do Sul', 'SP', -22.6817, -46.681),
  (3531308, 'Monte Alto', 'SP', -21.2655, -48.4971),
  (3531407, 'Monte Aprazível', 'SP', -20.768, -49.7184),
  (3531506, 'Monte Azul Paulista', 'SP', -20.9065, -48.6387),
  (3531605, 'Monte Castelo', 'SP', -21.2981, -51.5679),
  (3531704, 'Monteiro Lobato', 'SP', -22.9544, -45.8407),
  (3531803, 'Monte Mor', 'SP', -22.945, -47.3122),
  (3531902, 'Morro Agudo', 'SP', -20.7288, -48.0581),
  (3532009, 'Morungaba', 'SP', -22.8811, -46.7896),
  (3532058, 'Motuca', 'SP', -21.5103, -48.1538),
  (3532108, 'Murutinga do Sul', 'SP', -20.9908, -51.2774),
  (3532157, 'Nantes', 'SP', -22.6156, -51.24),
  (3532207, 'Narandiba', 'SP', -22.4057, -51.5274),
  (3532306, 'Natividade da Serra', 'SP', -23.3707, -45.4468),
  (3532405, 'Nazaré Paulista', 'SP', -23.1747, -46.3983),
  (3532504, 'Neves Paulista', 'SP', -20.843, -49.6358),
  (3532603, 'Nhandeara', 'SP', -20.6945, -50.0436),
  (3532702, 'Nipoã', 'SP', -20.9114, -49.7833),
  (3532801, 'Nova Aliança', 'SP', -21.0156, -49.4986),
  (3532827, 'Nova Campina', 'SP', -24.1224, -48.9022),
  (3532843, 'Nova Canaã Paulista', 'SP', -20.3836, -50.9483),
  (3532868, 'Nova Castilho', 'SP', -20.7615, -50.3477),
  (3532900, 'Nova Europa', 'SP', -21.7765, -48.5705),
  (3533007, 'Nova Granada', 'SP', -20.5321, -49.3123),
  (3533106, 'Nova Guataporanga', 'SP', -21.332, -51.6447),
  (3533205, 'Nova Independência', 'SP', -21.1026, -51.4905),
  (3533254, 'Novais', 'SP', -20.9893, -48.9141),
  (3533304, 'Nova Luzitânia', 'SP', -20.856, -50.2617),
  (3533403, 'Nova Odessa', 'SP', -22.7832, -47.2941),
  (3533502, 'Novo Horizonte', 'SP', -21.4651, -49.2234),
  (3533601, 'Nuporanga', 'SP', -20.7296, -47.7429),
  (3533700, 'Ocauçu', 'SP', -22.438, -49.922),
  (3533809, 'Óleo', 'SP', -22.9435, -49.3419),
  (3533908, 'Olímpia', 'SP', -20.7366, -48.9106),
  (3534005, 'Onda Verde', 'SP', -20.6042, -49.2929),
  (3534104, 'Oriente', 'SP', -22.1549, -50.0971),
  (3534203, 'Orindiúva', 'SP', -20.1861, -49.3464),
  (3534302, 'Orlândia', 'SP', -20.7169, -47.8852),
  (3534401, 'Osasco', 'SP', -23.5324, -46.7916),
  (3534500, 'Oscar Bressane', 'SP', -22.3149, -50.2811),
  (3534609, 'Osvaldo Cruz', 'SP', -21.7968, -50.8793),
  (3534708, 'Ourinhos', 'SP', -22.9797, -49.8697),
  (3534757, 'Ouroeste', 'SP', -20.0061, -50.3768),
  (3534807, 'Ouro Verde', 'SP', -21.4872, -51.7024),
  (3534906, 'Pacaembu', 'SP', -21.5627, -51.2654),
  (3535002, 'Palestina', 'SP', -20.39, -49.4309),
  (3535101, 'Palmares Paulista', 'SP', -21.0854, -48.8037),
  (3535200, 'Palmeira d''Oeste', 'SP', -20.4148, -50.7632),
  (3535309, 'Palmital', 'SP', -22.7858, -50.218),
  (3535408, 'Panorama', 'SP', -21.354, -51.8562),
  (3535507, 'Paraguaçu Paulista', 'SP', -22.4114, -50.5732),
  (3535606, 'Paraibuna', 'SP', -23.3872, -45.6639),
  (3535705, 'Paraíso', 'SP', -21.0159, -48.7761),
  (3535804, 'Paranapanema', 'SP', -23.3862, -48.7214),
  (3535903, 'Paranapuã', 'SP', -20.1048, -50.5886),
  (3536000, 'Parapuã', 'SP', -21.7792, -50.7949),
  (3536109, 'Pardinho', 'SP', -23.0841, -48.3679),
  (3536208, 'Pariquera-Açu', 'SP', -24.7147, -47.8742),
  (3536257, 'Parisi', 'SP', -20.3034, -50.0163),
  (3536307, 'Patrocínio Paulista', 'SP', -20.6384, -47.2801),
  (3536406, 'Paulicéia', 'SP', -21.3153, -51.8321),
  (3536505, 'Paulínia', 'SP', -22.7542, -47.1488),
  (3536570, 'Paulistânia', 'SP', -22.5768, -49.4008),
  (3536604, 'Paulo de Faria', 'SP', -20.0296, -49.4),
  (3536703, 'Pederneiras', 'SP', -22.3511, -48.7781),
  (3536802, 'Pedra Bela', 'SP', -22.7902, -46.4455),
  (3536901, 'Pedranópolis', 'SP', -20.2474, -50.1129),
  (3537008, 'Pedregulho', 'SP', -20.2535, -47.4775),
  (3537107, 'Pedreira', 'SP', -22.7413, -46.8948),
  (3537156, 'Pedrinhas Paulista', 'SP', -22.8174, -50.7933),
  (3537206, 'Pedro de Toledo', 'SP', -24.2764, -47.2354),
  (3537305, 'Penápolis', 'SP', -21.4148, -50.0769),
  (3537404, 'Pereira Barreto', 'SP', -20.6368, -51.1123),
  (3537503, 'Pereiras', 'SP', -23.0804, -47.972),
  (3537602, 'Peruíbe', 'SP', -24.312, -47.0012),
  (3537701, 'Piacatu', 'SP', -21.5921, -50.6003),
  (3537800, 'Piedade', 'SP', -23.7139, -47.4256),
  (3537909, 'Pilar do Sul', 'SP', -23.8077, -47.7222),
  (3538006, 'Pindamonhangaba', 'SP', -22.9246, -45.4613),
  (3538105, 'Pindorama', 'SP', -21.1853, -48.9086),
  (3538204, 'Pinhalzinho', 'SP', -22.7811, -46.5897),
  (3538303, 'Piquerobi', 'SP', -21.8747, -51.7282),
  (3538501, 'Piquete', 'SP', -22.6069, -45.1869),
  (3538600, 'Piracaia', 'SP', -23.0525, -46.3594),
  (3538709, 'Piracicaba', 'SP', -22.7338, -47.6476),
  (3538808, 'Piraju', 'SP', -23.1981, -49.3803),
  (3538907, 'Pirajuí', 'SP', -21.999, -49.4608),
  (3539004, 'Pirangi', 'SP', -21.0886, -48.6607),
  (3539103, 'Pirapora do Bom Jesus', 'SP', -23.3965, -46.9991),
  (3539202, 'Pirapozinho', 'SP', -22.2711, -51.4976),
  (3539301, 'Pirassununga', 'SP', -21.996, -47.4257),
  (3539400, 'Piratininga', 'SP', -22.4142, -49.1339),
  (3539509, 'Pitangueiras', 'SP', -21.0132, -48.221),
  (3539608, 'Planalto', 'SP', -21.0342, -49.933),
  (3539707, 'Platina', 'SP', -22.6371, -50.2104),
  (3539806, 'Poá', 'SP', -23.5333, -46.3473),
  (3539905, 'Poloni', 'SP', -20.7829, -49.8258),
  (3540002, 'Pompéia', 'SP', -22.107, -50.176),
  (3540101, 'Pongaí', 'SP', -21.7396, -49.3604),
  (3540200, 'Pontal', 'SP', -21.0216, -48.0423),
  (3540259, 'Pontalinda', 'SP', -20.4396, -50.5258),
  (3540309, 'Pontes Gestal', 'SP', -20.1727, -49.7064),
  (3540408, 'Populina', 'SP', -19.9453, -50.538),
  (3540507, 'Porangaba', 'SP', -23.1761, -48.1195),
  (3540606, 'Porto Feliz', 'SP', -23.2093, -47.5251),
  (3540705, 'Porto Ferreira', 'SP', -21.8498, -47.487),
  (3540754, 'Potim', 'SP', -22.8343, -45.2552),
  (3540804, 'Potirendaba', 'SP', -21.0428, -49.3815),
  (3540853, 'Pracinha', 'SP', -21.8496, -51.0868),
  (3540903, 'Pradópolis', 'SP', -21.3626, -48.0679),
  (3541000, 'Praia Grande', 'SP', -24.0084, -46.4121),
  (3541059, 'Pratânia', 'SP', -22.8112, -48.6636),
  (3541109, 'Presidente Alves', 'SP', -22.0999, -49.4381),
  (3541208, 'Presidente Bernardes', 'SP', -22.0082, -51.5565),
  (3541307, 'Presidente Epitácio', 'SP', -21.7651, -52.1111),
  (3541406, 'Presidente Prudente', 'SP', -22.1207, -51.3925),
  (3541505, 'Presidente Venceslau', 'SP', -21.8732, -51.8447),
  (3541604, 'Promissão', 'SP', -21.5356, -49.8599),
  (3541653, 'Quadra', 'SP', -23.2993, -48.0547),
  (3541703, 'Quatá', 'SP', -22.2456, -50.6966),
  (3541802, 'Queiroz', 'SP', -21.7969, -50.2415),
  (3541901, 'Queluz', 'SP', -22.5312, -44.7781),
  (3542008, 'Quintana', 'SP', -22.0692, -50.307),
  (3542107, 'Rafard', 'SP', -23.0105, -47.5318),
  (3542206, 'Rancharia', 'SP', -22.2269, -50.893),
  (3542305, 'Redenção da Serra', 'SP', -23.2638, -45.5422),
  (3542404, 'Regente Feijó', 'SP', -22.2181, -51.3055),
  (3542503, 'Reginópolis', 'SP', -21.8914, -49.2268),
  (3542602, 'Registro', 'SP', -24.4979, -47.8449),
  (3542701, 'Restinga', 'SP', -20.6056, -47.4833),
  (3542800, 'Ribeira', 'SP', -24.6517, -49.0044),
  (3542909, 'Ribeirão Bonito', 'SP', -22.0685, -48.182),
  (3543006, 'Ribeirão Branco', 'SP', -24.2206, -48.7635),
  (3543105, 'Ribeirão Corrente', 'SP', -20.4579, -47.5904),
  (3543204, 'Ribeirão do Sul', 'SP', -22.789, -49.933),
  (3543238, 'Ribeirão dos Índios', 'SP', -21.8382, -51.6103),
  (3543253, 'Ribeirão Grande', 'SP', -24.1011, -48.3679),
  (3543303, 'Ribeirão Pires', 'SP', -23.7067, -46.4058),
  (3543402, 'Ribeirão Preto', 'SP', -21.1699, -47.8099),
  (3543501, 'Riversul', 'SP', -23.829, -49.429),
  (3543600, 'Rifaina', 'SP', -20.0803, -47.4291),
  (3543709, 'Rincão', 'SP', -21.5894, -48.0728),
  (3543808, 'Rinópolis', 'SP', -21.7284, -50.7239),
  (3543907, 'Rio Claro', 'SP', -22.3984, -47.5546),
  (3544004, 'Rio das Pedras', 'SP', -22.8417, -47.6047),
  (3544103, 'Rio Grande da Serra', 'SP', -23.7437, -46.3971),
  (3544202, 'Riolândia', 'SP', -19.9868, -49.6836),
  (3544251, 'Rosana', 'SP', -22.5782, -53.0603),
  (3544301, 'Roseira', 'SP', -22.8938, -45.307),
  (3544400, 'Rubiácea', 'SP', -21.3006, -50.7296),
  (3544509, 'Rubinéia', 'SP', -20.1759, -51.007),
  (3544608, 'Sabino', 'SP', -21.4593, -49.5755),
  (3544707, 'Sagres', 'SP', -21.8823, -50.9594),
  (3544806, 'Sales', 'SP', -21.3427, -49.4897),
  (3544905, 'Sales Oliveira', 'SP', -20.7696, -47.8369),
  (3545001, 'Salesópolis', 'SP', -23.5288, -45.8465),
  (3545100, 'Salmourão', 'SP', -21.6267, -50.8614),
  (3545159, 'Saltinho', 'SP', -22.8442, -47.6754),
  (3545209, 'Salto', 'SP', -23.1996, -47.2931),
  (3545308, 'Salto de Pirapora', 'SP', -23.6474, -47.5743),
  (3545407, 'Salto Grande', 'SP', -22.8894, -49.9831),
  (3545506, 'Sandovalina', 'SP', -22.4551, -51.7648),
  (3545605, 'Santa Adélia', 'SP', -21.2427, -48.8063),
  (3545704, 'Santa Albertina', 'SP', -20.0311, -50.7297),
  (3545803, 'Santa Bárbara d''Oeste', 'SP', -22.7553, -47.4143),
  (3546009, 'Santa Branca', 'SP', -23.3933, -45.8875),
  (3546108, 'Santa Clara d''Oeste', 'SP', -20.09, -50.9491),
  (3546207, 'Santa Cruz da Conceição', 'SP', -22.1405, -47.4512),
  (3546256, 'Santa Cruz da Esperança', 'SP', -21.2951, -47.4304),
  (3546306, 'Santa Cruz das Palmeiras', 'SP', -21.8235, -47.248),
  (3546405, 'Santa Cruz do Rio Pardo', 'SP', -22.8988, -49.6354),
  (3546504, 'Santa Ernestina', 'SP', -21.4618, -48.3953),
  (3546603, 'Santa Fé do Sul', 'SP', -20.2083, -50.932),
  (3546702, 'Santa Gertrudes', 'SP', -22.4572, -47.5272),
  (3546801, 'Santa Isabel', 'SP', -23.3172, -46.2237),
  (3546900, 'Santa Lúcia', 'SP', -21.685, -48.0885),
  (3547007, 'Santa Maria da Serra', 'SP', -22.5661, -48.1593),
  (3547106, 'Santa Mercedes', 'SP', -21.3495, -51.7564),
  (3547205, 'Santana da Ponte Pensa', 'SP', -20.2523, -50.8014),
  (3547304, 'Santana de Parnaíba', 'SP', -23.4439, -46.9178),
  (3547403, 'Santa Rita d''Oeste', 'SP', -20.1414, -50.8358),
  (3547502, 'Santa Rita do Passa Quatro', 'SP', -21.7083, -47.478),
  (3547601, 'Santa Rosa de Viterbo', 'SP', -21.4776, -47.3622),
  (3547650, 'Santa Salete', 'SP', -20.2429, -50.6887),
  (3547700, 'Santo Anastácio', 'SP', -21.9747, -51.6527),
  (3547809, 'Santo André', 'SP', -23.6737, -46.5432),
  (3547908, 'Santo Antônio da Alegria', 'SP', -21.0864, -47.1464),
  (3548005, 'Santo Antônio de Posse', 'SP', -22.6029, -46.9192),
  (3548054, 'Santo Antônio do Aracanguá', 'SP', -20.9331, -50.498),
  (3548104, 'Santo Antônio do Jardim', 'SP', -22.1121, -46.6845),
  (3548203, 'Santo Antônio do Pinhal', 'SP', -22.827, -45.663),
  (3548302, 'Santo Expedito', 'SP', -21.8467, -51.3929),
  (3548401, 'Santópolis do Aguapeí', 'SP', -21.6376, -50.5044),
  (3548500, 'Santos', 'SP', -23.9535, -46.335),
  (3548609, 'São Bento do Sapucaí', 'SP', -22.6837, -45.7287),
  (3548708, 'São Bernardo do Campo', 'SP', -23.6914, -46.5646),
  (3548807, 'São Caetano do Sul', 'SP', -23.6229, -46.5548),
  (3548906, 'São Carlos', 'SP', -22.0174, -47.886),
  (3549003, 'São Francisco', 'SP', -20.3623, -50.6952),
  (3549102, 'São João da Boa Vista', 'SP', -21.9707, -46.7944),
  (3549201, 'São João das Duas Pontes', 'SP', -20.3879, -50.3792),
  (3549250, 'São João de Iracema', 'SP', -20.5111, -50.3561),
  (3549300, 'São João do Pau d''Alho', 'SP', -21.2662, -51.6672),
  (3549409, 'São Joaquim da Barra', 'SP', -20.5812, -47.8593),
  (3549508, 'São José da Bela Vista', 'SP', -20.5935, -47.6424),
  (3549607, 'São José do Barreiro', 'SP', -22.6414, -44.5774),
  (3549706, 'São José do Rio Pardo', 'SP', -21.5953, -46.8873),
  (3549805, 'São José do Rio Preto', 'SP', -20.8113, -49.3758),
  (3549904, 'São José dos Campos', 'SP', -23.1896, -45.8841),
  (3549953, 'São Lourenço da Serra', 'SP', -23.8491, -46.9432),
  (3550001, 'São Luiz do Paraitinga', 'SP', -23.222, -45.3109),
  (3550100, 'São Manuel', 'SP', -22.7321, -48.5723),
  (3550209, 'São Miguel Arcanjo', 'SP', -23.8782, -47.9935),
  (3550308, 'São Paulo', 'SP', -23.5329, -46.6395),
  (3550407, 'São Pedro', 'SP', -22.5483, -47.9096),
  (3550506, 'São Pedro do Turvo', 'SP', -22.7453, -49.7428),
  (3550605, 'São Roque', 'SP', -23.5226, -47.1357),
  (3550704, 'São Sebastião', 'SP', -23.7951, -45.4143),
  (3550803, 'São Sebastião da Grama', 'SP', -21.7041, -46.8208),
  (3550902, 'São Simão', 'SP', -21.4732, -47.5518),
  (3551009, 'São Vicente', 'SP', -23.9574, -46.3883),
  (3551108, 'Sarapuí', 'SP', -23.6397, -47.8249),
  (3551207, 'Sarutaiá', 'SP', -23.2721, -49.4763),
  (3551306, 'Sebastianópolis do Sul', 'SP', -20.6523, -49.925),
  (3551405, 'Serra Azul', 'SP', -21.3074, -47.5602),
  (3551504, 'Serrana', 'SP', -21.2043, -47.5952),
  (3551603, 'Serra Negra', 'SP', -22.6139, -46.7033),
  (3551702, 'Sertãozinho', 'SP', -21.1316, -47.9875),
  (3551801, 'Sete Barras', 'SP', -24.382, -47.9279),
  (3551900, 'Severínia', 'SP', -20.8108, -48.8054),
  (3552007, 'Silveiras', 'SP', -22.6638, -44.8522),
  (3552106, 'Socorro', 'SP', -22.5903, -46.5251),
  (3552205, 'Sorocaba', 'SP', -23.4969, -47.4451),
  (3552304, 'Sud Mennucci', 'SP', -20.6872, -50.9238),
  (3552403, 'Sumaré', 'SP', -22.8204, -47.2728),
  (3552502, 'Suzano', 'SP', -23.5448, -46.3112),
  (3552551, 'Suzanápolis', 'SP', -20.4981, -51.0268),
  (3552601, 'Tabapuã', 'SP', -20.9602, -49.0307),
  (3552700, 'Tabatinga', 'SP', -21.7239, -48.6896),
  (3552809, 'Taboão da Serra', 'SP', -23.6019, -46.7526),
  (3552908, 'Taciba', 'SP', -22.3866, -51.2882),
  (3553005, 'Taguaí', 'SP', -23.4452, -49.4024),
  (3553104, 'Taiaçu', 'SP', -21.1431, -48.5112),
  (3553203, 'Taiúva', 'SP', -21.1223, -48.4528),
  (3553302, 'Tambaú', 'SP', -21.7029, -47.2703),
  (3553401, 'Tanabi', 'SP', -20.6228, -49.6563),
  (3553500, 'Tapiraí', 'SP', -23.9612, -47.5062),
  (3553609, 'Tapiratiba', 'SP', -21.4713, -46.7448),
  (3553658, 'Taquaral', 'SP', -21.0737, -48.4126),
  (3553708, 'Taquaritinga', 'SP', -21.4049, -48.5103),
  (3553807, 'Taquarituba', 'SP', -23.5307, -49.241),
  (3553856, 'Taquarivaí', 'SP', -23.9211, -48.6948),
  (3553906, 'Tarabai', 'SP', -22.3016, -51.5621),
  (3553955, 'Tarumã', 'SP', -22.7429, -50.5786),
  (3554003, 'Tatuí', 'SP', -23.3487, -47.8461),
  (3554102, 'Taubaté', 'SP', -23.0104, -45.5593),
  (3554201, 'Tejupá', 'SP', -23.3425, -49.3722),
  (3554300, 'Teodoro Sampaio', 'SP', -22.5299, -52.1682),
  (3554409, 'Terra Roxa', 'SP', -20.787, -48.3314),
  (3554508, 'Tietê', 'SP', -23.1101, -47.7164),
  (3554607, 'Timburi', 'SP', -23.2057, -49.6096),
  (3554656, 'Torre de Pedra', 'SP', -23.2462, -48.1955),
  (3554706, 'Torrinha', 'SP', -22.4237, -48.1731),
  (3554755, 'Trabiju', 'SP', -22.0388, -48.3342),
  (3554805, 'Tremembé', 'SP', -22.9571, -45.5475),
  (3554904, 'Três Fronteiras', 'SP', -20.2344, -50.8905),
  (3554953, 'Tuiuti', 'SP', -22.8193, -46.6937),
  (3555000, 'Tupã', 'SP', -21.9335, -50.5191),
  (3555109, 'Tupi Paulista', 'SP', -21.3825, -51.575),
  (3555208, 'Turiúba', 'SP', -20.9428, -50.1135),
  (3555307, 'Turmalina', 'SP', -20.0486, -50.4792),
  (3555356, 'Ubarana', 'SP', -21.165, -49.7198),
  (3555406, 'Ubatuba', 'SP', -23.4332, -45.0834),
  (3555505, 'Ubirajara', 'SP', -22.5272, -49.6613),
  (3555604, 'Uchoa', 'SP', -20.9511, -49.1713),
  (3555703, 'União Paulista', 'SP', -20.8862, -49.9025),
  (3555802, 'Urânia', 'SP', -20.2455, -50.6455),
  (3555901, 'Uru', 'SP', -21.7866, -49.2848),
  (3556008, 'Urupês', 'SP', -21.2032, -49.2931),
  (3556107, 'Valentim Gentil', 'SP', -20.4217, -50.0889),
  (3556206, 'Valinhos', 'SP', -22.9698, -46.9974),
  (3556305, 'Valparaíso', 'SP', -21.2229, -50.8699),
  (3556354, 'Vargem', 'SP', -22.887, -46.4124),
  (3556404, 'Vargem Grande do Sul', 'SP', -21.8322, -46.8913),
  (3556453, 'Vargem Grande Paulista', 'SP', -23.5993, -47.022),
  (3556503, 'Várzea Paulista', 'SP', -23.2136, -46.8234),
  (3556602, 'Vera Cruz', 'SP', -22.2183, -49.8207),
  (3556701, 'Vinhedo', 'SP', -23.0302, -46.9833),
  (3556800, 'Viradouro', 'SP', -20.8734, -48.293),
  (3556909, 'Vista Alegre do Alto', 'SP', -21.1692, -48.6284),
  (3556958, 'Vitória Brasil', 'SP', -20.1956, -50.4875),
  (3557006, 'Votorantim', 'SP', -23.5446, -47.4388),
  (3557105, 'Votuporanga', 'SP', -20.4237, -49.9781),
  (3557154, 'Zacarias', 'SP', -21.0506, -50.0552),
  (3557204, 'Chavantes', 'SP', -23.0366, -49.7096),
  (3557303, 'Estiva Gerbi', 'SP', -22.2713, -46.9481);

do $$
begin
  if (select count(*) from private.ibge_municipalities where uf = 'MG') <> 853
     or (select count(*) from private.ibge_municipalities where uf = 'SP') <> 645 then
    raise exception 'Base IBGE incompleta.';
  end if;
end $$;


-- ===================== supabase/migrations/0010_multicidades_raio.sql =====================
-- 0010_multicidades_raio: multicidades por raio geográfico a partir da sede (Itaú de Minas/MG).
--
--  * Cidades identificadas pelo código IBGE (único) e com situação planejada | ativa | suspensa.
--    `is_active` continua existindo (compatibilidade com políticas, funções e o app) e é mantida
--    em sincronia com `status` por gatilho + CHECK.
--  * Área de atendimento: municípios de MG e SP a até 100 km (Haversine) da sede, calculados sobre
--    a base IBGE da 0009. Nenhuma cidade é digitada à mão.
--  * Itaú de Minas começa ativa; as demais entram como planejadas e são ativadas pelo Master.
--  * Três conceitos distintos, que não se misturam:
--      - área de atendimento (service_radius_km = 100): quais cidades a plataforma pode operar;
--      - raio regional de descoberta (discovery_radius_km = 200): até onde o cliente enxerga
--        cidades ativas próximas à sua;
--      - área de entrega: definida por CADA estabelecimento (businesses.delivery_radius_km), a
--        partir do próprio endereço. Cidade ativa não implica entrega.
--  * Dados existentes: nada é sobrescrito sem validação. Cidades já cadastradas só são vinculadas
--    ao IBGE quando nome + UF correspondem exatamente (sem acento/caixa); coordenadas existentes não
--    são trocadas; situação existente é preservada (ativa continua ativa). Divergências ficam
--    visíveis em public.admin_city_coverage() para o Master decidir.

-- ---------- utilitários ----------
-- Normaliza para busca/comparação: minúsculas, sem acento, espaços colapsados.
create function private.fold(_text text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    -- maiúsculas acentuadas mapeadas explicitamente: lower() não as converte em locale C
    lower(translate(coalesce(_text, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ''’-', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn   ')),
    '\s+', ' ', 'g'))
$$;

-- Distância de grande círculo (Haversine) em km. Raio médio da Terra (IUGG): 6371.0088 km.
create function public.haversine_km(_lat1 double precision, _lng1 double precision,
                                    _lat2 double precision, _lng2 double precision)
returns double precision language sql immutable strict parallel safe set search_path = '' as $$
  select 2 * 6371.0088 * asin(least(1.0, sqrt(
           power(sin(radians(_lat2 - _lat1) / 2), 2)
           + cos(radians(_lat1)) * cos(radians(_lat2)) * power(sin(radians(_lng2 - _lng1) / 2), 2))))
$$;

-- ---------- configuração regional (linha única) ----------
create table public.regional_settings (
  id boolean primary key default true check (id),
  hq_ibge_code integer not null references private.ibge_municipalities(code),
  service_radius_km numeric(6,1) not null check (service_radius_km > 0 and service_radius_km <= 500),
  discovery_radius_km numeric(6,1) not null check (discovery_radius_km > 0 and discovery_radius_km <= 1000),
  eligible_states text[] not null check (cardinality(eligible_states) between 1 and 27
                                         and eligible_states <@ array['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']),
  updated_at timestamptz not null default now(),
  check (discovery_radius_km >= service_radius_km)
);
comment on table public.regional_settings is
  'Sede, área de atendimento (cidades operáveis) e raio regional de descoberta. A área de entrega é de cada estabelecimento.';
create index regional_settings_hq_idx on public.regional_settings(hq_ibge_code);
insert into public.regional_settings (hq_ibge_code, service_radius_km, discovery_radius_km, eligible_states)
values (3133758, 100, 200, array['MG','SP']);

alter table public.regional_settings enable row level security;
create policy regional_settings_select on public.regional_settings for select to anon, authenticated using (true);
revoke all on public.regional_settings from public, anon, authenticated;
grant select on public.regional_settings to anon, authenticated;

-- Municípios da base IBGE elegíveis pela configuração atual (UF permitida e distância <= raio).
create function private.eligible_municipalities()
returns table (code integer, name text, uf text, lat numeric, lng numeric, distance_km numeric)
language sql stable security definer set search_path = '' as $$
  select m.code, m.name, m.uf, m.lat, m.lng, d.km
    from public.regional_settings s
    join private.ibge_municipalities hq on hq.code = s.hq_ibge_code
    join private.ibge_municipalities m on m.uf = any(s.eligible_states)
    cross join lateral (select round(public.haversine_km(hq.lat::float8, hq.lng::float8,
                                                          m.lat::float8, m.lng::float8)::numeric, 1) as km) d
   where public.haversine_km(hq.lat::float8, hq.lng::float8, m.lat::float8, m.lng::float8) <= s.service_radius_km
$$;

-- Distância da sede para um código IBGE (null se fora da base).
create function private.distance_from_hq(_ibge integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(public.haversine_km(hq.lat::float8, hq.lng::float8, m.lat::float8, m.lng::float8)::numeric, 1)
    from public.regional_settings s
    join private.ibge_municipalities hq on hq.code = s.hq_ibge_code
    join private.ibge_municipalities m on m.code = _ibge
$$;

-- ---------- cidades: IBGE + situação ----------
create type public.city_status as enum ('planned', 'active', 'suspended');

alter table public.cities
  add column ibge_code integer unique check (ibge_code between 1100000 and 5399999),
  add column status public.city_status,
  add column distance_from_hq_km numeric(6,1) check (distance_from_hq_km >= 0),
  add column status_changed_at timestamptz,
  add column search_name text generated always as (private.fold(name)) stored;
comment on column public.cities.ibge_code is 'Código IBGE do município (identificador único da cidade).';
comment on column public.cities.distance_from_hq_km is 'Distância Haversine entre a sede municipal (IBGE) e a sede da plataforma.';

-- Situação inicial das cidades já existentes, sem perder informação:
-- ativa -> active; inativa que já teve estabelecimento -> suspended; inativa sem nenhum -> planned.
update public.cities c
   set status = case
                  when c.is_active then 'active'::public.city_status
                  when exists (select 1 from public.businesses b where b.city_id = c.id) then 'suspended'::public.city_status
                  else 'planned'::public.city_status
                end;
alter table public.cities alter column status set not null;

-- status é a fonte de verdade; is_active acompanha (escritas antigas em is_active continuam válidas).
create function private.cities_status_sync() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status is null then
      new.status := case when coalesce(new.is_active, true) then 'active' else 'planned' end;
    end if;
  elsif new.status is distinct from old.status then
    null; -- status mudou: prevalece
  elsif new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'active' else 'suspended' end;
  end if;
  new.is_active := (new.status = 'active');
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  if new.ibge_code is not null and (tg_op = 'INSERT' or new.ibge_code is distinct from old.ibge_code) then
    new.distance_from_hq_km := private.distance_from_hq(new.ibge_code);
  end if;
  return new;
end $$;
revoke all on function private.cities_status_sync() from public, anon, authenticated;
create trigger cities_status_sync before insert or update on public.cities
  for each row execute function private.cities_status_sync();

-- Um código IBGE só pode ser vinculado a uma cidade de mesmo nome e UF na base oficial.
create function private.cities_ibge_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if new.ibge_code is null then return new; end if;
  select * into m from private.ibge_municipalities where code = new.ibge_code;
  if not found then
    raise exception 'Código IBGE % não está na base de referência.', new.ibge_code using errcode = 'P0001';
  end if;
  if m.uf <> new.state or private.fold(m.name) <> private.fold(new.name) then
    raise exception 'Código IBGE % pertence a %/%, não a %/%.', new.ibge_code, m.name, m.uf, new.name, new.state
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.cities_ibge_guard() from public, anon, authenticated;
create trigger cities_ibge_guard before insert or update of ibge_code, name, state on public.cities
  for each row execute function private.cities_ibge_guard();

alter table public.cities add constraint cities_status_active_sync check (is_active = (status = 'active'));
create index cities_status_state_idx on public.cities(status, state);
create index cities_search_name_idx on public.cities(search_name text_pattern_ops);

-- ---------- reconciliação das cidades existentes com o IBGE ----------
-- Só vincula correspondência exata de nome + UF; coordenadas existentes são mantidas.
update public.cities c
   set ibge_code = m.code
  from private.ibge_municipalities m
 where c.ibge_code is null and not c.is_demo
   and m.uf = c.state and private.fold(m.name) = private.fold(c.name)
   and not exists (select 1 from public.cities o where o.ibge_code = m.code);
-- Coordenadas só onde estavam vazias.
update public.cities c
   set center_lat = m.lat, center_lng = m.lng
  from private.ibge_municipalities m
 where c.ibge_code = m.code and c.center_lat is null and c.center_lng is null;

-- ---------- carga dos municípios elegíveis (planejados, sem duplicatas) ----------
do $$
declare conflict text;
begin
  -- uma cidade não vinculada com o mesmo slug de um município elegível exigiria decisão humana
  select string_agg(c.name || '/' || c.state, ', ') into conflict
    from private.eligible_municipalities() e
    join public.cities c on c.slug = private.slugify(e.name || '-' || e.uf)
   where c.ibge_code is distinct from e.code;
  if conflict is not null then
    raise exception 'Cidades existentes conflitam com municípios elegíveis (revise antes de aplicar): %', conflict;
  end if;
end $$;

insert into public.cities (name, state, slug, center_lat, center_lng, ibge_code, status)
select e.name, e.uf, private.slugify(e.name || '-' || e.uf), e.lat, e.lng, e.code, 'planned'
  from private.eligible_municipalities() e
 where not exists (select 1 from public.cities c where c.ibge_code = e.code)
on conflict (ibge_code) do nothing;

-- Itaú de Minas: cidade inicial ativa.
update public.cities set status = 'active' where ibge_code = 3133758 and status <> 'active';

do $$
begin
  if not exists (select 1 from public.cities where ibge_code = 3133758 and status = 'active') then
    raise exception 'Itaú de Minas/MG deveria estar ativa.';
  end if;
end $$;

-- ---------- catálogo público só em cidades ativas ----------
-- Estabelecimento de cidade suspensa/planejada deixa de aparecer (sem cidade: comportamento anterior).
create or replace function public.is_active_business(_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.businesses b
      left join public.cities c on c.id = b.city_id
     where b.id = _b and b.status = 'active' and not b.is_demo
       and (b.city_id is null or c.status = 'active'))
$$;

-- ---------- área de entrega por estabelecimento ----------
alter table public.businesses
  add column delivery_radius_km numeric(5,1) check (delivery_radius_km is null or (delivery_radius_km > 0 and delivery_radius_km <= 100));
comment on column public.businesses.delivery_radius_km is
  'Área efetiva de entrega a partir do endereço do estabelecimento (lat/lng). Independente do raio regional de descoberta.';
grant update (delivery_radius_km) on public.businesses to authenticated;

create or replace view public.public_businesses with (security_barrier = true) as
  select b.id, b.name, b.slug, b.status, b.business_type, b.category_id, b.city_id,
         b.description, b.cover_url, b.logo_url, b.address_line, b.phone, b.whatsapp,
         b.lat, b.lng, b.distance_estimate_km,
         b.delivery_offer, b.own_delivery_fee_cents, b.accepts_pickup,
         b.estimated_min_minutes, b.estimated_max_minutes, b.min_order_cents, b.price_tier,
         b.rating_avg, b.rating_count, b.popularity_score, b.is_featured,
         b.created_at,
         public.business_is_open(b.id) as is_open,
         b.delivery_radius_km
    from public.businesses b
    left join public.cities c on c.id = b.city_id
   where b.status = 'active' and not b.is_demo
     and (b.city_id is null or c.status = 'active');

-- O estabelecimento entrega neste ponto? Usa SOMENTE a área de entrega dele.
create function public.business_delivers_to(_business uuid, _lat double precision, _lng double precision)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select b.delivery_offer <> 'none'
           and b.delivery_radius_km is not null and b.lat is not null and b.lng is not null
           and public.haversine_km(b.lat::float8, b.lng::float8, _lat, _lng) <= b.delivery_radius_km
      from public.businesses b
     where b.id = _business and public.is_active_business(b.id)), false)
$$;

-- Descoberta regional: cidades ativas a até discovery_radius_km (ou menos) da cidade de origem.
create function public.discover_cities(_origin uuid, _radius_km numeric default null)
returns table (id uuid, name text, state text, slug text, ibge_code integer, distance_km numeric)
language sql stable security definer set search_path = '' as $$
  with o as (
    select c.center_lat::float8 lat, c.center_lng::float8 lng,
           least(coalesce(_radius_km, s.discovery_radius_km), s.discovery_radius_km) as radius
      from public.cities c cross join public.regional_settings s
     where c.id = _origin and c.status = 'active' and not c.is_demo and c.center_lat is not null
  )
  select c.id, c.name, c.state, c.slug, c.ibge_code,
         round(public.haversine_km(o.lat, o.lng, c.center_lat::float8, c.center_lng::float8)::numeric, 1)
    from o join public.cities c on c.status = 'active' and not c.is_demo and c.center_lat is not null
   where public.haversine_km(o.lat, o.lng, c.center_lat::float8, c.center_lng::float8) <= o.radius
   order by 6, c.name
$$;

-- ---------- painel Master ----------
drop function public.admin_list_cities();
create function public.admin_list_cities(
  _search text default null, _state text default null, _status public.city_status default null,
  _max_distance_km numeric default null, _limit int default 100, _offset int default 0
) returns table (id uuid, ibge_code integer, name text, state text, slug text, center_lat numeric, center_lng numeric,
                 status public.city_status, is_active boolean, distance_from_hq_km numeric, businesses_active bigint,
                 status_changed_at timestamptz, created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare q text := private.fold(_search);
begin
  perform private.require_permission('cities.manage');
  return query
    select c.id, c.ibge_code, c.name, c.state, c.slug, c.center_lat, c.center_lng, c.status, c.is_active,
           c.distance_from_hq_km,
           (select count(*) from public.businesses b where b.city_id = c.id and b.status = 'active' and not b.is_demo),
           c.status_changed_at, c.created_at, count(*) over ()
      from public.cities c
     where not c.is_demo
       and (q = '' or c.search_name like '%' || q || '%' or c.ibge_code::text = q)
       and (_state is null or c.state = upper(btrim(_state)))
       and (_status is null or c.status = _status)
       and (_max_distance_km is null or c.distance_from_hq_km <= _max_distance_km)
     order by c.distance_from_hq_km nulls last, c.state, c.name
     limit least(greatest(coalesce(_limit, 100), 1), 500) offset greatest(coalesce(_offset, 0), 0);
end $$;

-- Ativar / planejar / suspender. Ativar exige município IBGE dentro da área de atendimento.
create function public.admin_set_city_status(_city uuid, _status public.city_status, _reason text default null)
returns public.city_status
language plpgsql security definer set search_path = '' as $$
declare
  c public.cities;
  s public.regional_settings;
  reason text := nullif(btrim(coalesce(_reason, '')), '');
begin
  perform private.require_permission('cities.manage');
  perform private.limit_for('admin.city');
  if _status is null then raise exception 'Situação inválida.' using errcode = 'P0001'; end if;
  if char_length(coalesce(reason, '')) > 500 then raise exception 'Motivo muito longo.' using errcode = 'P0001'; end if;
  select * into c from public.cities where id = _city and not is_demo for update;
  if not found then raise exception 'Cidade não encontrada.' using errcode = 'P0001'; end if;
  if c.status = _status then return c.status; end if;
  if _status = 'active' then
    select * into s from public.regional_settings;
    if c.ibge_code is null then
      raise exception 'Vincule a cidade a um código IBGE antes de ativar.' using errcode = 'P0001';
    end if;
    if not (c.state = any(s.eligible_states)) or c.distance_from_hq_km is null
       or c.distance_from_hq_km > s.service_radius_km then
      raise exception 'Cidade fora da área de atendimento (% km da sede, limite % km).',
        c.distance_from_hq_km, s.service_radius_km using errcode = 'P0001';
    end if;
    if c.center_lat is null then
      raise exception 'Cidade sem coordenadas.' using errcode = 'P0001';
    end if;
  elsif _status = 'suspended' and reason is null then
    raise exception 'Informe o motivo da suspensão.' using errcode = 'P0001';
  end if;
  update public.cities set status = _status where id = _city;
  perform private.audit('city.status', 'cities', _city::text,
    jsonb_build_object('ibge_code', c.ibge_code, 'before', c.status, 'after', _status, 'reason', reason));
  return _status;
end $$;

-- Vincula uma cidade antiga (sem IBGE) ao código oficial; preenche coordenadas se vazias.
create function public.admin_link_city_ibge(_city uuid, _ibge_code integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cities;
begin
  perform private.require_permission('cities.manage');
  perform private.limit_for('admin.city');
  select * into c from public.cities where id = _city and not is_demo for update;
  if not found then raise exception 'Cidade não encontrada.' using errcode = 'P0001'; end if;
  if c.ibge_code is not null then raise exception 'Cidade já vinculada ao IBGE.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.cities where ibge_code = _ibge_code) then
    raise exception 'Este código IBGE já pertence a outra cidade.' using errcode = '23505';
  end if;
  update public.cities x
     set ibge_code = _ibge_code,
         center_lat = coalesce(x.center_lat, m.lat), center_lng = coalesce(x.center_lng, m.lng)
    from private.ibge_municipalities m
   where x.id = _city and m.code = _ibge_code;
  perform private.audit('city.link_ibge', 'cities', _city::text, jsonb_build_object('ibge_code', _ibge_code));
end $$;

-- Cadastra (como planejadas) os municípios elegíveis que ainda faltam. Idempotente.
create function public.admin_sync_eligible_cities() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.require_permission('cities.manage');
  perform private.limit_for('admin.city');
  insert into public.cities (name, state, slug, center_lat, center_lng, ibge_code, status)
  select e.name, e.uf, private.slugify(e.name || '-' || e.uf), e.lat, e.lng, e.code, 'planned'
    from private.eligible_municipalities() e
   where not exists (select 1 from public.cities c where c.ibge_code = e.code)
     and not exists (select 1 from public.cities c where c.slug = private.slugify(e.name || '-' || e.uf))
  on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then perform private.audit('city.sync_ibge', 'cities', null, jsonb_build_object('inserted', n)); end if;
  return n;
end $$;

-- Diagnóstico de cobertura para o Master (nada é alterado).
create function public.admin_city_coverage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.regional_settings;
begin
  perform private.require_permission('cities.manage');
  select * into s from public.regional_settings;
  return jsonb_build_object(
    'hq', (select jsonb_build_object('ibge_code', m.code, 'name', m.name, 'state', m.uf)
             from private.ibge_municipalities m where m.code = s.hq_ibge_code),
    'service_radius_km', s.service_radius_km,
    'discovery_radius_km', s.discovery_radius_km,
    'eligible_states', to_jsonb(s.eligible_states),
    'reference_total', (select count(*) from private.ibge_municipalities where uf = any(s.eligible_states)),
    'eligible_total', (select count(*) from private.eligible_municipalities()),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                    from (select status, count(*) n from public.cities where not is_demo group by status) x),
    'missing_eligible', (select coalesce(jsonb_agg(jsonb_build_object('ibge_code', e.code, 'name', e.name, 'state', e.uf,
                                                                      'distance_km', e.distance_km) order by e.distance_km), '[]'::jsonb)
                           from private.eligible_municipalities() e
                          where not exists (select 1 from public.cities c where c.ibge_code = e.code)),
    'without_ibge', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'state', c.state,
                                                                  'status', c.status) order by c.state, c.name), '[]'::jsonb)
                       from public.cities c where c.ibge_code is null and not c.is_demo),
    'outside_area', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'state', c.state,
                                                                  'status', c.status, 'distance_km', c.distance_from_hq_km)
                                               order by c.distance_from_hq_km), '[]'::jsonb)
                       from public.cities c
                      where not c.is_demo and c.ibge_code is not null
                        and (c.distance_from_hq_km > s.service_radius_km or not (c.state = any(s.eligible_states)))),
    'coordinates_divergent', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'state', c.state,
                                                                           'offset_km', round(public.haversine_km(
                                                                             c.center_lat::float8, c.center_lng::float8,
                                                                             m.lat::float8, m.lng::float8)::numeric, 1))), '[]'::jsonb)
                                from public.cities c join private.ibge_municipalities m on m.code = c.ibge_code
                               where c.center_lat is not null
                                 and public.haversine_km(c.center_lat::float8, c.center_lng::float8, m.lat::float8, m.lng::float8) > 5));
end $$;

-- Criação/edição livre de cidades deixa de existir: cidades vêm da base IBGE.
drop function public.admin_save_city(uuid, text, text, numeric, numeric, boolean);
drop function private.admin_save_city_impl(uuid, text, text, numeric, numeric, boolean);

-- ---------- privilégios ----------
revoke all on function private.fold(text) from public, anon, authenticated;
revoke all on function private.eligible_municipalities() from public, anon, authenticated;
revoke all on function private.distance_from_hq(integer) from public, anon, authenticated;

revoke all on function public.haversine_km(double precision, double precision, double precision, double precision) from public;
grant execute on function public.haversine_km(double precision, double precision, double precision, double precision) to anon, authenticated;
revoke all on function public.discover_cities(uuid, numeric) from public;
grant execute on function public.discover_cities(uuid, numeric) to anon, authenticated;
revoke all on function public.business_delivers_to(uuid, double precision, double precision) from public;
grant execute on function public.business_delivers_to(uuid, double precision, double precision) to anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_list_cities(text, text, public.city_status, numeric, int, int)',
    'public.admin_set_city_status(uuid, public.city_status, text)',
    'public.admin_link_city_ibge(uuid, integer)',
    'public.admin_sync_eligible_cities()',
    'public.admin_city_coverage()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
