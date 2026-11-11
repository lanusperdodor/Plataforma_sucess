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
