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
