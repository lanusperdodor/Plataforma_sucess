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
