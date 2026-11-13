-- 0037_rastreamento_mapa: acompanhamento da entrega no mapa com a posição REAL do entregador (docs/RASTREAMENTO.md).
--  * Só a ÚLTIMA posição de cada entrega ativa (uma linha; sem histórico de trajeto). Gravada pelo aparelho do entregador
--    atribuído, com permissão explícita do navegador, a cada ~20 s. Apagada quando a entrega termina, é cancelada ou liberada,
--    e pela varredura quando fica 30 min sem atualização.
--  * Leitura só pela função delivery_tracking(): cliente do pedido, equipe da loja (até a coleta), o próprio entregador e
--    equipe da plataforma com orders.view (auditado). O cliente recebe coordenadas arredondadas (~100 m antes da coleta,
--    ~10 m depois). A tabela de posições não é legível diretamente por ninguém.
--  * Tempo real: delivery_tracking_ticks só diz "mudou" (sem coordenadas), com RLS = quem pode ver o pedido. O app recebe o
--    aviso e chama delivery_tracking() — as coordenadas nunca trafegam pelo canal.
--  * Destino: o cliente pode marcar o ponto de entrega pelo GPS do próprio aparelho (orders.delivery_lat/lng). Sem ponto,
--    o mapa mostra loja e entregador, e o entregador navega pelo endereço digitado (o Google Maps resolve o endereço).
--  * Rota: calculada no Worker (chave do provedor fica só no Worker), no máximo 6 vezes por entrega e com teto diário global
--    (private.routing_daily_limit). route_request() autoriza e devolve um bilhete de uso único; route_store() grava
--    a geometria apenas com esse bilhete. Distância restante e previsão são calculadas no app sobre a rota gravada.

-- ---------- destino informado pelo cliente ----------
alter table public.orders add column if not exists delivery_lat numeric(8, 5) check (delivery_lat is null or delivery_lat between -34 and 6);
alter table public.orders add column if not exists delivery_lng numeric(8, 5) check (delivery_lng is null or delivery_lng between -74 and -34);

create or replace function public.customer_set_delivery_point(_order uuid, _lat numeric, _lng numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = _order for update;
  if not found or o.customer_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if o.fulfillment not in ('delivery_partner', 'delivery_own') then raise exception 'Este pedido não é de entrega.' using errcode = 'P0001'; end if;
  if o.status not in ('placed', 'accepted', 'preparing', 'ready') then
    raise exception 'O ponto de entrega só pode ser marcado antes de o pedido sair para entrega.' using errcode = 'P0001';
  end if;
  if _lat is null or _lng is null or _lat not between -34 and 6 or _lng not between -74 and -34 then
    raise exception 'Localização fora do Brasil.' using errcode = 'P0001';
  end if;
  perform private.rate_limit('order.delivery_point', 20, 600);
  update public.orders set delivery_lat = round(_lat, 5), delivery_lng = round(_lng, 5) where id = _order;
end $$;

-- ---------- última posição (sem acesso direto) ----------
create table if not exists public.delivery_locations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  courier_id uuid not null references auth.users(id) on delete cascade,
  lat numeric(8, 5) not null check (lat between -34 and 6),
  lng numeric(8, 5) not null check (lng between -74 and -34),
  accuracy_m integer check (accuracy_m is null or accuracy_m between 0 and 100000),
  heading smallint check (heading is null or heading between 0 and 359),
  speed_kmh smallint check (speed_kmh is null or speed_kmh between 0 and 250),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists delivery_locations_courier_idx on public.delivery_locations(courier_id);
alter table public.delivery_locations enable row level security;
revoke all on public.delivery_locations from public, anon, authenticated;

-- ---------- aviso de mudança para o tempo real (sem coordenadas) ----------
create table if not exists public.delivery_tracking_ticks (
  order_id uuid primary key references public.orders(id) on delete cascade,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.delivery_tracking_ticks enable row level security;
drop policy if exists delivery_tracking_ticks_select on public.delivery_tracking_ticks;
create policy delivery_tracking_ticks_select on public.delivery_tracking_ticks for select to authenticated
  using (public.can_view_order(order_id));
revoke all on public.delivery_tracking_ticks from public, anon, authenticated;
grant select on public.delivery_tracking_ticks to authenticated;

create or replace function private.tracking_tick(_order uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.delivery_tracking_ticks(order_id, version, updated_at) values (_order, 1, now())
  on conflict (order_id) do update set version = public.delivery_tracking_ticks.version + 1, updated_at = now()
$$;

-- ---------- rotas calculadas (uma por perna: até a loja / até o cliente) ----------
create table if not exists public.delivery_routes (
  order_id uuid not null references public.orders(id) on delete cascade,
  leg text not null check (leg in ('coleta', 'entrega')),
  geometry jsonb not null check (jsonb_typeof(geometry) = 'array' and jsonb_array_length(geometry) between 2 and 5000),
  distance_m integer not null check (distance_m >= 0),
  duration_s integer not null check (duration_s >= 0),
  provider text not null check (char_length(provider) <= 40),
  computed_at timestamptz not null default now(),
  primary key (order_id, leg)
);
alter table public.delivery_routes enable row level security;
revoke all on public.delivery_routes from public, anon, authenticated;

create table if not exists private.route_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  leg text not null,
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists route_requests_order_idx on private.route_requests(order_id, created_at);
create index if not exists route_requests_day_idx on private.route_requests(created_at);
revoke all on private.route_requests from public, anon, authenticated;

-- teto diário de rotas na plataforma (custo do provedor). Para mudar: nova migration redefinindo a função. 0 desliga.
create or replace function private.routing_daily_limit() returns integer language sql immutable as $$ select 500 $$;

-- quem é o entregador atual do pedido e em que perna está (null = nenhum rastreamento permitido)
create or replace function private.tracking_leg(_order uuid, _user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when d.courier_id = _user and d.status = 'accepted' then 'coleta'
    when d.courier_id = _user and d.status = 'picked_up' then 'entrega'
    when o.fulfillment = 'delivery_own' and o.own_courier_id = _user and private.is_own_courier(o.business_id, _user)
         and o.status in ('accepted', 'preparing', 'ready') then 'coleta'
    when o.fulfillment = 'delivery_own' and o.own_courier_id = _user and private.is_own_courier(o.business_id, _user)
         and o.status = 'out_for_delivery' then 'entrega'
  end
    from public.orders o left join public.deliveries d on d.order_id = o.id
   where o.id = _order
$$;

-- entregador: envia a posição real do aparelho (chamado a cada ~20 s enquanto ele compartilha)
create or replace function public.courier_track_location(_order uuid, _lat numeric, _lng numeric, _accuracy_m integer default null,
                                                         _heading integer default null, _speed_kmh integer default null,
                                                         _recorded_at timestamptz default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_leg text := private.tracking_leg(_order, auth.uid()); at timestamptz := coalesce(_recorded_at, now());
begin
  if auth.uid() is null or v_leg is null then raise exception 'Esta entrega não está atribuída a você ou já terminou.' using errcode = '42501'; end if;
  perform private.rate_limit('delivery.track', 150, 600);   -- ~1 a cada 4 s no pior caso
  if _lat is null or _lng is null or _lat not between -34 and 6 or _lng not between -74 and -34 then
    raise exception 'Localização inválida.' using errcode = 'P0001';
  end if;
  if at > now() + interval '1 minute' or at < now() - interval '10 minutes' then
    raise exception 'Horário da localização inválido.' using errcode = 'P0001';
  end if;
  insert into public.delivery_locations as l (order_id, courier_id, lat, lng, accuracy_m, heading, speed_kmh, recorded_at, received_at)
  values (_order, auth.uid(), round(_lat, 5), round(_lng, 5), _accuracy_m,
          case when _heading between 0 and 359 then _heading end, case when _speed_kmh between 0 and 250 then _speed_kmh end, at, now())
  on conflict (order_id) do update set courier_id = excluded.courier_id, lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
         heading = excluded.heading, speed_kmh = excluded.speed_kmh, recorded_at = excluded.recorded_at, received_at = now()
   where l.recorded_at <= excluded.recorded_at;   -- posição mais antiga que a gravada é ignorada
  perform private.tracking_tick(_order);
  return v_leg;
end $$;

-- entregador: para de compartilhar (apaga a posição)
create or replace function public.courier_stop_tracking(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.delivery_locations where order_id = _order and courier_id = auth.uid();
  if found then perform private.tracking_tick(_order); end if;
end $$;

-- leitura: tudo o que o mapa precisa, já filtrado e arredondado para quem pergunta (bloco rotulado: tracking.leg é a variável)
create or replace function public.delivery_tracking(_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
<<tracking>>
declare o public.orders%rowtype; b record; l public.delivery_locations%rowtype; d public.deliveries%rowtype;
        viewer text; leg text; courier uuid; prec int; r public.delivery_routes%rowtype;
begin
  select * into o from public.orders where id = _order;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into d from public.deliveries where order_id = _order;
  tracking.leg := case
    when o.fulfillment = 'delivery_partner' and d.status = 'accepted' then 'coleta'
    when o.fulfillment = 'delivery_partner' and d.status = 'picked_up' then 'entrega'
    when o.fulfillment = 'delivery_own' and o.own_courier_id is not null and o.status in ('accepted', 'preparing', 'ready') then 'coleta'
    when o.fulfillment = 'delivery_own' and o.own_courier_id is not null and o.status = 'out_for_delivery' then 'entrega' end;
  courier := case when o.fulfillment = 'delivery_partner' then d.courier_id else o.own_courier_id end;
  viewer := case
    when courier is not null and courier = auth.uid() then 'entregador'
    when o.customer_id = auth.uid() then 'cliente'
    when public.has_business_permission(o.business_id, 'orders.view') then 'loja'
    when public.has_platform_permission('orders.view') then 'plataforma' end;
  if viewer is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if viewer = 'loja' and tracking.leg is distinct from 'coleta' then tracking.leg := null; end if;
  if viewer = 'plataforma' and not exists (select 1 from public.audit_logs a where a.actor_id = auth.uid() and a.action = 'tracking.view'
                                             and a.entity_id = _order::text and a.created_at > now() - interval '30 minutes') then
    perform private.audit('tracking.view', 'orders', _order::text, '{}'::jsonb);
  end if;
  prec := case when viewer = 'cliente' and tracking.leg = 'coleta' then 3 when viewer = 'cliente' then 4 else 5 end;
  select bc.name, bc.address_line, bc.lat, bc.lng into b from public.businesses bc where bc.id = o.business_id;
  if tracking.leg is not null then
    select * into l from public.delivery_locations x where x.order_id = _order and x.courier_id = courier;
    select * into r from public.delivery_routes x where x.order_id = _order and x.leg = tracking.leg;
  end if;
  return jsonb_build_object(
    'leg', tracking.leg,
    'viewer', viewer,
    'status', o.status,
    'vehicle', (select c.vehicle from public.couriers c where c.user_id = courier),
    'business', jsonb_build_object('name', b.name, 'address', b.address_line, 'lat', b.lat, 'lng', b.lng),
    'destination', case when viewer in ('cliente', 'entregador', 'plataforma') and o.delivery_lat is not null
                        then jsonb_build_object('lat', o.delivery_lat, 'lng', o.delivery_lng) end,
    'position', case when l.order_id is not null then jsonb_build_object(
                  'lat', round(l.lat, prec), 'lng', round(l.lng, prec),
                  'accuracy_m', case when prec < 5 then greatest(coalesce(l.accuracy_m, 0), case prec when 3 then 100 else 10 end) else l.accuracy_m end,
                  'heading', case when prec = 5 then l.heading end, 'speed_kmh', case when prec = 5 then l.speed_kmh end,
                  'recorded_at', l.recorded_at, 'received_at', l.received_at) end,
    'route', case when r.order_id is not null then jsonb_build_object('leg', r.leg, 'geometry', r.geometry, 'distance_m', r.distance_m,
                  'duration_s', r.duration_s, 'provider', r.provider, 'computed_at', r.computed_at) end,
    'server_time', now());
end $$;

-- rota: o Worker pede autorização (com o token do entregador) e recebe origem, destino e um bilhete de uso único
create or replace function public.route_request(_order uuid, _leg text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_leg text := private.tracking_leg(_order, auth.uid()); o public.orders%rowtype; b record; l public.delivery_locations%rowtype;
        lim int; dest jsonb; rid uuid;
begin
  if auth.uid() is null or v_leg is null or v_leg is distinct from _leg then raise exception 'Esta entrega não está atribuída a você nesta etapa.' using errcode = '42501'; end if;
  select * into o from public.orders where id = _order;
  select * into l from public.delivery_locations where order_id = _order and courier_id = auth.uid();
  if l.order_id is null or l.received_at < now() - interval '2 minutes' then
    raise exception 'Compartilhe sua localização para calcular a rota.' using errcode = 'P0001';
  end if;
  if v_leg = 'coleta' then
    select bc.lat, bc.lng into b from public.businesses bc where bc.id = o.business_id;
    if b.lat is null then raise exception 'O estabelecimento não tem coordenadas cadastradas; use o Google Maps pelo endereço.' using errcode = 'P0001'; end if;
    dest := jsonb_build_object('lat', b.lat, 'lng', b.lng);
  else
    if o.delivery_lat is null then raise exception 'O cliente não marcou o ponto de entrega; use o Google Maps pelo endereço.' using errcode = 'P0001'; end if;
    dest := jsonb_build_object('lat', o.delivery_lat, 'lng', o.delivery_lng);
  end if;
  perform pg_advisory_xact_lock(hashtext('route:' || _order::text));
  if (select count(*) from private.route_requests where order_id = _order) >= 6 then
    raise exception 'Limite de rotas desta entrega atingido; use o Google Maps.' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.route_requests where order_id = _order and route_requests.leg = _leg and created_at > now() - interval '90 seconds') then
    raise exception 'A rota acabou de ser calculada; aguarde um pouco.' using errcode = 'P0001';
  end if;
  lim := private.routing_daily_limit();
  if (select count(*) from private.route_requests where created_at > now() - interval '1 day') >= lim then
    raise exception 'Cálculo de rotas indisponível no momento; use o Google Maps.' using errcode = 'P0001';
  end if;
  insert into private.route_requests(order_id, leg, requested_by) values (_order, _leg, auth.uid()) returning id into rid;
  return jsonb_build_object('ticket', rid, 'origin', jsonb_build_object('lat', l.lat, 'lng', l.lng), 'destination', dest);
end $$;

-- o Worker grava a rota calculada (só com o bilhete emitido para o mesmo entregador, em até 2 minutos)
create or replace function public.route_store(_ticket uuid, _geometry jsonb, _distance_m integer, _duration_s integer, _provider text) returns void
language plpgsql security definer set search_path = '' as $$
declare t private.route_requests%rowtype;
begin
  update private.route_requests set used_at = now()
   where id = _ticket and requested_by = auth.uid() and used_at is null and created_at > now() - interval '2 minutes'
  returning * into t;
  if not found then raise exception 'Bilhete de rota inválido ou expirado.' using errcode = '42501'; end if;
  if private.tracking_leg(t.order_id, auth.uid()) is distinct from t.leg then raise exception 'A etapa da entrega mudou.' using errcode = 'P0001'; end if;
  if jsonb_typeof(_geometry) <> 'array' or jsonb_array_length(_geometry) not between 2 and 5000 then raise exception 'Rota inválida.' using errcode = 'P0001'; end if;
  insert into public.delivery_routes(order_id, leg, geometry, distance_m, duration_s, provider)
  values (t.order_id, t.leg, _geometry, greatest(_distance_m, 0), greatest(_duration_s, 0), left(coalesce(_provider, 'desconhecido'), 40))
  on conflict (order_id, leg) do update set geometry = excluded.geometry, distance_m = excluded.distance_m, duration_s = excluded.duration_s,
         provider = excluded.provider, computed_at = now();
  perform private.tracking_tick(t.order_id);
end $$;

-- fim do rastreamento: entrega concluída, cancelada, liberada ou pedido encerrado apagam posição e rotas
create or replace function private.tracking_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'deliveries' then
    if new.status in ('delivered', 'cancelled') or new.courier_id is distinct from old.courier_id then
      delete from public.delivery_locations where order_id = new.order_id;
      if new.status in ('delivered', 'cancelled') then delete from public.delivery_routes where order_id = new.order_id; end if;
      perform private.tracking_tick(new.order_id);
    end if;
  elsif new.status in ('delivered', 'picked_up', 'cancelled', 'rejected') or new.own_courier_id is distinct from old.own_courier_id then
    delete from public.delivery_locations where order_id = new.id;
    if new.status in ('delivered', 'picked_up', 'cancelled', 'rejected') then delete from public.delivery_routes where order_id = new.id; end if;
    perform private.tracking_tick(new.id);
  end if;
  return null;
end $$;
drop trigger if exists deliveries_tracking_cleanup on public.deliveries;
create trigger deliveries_tracking_cleanup after update of status, courier_id on public.deliveries
  for each row execute function private.tracking_cleanup();
drop trigger if exists orders_tracking_cleanup on public.orders;
create trigger orders_tracking_cleanup after update of status, own_courier_id on public.orders
  for each row execute function private.tracking_cleanup();

-- posição parada há 30 min some (aparelho desligado, app fechado)
create or replace function public.sweep_tracking() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.delivery_locations where received_at < now() - interval '30 minutes';
  get diagnostics n = row_count;
  delete from private.route_requests where created_at < now() - interval '2 days';
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.routing_daily_limit()', 'private.tracking_tick(uuid)', 'private.tracking_leg(uuid, uuid)', 'private.tracking_cleanup()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.sweep_tracking() from public, anon, authenticated;
  foreach f in array array[
    'public.customer_set_delivery_point(uuid, numeric, numeric)',
    'public.courier_track_location(uuid, numeric, numeric, integer, integer, integer, timestamptz)',
    'public.courier_stop_tracking(uuid)', 'public.delivery_tracking(uuid)',
    'public.route_request(uuid, text)', 'public.route_store(uuid, jsonb, integer, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_tracking_ticks') then
    alter publication supabase_realtime add table public.delivery_tracking_ticks;
  end if;
  -- varredura a cada 5 min quando o pg_cron existir (no Supabase)
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tucai-sweep-tracking', '*/5 * * * *', 'select public.sweep_tracking()');
  end if;
end $$;
