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
