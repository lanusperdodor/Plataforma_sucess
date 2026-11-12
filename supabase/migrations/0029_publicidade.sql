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
