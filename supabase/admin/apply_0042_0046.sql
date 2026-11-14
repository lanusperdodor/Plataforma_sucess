-- =====================================================================================
-- TUCAÍ — ATUALIZAÇÃO (migrations 0042 a 0046) PARA O SQL EDITOR DO SUPABASE
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

-- ===================== supabase/migrations/0042_endereco_estruturado.sql =====================
do $tucai_0042$
begin
  if exists (select 1 from private.tucai_migrations where version = '0042') then
    raise notice 'Tucaí 0042: já aplicada';
  else
    execute $tucai_sql$
-- 0042: endereço em campos separados (CEP, rua, número, complemento, bairro, cidade, UF) para loja, cliente e entregador.
-- As partes ficam em jsonb validado; o texto antigo (address_line / delivery_address) continua sendo o que as telas mostram.
-- Na loja, o texto é montado pelo banco a partir das partes (não dá para gravar um e outro diferentes).

create or replace function public.address_parts_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and (select coalesce(bool_and(k in ('cep', 'street', 'number', 'complement', 'district', 'city', 'uf')), true) from jsonb_object_keys(p) k)
    and coalesce(p->>'cep', '') ~ '^[0-9]{8}$'
    and char_length(btrim(coalesce(p->>'street', ''))) between 2 and 120
    and char_length(btrim(coalesce(p->>'number', ''))) between 1 and 20
    and char_length(coalesce(p->>'complement', '')) <= 60
    and char_length(btrim(coalesce(p->>'district', ''))) between 2 and 80
    and char_length(btrim(coalesce(p->>'city', ''))) between 2 and 80
    and coalesce(p->>'uf', '') in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
    and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) <> 'string' or e.value::text ~ '[<>]')
  )
$$;

-- "Rua A, 10, Apto 2 - Centro - Itaú de Minas/MG, CEP 37975-000"
create or replace function public.format_address_parts(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then null else
    concat_ws(' - ',
      nullif(concat_ws(', ', nullif(btrim(p->>'street'), ''), nullif(btrim(p->>'number'), ''), nullif(btrim(p->>'complement'), '')), ''),
      nullif(btrim(p->>'district'), ''),
      nullif(concat_ws('/', nullif(btrim(p->>'city'), ''), nullif(p->>'uf', '')), ''))
    || ', CEP ' || substr(p->>'cep', 1, 5) || '-' || substr(p->>'cep', 6, 3)
  end
$$;

-- ---------- loja ----------
alter table public.businesses add column if not exists address_parts jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_address_parts_ok') then
    alter table public.businesses add constraint businesses_address_parts_ok check (public.address_parts_ok(address_parts));
  end if;
end $$;
create or replace function private.businesses_address_compose() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.address_parts is not null and (tg_op = 'INSERT' or new.address_parts is distinct from old.address_parts) then
    new.address_line := left(public.format_address_parts(new.address_parts), 200);
  end if;
  return new;
end $$;
drop trigger if exists businesses_address_compose on public.businesses;
create trigger businesses_address_compose before insert or update on public.businesses
  for each row execute function private.businesses_address_compose();
grant update (address_parts) on public.businesses to authenticated;

-- ---------- cliente (endereço salvo para o próximo pedido) ----------
alter table public.profiles add column if not exists address_parts jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_address_parts_ok') then
    alter table public.profiles add constraint profiles_address_parts_ok check (public.address_parts_ok(address_parts));
  end if;
end $$;
grant update (address_parts) on public.profiles to authenticated;

-- ---------- entregador ----------
alter table public.couriers add column if not exists address_parts jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'couriers_address_parts_ok') then
    alter table public.couriers add constraint couriers_address_parts_ok check (public.address_parts_ok(address_parts));
  end if;
end $$;

-- o entregador grava o próprio endereço (a tabela não tem UPDATE direto para ele)
create or replace function public.courier_set_address(_parts jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if _parts is null or not public.address_parts_ok(_parts) then raise exception 'Endereço incompleto ou inválido.' using errcode = 'P0001'; end if;
  update public.couriers set address_parts = _parts where user_id = auth.uid();
  if not found then raise exception 'Faça o cadastro de entregador primeiro.' using errcode = 'P0001'; end if;
end $$;

-- o Master (quem revisa entregadores) vê o endereço de um entregador
create or replace function public.admin_courier_address(_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb;
begin
  perform private.require_permission('couriers.review');
  select c.address_parts into p from public.couriers c where c.user_id = _user;
  return jsonb_build_object('parts', p, 'text', public.format_address_parts(p));
end $$;

do $$ begin
  -- funções puras (sem dados): usadas nas restrições CHECK, que rodam com o papel de quem grava
  grant execute on function public.address_parts_ok(jsonb) to anon, authenticated;
  grant execute on function public.format_address_parts(jsonb) to anon, authenticated;
  revoke all on function public.courier_set_address(jsonb) from public, anon;
  grant execute on function public.courier_set_address(jsonb) to authenticated;
  revoke all on function public.admin_courier_address(uuid) from public, anon;
  grant execute on function public.admin_courier_address(uuid) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0042', '0042_endereco_estruturado.sql', 'applied');
    raise notice 'Tucaí 0042: aplicada agora';
  end if;
end $tucai_0042$;

-- ===================== supabase/migrations/0043_tucai_sempre_recebe.sql =====================
do $tucai_0043$
begin
  if exists (select 1 from private.tucai_migrations where version = '0043') then
    raise notice 'Tucaí 0043: já aplicada';
  else
    execute $tucai_sql$
-- 0043: a Tucaí recebe a sua taxa (R$ 1) em TODA corrida parceira. Regra aprovada pelo responsável:
--   entregador = (o que o cliente paga + o que a loja paga) − taxa da Tucaí.
-- Ex.: 3 a 5 km → cliente R$ 5 + loja R$ 2 = R$ 7 − R$ 1 da Tucaí = R$ 6 ao entregador. Sem subsídio.
-- Pedidos já feitos não mudam (cada pedido guarda os próprios valores).

-- 1) a tabela só é aceita se cliente + loja cobrirem entregador + Tucaí em todas as faixas
create or replace function public.admin_set_delivery_pricing(_bands jsonb, _platform_fee_cents integer, _customer_max_cents integer,
                                                              _merchant_max_cents integer, _require_quote boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare b jsonb; prev int := 0; v int; n int := 0;
begin
  perform private.require_master_mfa();
  perform private.limit_for('admin.finance');
  if jsonb_typeof(_bands) <> 'array' or jsonb_array_length(_bands) not between 1 and 10 then raise exception 'Informe de 1 a 10 faixas.' using errcode = 'P0001'; end if;
  if _platform_fee_cents not between 0 and 2000 or _customer_max_cents not between 0 and 5000 or _merchant_max_cents not between 0 and 5000 then
    raise exception 'Valores fora dos limites.' using errcode = 'P0001';
  end if;
  for b in select * from jsonb_array_elements(_bands) loop
    n := n + 1;
    if (b->>'ate_m') !~ '^[0-9]+$' or (b->>'entregador_cents') !~ '^[0-9]+$' then raise exception 'Faixa inválida.' using errcode = 'P0001'; end if;
    if (b->>'ate_m')::int <= prev or (b->>'ate_m')::int > 50000 then raise exception 'As distâncias das faixas precisam crescer (até 50 km).' using errcode = 'P0001'; end if;
    if (b->>'entregador_cents')::int < 100 or (b->>'entregador_cents')::int > 20000 then raise exception 'Ganho do entregador entre R$ 1 e R$ 200.' using errcode = 'P0001'; end if;
    if (b->>'entregador_cents')::int + _platform_fee_cents > _customer_max_cents + _merchant_max_cents then
      raise exception 'Faixa %: o entregador pode receber no máximo R$ % (cliente R$ % + loja R$ % − Tucaí R$ %). A Tucaí recebe a taxa em toda corrida.',
        n, to_char((_customer_max_cents + _merchant_max_cents - _platform_fee_cents) / 100.0, 'FM999990D00'),
        to_char(_customer_max_cents / 100.0, 'FM999990D00'), to_char(_merchant_max_cents / 100.0, 'FM999990D00'), to_char(_platform_fee_cents / 100.0, 'FM999990D00')
        using errcode = 'P0001';
    end if;
    prev := (b->>'ate_m')::int;
  end loop;
  select coalesce(max(version), 0) + 1 into v from public.delivery_pricing;
  update public.delivery_pricing set is_current = false where is_current;
  insert into public.delivery_pricing(version, bands, platform_fee_cents, customer_max_cents, merchant_max_cents, require_quote, is_current, created_by)
  values (v, _bands, _platform_fee_cents, _customer_max_cents, _merchant_max_cents, coalesce(_require_quote, false), true, auth.uid());
  perform private.audit('finance.delivery_pricing', 'delivery_pricing', v::text,
                        jsonb_build_object('faixas', _bands, 'tucai', _platform_fee_cents, 'cliente_max', _customer_max_cents, 'loja_max', _merchant_max_cents, 'exige_cotacao', _require_quote));
  return v;
end $$;

-- 2) tabela vigente: se ainda é a versão 1 original (5/6/7), vira a versão 2 com 5/6/6. Se o Master já mudou, não mexe.
do $$
declare cur public.delivery_pricing%rowtype; v int;
begin
  select * into cur from public.delivery_pricing where is_current;
  if found and cur.version = 1 and cur.platform_fee_cents = 100 and cur.customer_max_cents = 500 and cur.merchant_max_cents = 200
     and cur.bands = '[{"ate_m":1500,"entregador_cents":500},{"ate_m":3000,"entregador_cents":600},{"ate_m":5000,"entregador_cents":700}]'::jsonb then
    select coalesce(max(version), 0) + 1 into v from public.delivery_pricing;
    update public.delivery_pricing set is_current = false where is_current;
    insert into public.delivery_pricing(version, bands, platform_fee_cents, customer_max_cents, merchant_max_cents, require_quote, is_current, created_by)
    values (v, '[{"ate_m":1500,"entregador_cents":500},{"ate_m":3000,"entregador_cents":600},{"ate_m":5000,"entregador_cents":600}]'::jsonb,
            100, 500, 200, cur.require_quote, true, null);
    perform private.audit('finance.delivery_pricing', 'delivery_pricing', v::text,
      jsonb_build_object('motivo', 'Tucaí recebe R$ 1 em toda corrida: 3 a 5 km passa a R$ 6 ao entregador (cliente 5 + loja 2 − Tucaí 1)', 'origem', 'migração 0043'));
  end if;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0043', '0043_tucai_sempre_recebe.sql', 'applied');
    raise notice 'Tucaí 0043: aplicada agora';
  end if;
end $tucai_0043$;

-- ===================== supabase/migrations/0044_taxa_tucai_por_entrega.sql =====================
do $tucai_0044$
begin
  if exists (select 1 from private.tucai_migrations where version = '0044') then
    raise notice 'Tucaí 0044: já aplicada';
  else
    execute $tucai_sql$
-- 0044: taxa da Tucaí por entrega, padronizada (regra aprovada pelo responsável):
--  * R$ 1 (delivery_pricing.platform_fee_cents) por entrega CONCLUÍDA, com entregador independente ou próprio da loja.
--  * Uma única fonte: a mesma taxa da tabela de frete vale para a entrega própria (antes vinha de outra configuração,
--    também R$ 1 — não muda nenhum valor hoje).
--  * Entregador independente: a taxa não sai do ganho dele (entregador = cliente + loja − Tucaí, 0043).
--  * Entregador próprio: a loja paga a taxa; a remuneração dele é a combinada com a loja (a Tucaí não aplica as faixas).
--  * Frete grátis: a loja assume a corrida inteira, com a taxa incluída (0040).
--  * Cobrança só de pedidos entregues, uma vez por mês por loja (índice único da 0018) — sem lançamento duplicado.
--  * Entregador próprio de qualquer loja não recebe ofertas da rede (só os independentes habilitados).

-- ---------- taxa mínima de R$ 1 na tabela de frete ----------
create or replace function private.delivery_pricing_fee_floor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.platform_fee_cents < 100 then
    raise exception 'A taxa da Tucaí por entrega é de no mínimo R$ 1,00.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists delivery_pricing_fee_floor on public.delivery_pricing;
create trigger delivery_pricing_fee_floor before insert or update of platform_fee_cents on public.delivery_pricing
  for each row execute function private.delivery_pricing_fee_floor();

-- ---------- entrega própria: taxa da Tucaí da tabela vigente; nada da rede independente ----------
create or replace function private.apply_own_delivery_fee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare fee int;
begin
  if new.fulfillment <> 'delivery_own' then return new; end if;
  select p.platform_fee_cents into fee from public.delivery_pricing p where p.is_current;
  if fee is null then return new; end if;   -- sem tabela (instalação antiga): mantém o valor calculado no pedido
  new.platform_delivery_fee_cents := fee;
  -- a loja paga o próprio entregador fora da Tucaí: nenhum valor da rede independente entra no pedido
  new.courier_pay_cents := 0;
  new.merchant_delivery_contribution_cents := 0;
  new.delivery_subsidy_cents := 0;
  new.delivery_band := null;
  return new;
end $$;
revoke all on function private.apply_own_delivery_fee() from public, anon, authenticated;
drop trigger if exists orders_apply_own_delivery_fee on public.orders;
create trigger orders_apply_own_delivery_fee before insert on public.orders for each row execute function private.apply_own_delivery_fee();

-- ---------- ofertas da rede: só entregador independente que NÃO seja entregador próprio de alguma loja ----------
create or replace function private.is_any_own_courier(_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members where user_id = _user and member_role = 'courier_own')
$$;
revoke all on function private.is_any_own_courier(uuid) from public, anon, authenticated;

create or replace function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint, offer_expires_at timestamptz, offer_round smallint,
               order_status public.order_status, city_name text)
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); me_test boolean := private.is_test_user(c.user_id);
begin
  if not c.is_online then return; end if;
  -- entregador próprio de uma loja recebe só as entregas atribuídas pela loja
  if private.is_any_own_courier(c.user_id) then return; end if;
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

create or replace function public.courier_accept_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int; o public.orders%rowtype;
begin
  perform private.limit_for('delivery.action');
  if private.is_any_own_courier(c.user_id) then
    raise exception 'Entregador próprio de estabelecimento recebe só as entregas atribuídas pela loja.' using errcode = '42501';
  end if;
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

do $$ begin
  revoke all on function public.courier_list_offers() from public, anon;
  grant execute on function public.courier_list_offers() to authenticated;
  revoke all on function public.courier_accept_delivery(uuid) from public, anon;
  grant execute on function public.courier_accept_delivery(uuid) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0044', '0044_taxa_tucai_por_entrega.sql', 'applied');
    raise notice 'Tucaí 0044: aplicada agora';
  end if;
end $tucai_0044$;

-- ===================== supabase/migrations/0045_uploads_midia.sql =====================
do $tucai_0045$
begin
  if exists (select 1 from private.tucai_migrations where version = '0045') then
    raise notice 'Tucaí 0045: já aplicada';
  else
    execute $tucai_sql$
-- 0045: upload de fotos, vídeo e avatar (Supabase Storage), com limites e validação no servidor.
--  Limites (aprovados): avatar 5 MB · imagem 10 MB · até 5 imagens por publicação · vídeo 50 MB e 60 s (1 por publicação).
--  * Storage: um bucket por tipo, com tamanho máximo e tipos permitidos (o próprio Storage recusa o resto).
--    Sem SVG, HTML ou executáveis. Cada pessoa só grava na própria pasta (<id>/arquivo) e só apaga o que é seu.
--  * Publicação: a mídia é anexada por função (nunca insert direto), que confere dono, quantidade, tipo e tamanho
--    REAL do arquivo gravado no Storage. Duração do vídeo: medida no aparelho e conferida aqui (≤ 60 s); o Storage
--    limita o tamanho. Mídia de publicação oculta pela moderação fica oculta junto (mesma regra de leitura do post).
--  * Denúncia: a já existente (content_reports) da publicação; o Master remove a mídia (auditado).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('media.attach', 60, 3600)
on conflict (action) do nothing;

-- ---------- buckets e regras do Storage (só onde o Storage existe) ----------
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Storage ausente: buckets e regras de upload não criados (ambiente local).';
    return;
  end if;
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
    ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
    ('post-images', 'post-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('post-videos', 'post-videos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists tucai_midia_enviar on storage.objects';
  execute $p$create policy tucai_midia_enviar on storage.objects for insert to authenticated with check (
    bucket_id in ('avatars', 'post-images', 'post-videos')
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
    and case bucket_id
          when 'avatars' then name ~* '\.(jpe?g|png|webp)$'
          when 'post-images' then name ~* '\.(jpe?g|png|webp|gif)$'
          else name ~* '\.(mp4|webm|mov)$' end)$p$;
  execute 'drop policy if exists tucai_midia_apagar on storage.objects';
  execute $p$create policy tucai_midia_apagar on storage.objects for delete to authenticated using (
    bucket_id in ('avatars', 'post-images', 'post-videos') and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  -- leitura: buckets públicos (servidos pelo CDN do Storage, em outro domínio); nenhuma regra de UPDATE = arquivo não é trocado
end $$;

-- ---------- mídia das publicações ----------
create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  bucket text not null check (bucket in ('post-images', 'post-videos')),
  path text not null check (char_length(path) <= 200),
  size_bytes integer not null check (size_bytes > 0),
  width integer check (width is null or width between 1 and 10000),
  height integer check (height is null or height between 1 and 10000),
  duration_s numeric(6, 2) check (duration_s is null or duration_s > 0),
  position smallint not null default 0 check (position between 0 and 4),
  created_at timestamptz not null default now(),
  unique (bucket, path),
  check ((kind = 'image') = (bucket = 'post-images')),
  check (kind <> 'image' or size_bytes <= 10485760),
  check (kind <> 'video' or (size_bytes <= 52428800 and duration_s is not null and duration_s <= 60))
);
create index if not exists post_media_post_idx on public.post_media(post_id, position);
create index if not exists post_media_author_idx on public.post_media(author_id);
alter table public.post_media enable row level security;
drop policy if exists post_media_select on public.post_media;
-- vê a mídia quem vê a publicação (inclui a regra de bloqueio e a de moderação dos posts)
create policy post_media_select on public.post_media for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
revoke all on public.post_media from public, anon, authenticated;
grant select on public.post_media to authenticated;   -- como as publicações: só com login

-- anexa até 5 imagens OU 1 vídeo à própria publicação, logo após publicar
create or replace function public.post_attach_media(_post uuid, _items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare p public.posts%rowtype; it jsonb; k text; b text; pth text; sz bigint; mime text; dur numeric; n_img int; n_vid int; i int := 0;
        has_storage boolean := to_regclass('storage.objects') is not null;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('media.attach');
  select * into p from public.posts where id = _post for update;
  if not found or p.author_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p.status <> 'published' then raise exception 'Publicação indisponível.' using errcode = 'P0001'; end if;
  if p.created_at < now() - interval '1 hour' then raise exception 'Anexe as fotos ou o vídeo ao publicar.' using errcode = 'P0001'; end if;
  if jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) not between 1 and 5 then raise exception 'Envie de 1 a 5 arquivos.' using errcode = 'P0001'; end if;
  select count(*) filter (where kind = 'image'), count(*) filter (where kind = 'video') into n_img, n_vid from public.post_media where post_id = _post;
  for it in select * from jsonb_array_elements(_items) loop
    k := it->>'kind';
    pth := it->>'path';
    if k not in ('image', 'video') then raise exception 'Tipo de arquivo inválido.' using errcode = 'P0001'; end if;
    b := case k when 'image' then 'post-images' else 'post-videos' end;
    if pth is null or pth !~ ('^' || auth.uid()::text || case k when 'image' then '/[0-9a-f-]{36}\.(jpe?g|png|webp|gif)$' else '/[0-9a-f-]{36}\.(mp4|webm|mov)$' end) then
      raise exception 'Arquivo inválido.' using errcode = 'P0001';
    end if;
    if k = 'image' then n_img := n_img + 1; else n_vid := n_vid + 1; end if;
    if n_img > 5 then raise exception 'No máximo 5 imagens por publicação.' using errcode = 'P0001'; end if;
    if n_vid > 1 then raise exception 'No máximo 1 vídeo por publicação.' using errcode = 'P0001'; end if;
    if n_vid > 0 and n_img > 0 then raise exception 'Envie fotos ou um vídeo (não os dois juntos).' using errcode = 'P0001'; end if;
    dur := nullif(it->>'duration_s', '')::numeric;
    sz := nullif(it->>'size', '')::bigint;
    if has_storage then
      -- tamanho e tipo REAIS do arquivo gravado (não confia no navegador)
      -- consulta estática (só roda onde o Storage existe; o PL/pgSQL só resolve a tabela ao executar a linha)
      select (o.metadata->>'size')::bigint, o.metadata->>'mimetype' into sz, mime from storage.objects o where o.bucket_id = b and o.name = pth;
      if sz is null then raise exception 'Arquivo não encontrado. Envie de novo.' using errcode = 'P0001'; end if;
      if (k = 'image' and mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif'))
         or (k = 'video' and mime not in ('video/mp4', 'video/webm', 'video/quicktime')) then
        raise exception 'Tipo de arquivo não permitido.' using errcode = 'P0001';
      end if;
    end if;
    if sz is null or sz <= 0 then raise exception 'Arquivo inválido.' using errcode = 'P0001'; end if;
    if k = 'image' and sz > 10485760 then raise exception 'Imagem acima de 10 MB.' using errcode = 'P0001'; end if;
    if k = 'video' and sz > 52428800 then raise exception 'Vídeo acima de 50 MB.' using errcode = 'P0001'; end if;
    if k = 'video' and (dur is null or dur > 60) then raise exception 'Vídeo com até 60 segundos.' using errcode = 'P0001'; end if;
    insert into public.post_media(post_id, author_id, kind, bucket, path, size_bytes, width, height, duration_s, position)
    values (_post, auth.uid(), k, b, pth, sz::int,
            nullif(it->>'width', '')::int, nullif(it->>'height', '')::int, case when k = 'video' then dur end, (n_img + n_vid - 1)::smallint);
    i := i + 1;
  end loop;
  return i;
end $$;

-- moderação: o Master remove uma mídia (a publicação continua; a denúncia segue o fluxo existente)
create or replace function public.admin_remove_post_media(_media uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.post_media%rowtype;
begin
  perform private.require_permission('moderation.manage');
  if char_length(btrim(coalesce(_reason, ''))) < 3 then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  delete from public.post_media where id = _media returning * into m;
  if not found then raise exception 'Mídia não encontrada.' using errcode = 'P0001'; end if;
  -- tira do ar também o endereço público (o Storage passa a responder "não encontrado")
  -- (algumas versões do Storage proíbem apagar direto pela tabela: aí a mídia some da Tucaí e o arquivo fica para a limpeza)
  if to_regclass('storage.objects') is not null then
    begin
      delete from storage.objects o where o.bucket_id = m.bucket and o.name = m.path;
    exception when others then
      raise notice 'Arquivo mantido no Storage para limpeza: %', m.path;
    end;
  end if;
  perform private.audit('moderation.media_removed', 'post_media', _media::text,
                        jsonb_build_object('post', m.post_id, 'author', m.author_id, 'bucket', m.bucket, 'motivo', left(_reason, 300)));
end $$;

-- avatar enviado pela Tucaí: só da própria pasta
create or replace function private.social_avatar_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.avatar_url ~ '/storage/v1/object/public/avatars/' and new.avatar_url !~ ('/storage/v1/object/public/avatars/' || new.user_id::text || '/') then
    raise exception 'Use uma foto enviada por você.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists social_avatar_guard on public.social_profiles;
create trigger social_avatar_guard before insert or update of avatar_url on public.social_profiles
  for each row execute function private.social_avatar_guard();

do $$ begin
  revoke all on function public.post_attach_media(uuid, jsonb) from public, anon;
  grant execute on function public.post_attach_media(uuid, jsonb) to authenticated;
  revoke all on function public.admin_remove_post_media(uuid, text) from public, anon;
  grant execute on function public.admin_remove_post_media(uuid, text) to authenticated;
  revoke all on function private.social_avatar_guard() from public, anon, authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0045', '0045_uploads_midia.sql', 'applied');
    raise notice 'Tucaí 0045: aplicada agora';
  end if;
end $tucai_0045$;

-- ===================== supabase/migrations/0046_navegacao_entregador.sql =====================
do $tucai_0046$
begin
  if exists (select 1 from private.tucai_migrations where version = '0046') then
    raise notice 'Tucaí 0046: já aplicada';
  else
    execute $tucai_sql$
-- 0046: navegação do entregador.
--  * Instruções de conversão da rota (vire à direita em…), guardadas com a rota da etapa e entregues SÓ ao entregador dela.
--  * Ofertas da rede com a distância da entrega (loja → cliente, calculada pelas ruas no servidor, 0040) e o ponto
--    APROXIMADO da loja (≈100 m) para o aparelho estimar a distância até a coleta. Valores financeiros continuam vindo
--    só do servidor; nada aqui muda frete, ganho ou taxa.

alter table public.delivery_routes add column if not exists steps jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'delivery_routes_steps_ok') then
    alter table public.delivery_routes add constraint delivery_routes_steps_ok
      check (steps is null or (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 120));
  end if;
end $$;

-- grava a rota (mesma regra da 0037) + as instruções; a versão sem instruções continua valendo
create or replace function public.route_store(_ticket uuid, _geometry jsonb, _distance_m integer, _duration_s integer, _provider text, _steps jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare t private.route_requests%rowtype; s jsonb; clean jsonb := '[]'::jsonb;
begin
  select * into t from private.route_requests where id = _ticket;
  perform public.route_store(_ticket, _geometry, _distance_m, _duration_s, _provider);
  if _steps is null or jsonb_typeof(_steps) <> 'array' then return; end if;
  -- só os campos esperados, com tamanho limitado (o texto vem do provedor de rotas)
  for s in select * from jsonb_array_elements(_steps) limit 120 loop
    if jsonb_typeof(s) <> 'object' then continue; end if;
    clean := clean || jsonb_build_object(
      'text', left(regexp_replace(coalesce(s->>'text', ''), '[<>]', '', 'g'), 160),
      'type', left(coalesce(s->>'type', 'continue'), 24),
      'distance_m', greatest(0, least(coalesce((s->>'distance_m')::numeric, 0), 200000))::int,
      'at', case when jsonb_typeof(s->'at') = 'array' and jsonb_array_length(s->'at') = 2 then s->'at' else null end);
  end loop;
  update public.delivery_routes set steps = clean where order_id = t.order_id and leg = t.leg;
end $$;

-- instruções da etapa atual, só para o entregador da entrega
create or replace function public.courier_route_steps(_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_leg text := private.tracking_leg(_order, auth.uid()); r public.delivery_routes%rowtype;
begin
  if auth.uid() is null or v_leg is null then raise exception 'Esta entrega não está atribuída a você.' using errcode = '42501'; end if;
  select * into r from public.delivery_routes where order_id = _order and leg = v_leg;
  return jsonb_build_object('leg', v_leg, 'steps', coalesce(r.steps, '[]'::jsonb), 'computed_at', r.computed_at);
end $$;

-- ofertas: + distância da entrega e ponto aproximado da loja
drop function if exists public.courier_list_offers();
create function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint, offer_expires_at timestamptz, offer_round smallint,
               order_status public.order_status, city_name text, delivery_distance_m integer, store_lat numeric, store_lng numeric)
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); me_test boolean := private.is_test_user(c.user_id);
begin
  if not c.is_online then return; end if;
  -- entregador próprio de uma loja recebe só as entregas atribuídas pela loja (0044)
  if private.is_any_own_courier(c.user_id) then return; end if;
  perform private.sweep_deliveries();
  return query
    select d.order_id, b.name, b.address_line, d.courier_pay_cents, d.offered_at,
           nullif(btrim(split_part(o.delivery_address, ',', -1)), ''),
           (select count(*) from public.order_items i where i.order_id = o.id),
           d.offer_expires_at, d.offer_round, o.status, ci.name,
           o.delivery_distance_m, round(b.lat, 3), round(b.lng, 3)
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

do $$ begin
  revoke all on function public.courier_list_offers() from public, anon;
  grant execute on function public.courier_list_offers() to authenticated;
  revoke all on function public.route_store(uuid, jsonb, integer, integer, text, jsonb) from public, anon;
  grant execute on function public.route_store(uuid, jsonb, integer, integer, text, jsonb) to authenticated;
  revoke all on function public.courier_route_steps(uuid) from public, anon;
  grant execute on function public.courier_route_steps(uuid) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0046', '0046_navegacao_entregador.sql', 'applied');
    raise notice 'Tucaí 0046: aplicada agora';
  end if;
end $tucai_0046$;

select version, name, how, applied_at from private.tucai_migrations order by version;
