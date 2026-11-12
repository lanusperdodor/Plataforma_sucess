-- 0034_catalogo_publico: corrige o alerta CRITICAL "Security Definer View" em public.public_businesses.
--  * Antes: a visão rodava com as permissões do dono (ignorava a RLS) para ler public.businesses, que é fechada.
--  * security_invoker direto em businesses não é seguro: visitantes e clientes precisariam ler a tabela inteira
--    (owner_id, review_note, reviewed_by, is_test…), porque privilégios de coluna não distinguem linhas.
--  * Agora: public.business_catalog guarda SÓ as colunas públicas, sincronizada por gatilho a partir de businesses,
--    com RLS (ativos, não demo; de teste só para contas de teste e equipe). A visão public_businesses mantém o mesmo
--    nome e colunas (o app não muda) e passa a ser security_invoker: respeita a RLS de quem consulta.
--  * businesses continua sem acesso para anon e com acesso só de membros/equipe para authenticated (políticas intactas).

create table if not exists public.business_catalog as
  select id, name, slug, status, business_type, category_id, city_id, description, cover_url, logo_url, address_line, phone, whatsapp,
         lat, lng, distance_estimate_km, delivery_offer, own_delivery_fee_cents, accepts_pickup, estimated_min_minutes, estimated_max_minutes,
         min_order_cents, price_tier, rating_avg, rating_count, popularity_score, is_featured, created_at,
         is_demo, is_test   -- usados só no filtro de visibilidade (não aparecem na visão)
    from public.businesses with no data;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_catalog_pkey') then
    alter table public.business_catalog add constraint business_catalog_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_catalog_id_fkey') then
    alter table public.business_catalog add constraint business_catalog_id_fkey foreign key (id) references public.businesses(id) on delete cascade;
  end if;
end $$;
create index if not exists business_catalog_city_type_idx on public.business_catalog(city_id, business_type);
create index if not exists business_catalog_category_idx on public.business_catalog(category_id);
create index if not exists business_catalog_slug_idx on public.business_catalog(slug);

alter table public.business_catalog enable row level security;
drop policy if exists business_catalog_public_select on public.business_catalog;
create policy business_catalog_public_select on public.business_catalog for select to anon, authenticated
  using (status = 'active' and not is_demo and (not is_test or public.viewer_sees_tests()));
-- somente leitura pela API; gravação só pelo gatilho
revoke all on public.business_catalog from public, anon, authenticated;
grant select on public.business_catalog to anon, authenticated;

-- sincronização: toda mudança em businesses reflete no catálogo (exclusão em cascata pela chave estrangeira)
create or replace function private.sync_business_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_catalog as c (id, name, slug, status, business_type, category_id, city_id, description, cover_url, logo_url,
         address_line, phone, whatsapp, lat, lng, distance_estimate_km, delivery_offer, own_delivery_fee_cents, accepts_pickup,
         estimated_min_minutes, estimated_max_minutes, min_order_cents, price_tier, rating_avg, rating_count, popularity_score, is_featured,
         created_at, is_demo, is_test)
  values (new.id, new.name, new.slug, new.status, new.business_type, new.category_id, new.city_id, new.description, new.cover_url, new.logo_url,
          new.address_line, new.phone, new.whatsapp, new.lat, new.lng, new.distance_estimate_km, new.delivery_offer, new.own_delivery_fee_cents,
          new.accepts_pickup, new.estimated_min_minutes, new.estimated_max_minutes, new.min_order_cents, new.price_tier, new.rating_avg,
          new.rating_count, new.popularity_score, new.is_featured, new.created_at, new.is_demo, new.is_test)
  on conflict (id) do update set name = excluded.name, slug = excluded.slug, status = excluded.status, business_type = excluded.business_type,
         category_id = excluded.category_id, city_id = excluded.city_id, description = excluded.description, cover_url = excluded.cover_url,
         logo_url = excluded.logo_url, address_line = excluded.address_line, phone = excluded.phone, whatsapp = excluded.whatsapp,
         lat = excluded.lat, lng = excluded.lng, distance_estimate_km = excluded.distance_estimate_km, delivery_offer = excluded.delivery_offer,
         own_delivery_fee_cents = excluded.own_delivery_fee_cents, accepts_pickup = excluded.accepts_pickup,
         estimated_min_minutes = excluded.estimated_min_minutes, estimated_max_minutes = excluded.estimated_max_minutes,
         min_order_cents = excluded.min_order_cents, price_tier = excluded.price_tier, rating_avg = excluded.rating_avg,
         rating_count = excluded.rating_count, popularity_score = excluded.popularity_score, is_featured = excluded.is_featured,
         created_at = excluded.created_at, is_demo = excluded.is_demo, is_test = excluded.is_test;
  return null;
end $$;
revoke all on function private.sync_business_catalog() from public, anon, authenticated;
drop trigger if exists businesses_sync_catalog on public.businesses;
create trigger businesses_sync_catalog after insert or update on public.businesses
  for each row execute function private.sync_business_catalog();

-- carga inicial (idempotente)
insert into public.business_catalog (id, name, slug, status, business_type, category_id, city_id, description, cover_url, logo_url, address_line,
       phone, whatsapp, lat, lng, distance_estimate_km, delivery_offer, own_delivery_fee_cents, accepts_pickup, estimated_min_minutes,
       estimated_max_minutes, min_order_cents, price_tier, rating_avg, rating_count, popularity_score, is_featured, created_at, is_demo, is_test)
select id, name, slug, status, business_type, category_id, city_id, description, cover_url, logo_url, address_line, phone, whatsapp, lat, lng,
       distance_estimate_km, delivery_offer, own_delivery_fee_cents, accepts_pickup, estimated_min_minutes, estimated_max_minutes, min_order_cents,
       price_tier, rating_avg, rating_count, popularity_score, is_featured, created_at, is_demo, is_test
  from public.businesses
on conflict (id) do nothing;

-- visão pública: mesmo nome e colunas; agora com as permissões de quem consulta (RLS do catálogo vale)
create or replace view public.public_businesses with (security_invoker = true, security_barrier = true) as
  select b.id, b.name, b.slug, b.status, b.business_type, b.category_id, b.city_id,
         b.description, b.cover_url, b.logo_url, b.address_line, b.phone, b.whatsapp,
         b.lat, b.lng, b.distance_estimate_km, b.delivery_offer, b.own_delivery_fee_cents, b.accepts_pickup,
         b.estimated_min_minutes, b.estimated_max_minutes, b.min_order_cents, b.price_tier,
         b.rating_avg, b.rating_count, b.popularity_score, b.is_featured, b.created_at,
         public.business_is_open(b.id) as is_open
    from public.business_catalog b
   where b.status = 'active' and not b.is_demo and (not b.is_test or public.viewer_sees_tests());
revoke all on public.public_businesses from public;
grant select on public.public_businesses to anon, authenticated;
