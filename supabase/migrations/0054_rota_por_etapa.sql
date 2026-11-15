-- 0054 — Rota por etapa, traçada pelo botão do entregador (sem cálculo automático em sequência).
--  * Coleta ("Traçar rota até o restaurante"): sai de onde o entregador está agora (GPS do aparelho; sem GPS, o endereço
--    cadastrado dele, localizado no mapa) e vai até o local cadastrado do estabelecimento.
--  * Entrega ("Traçar rota até o cliente", depois de "Peguei o pedido"): sai do local cadastrado do estabelecimento
--    e vai até o ponto do cliente.
-- A rota só serve para a tela de navegação (o frete continua calculado no servidor pela 0040). O ponto de partida
-- informado pelo aparelho é validado (Brasil e até 100 km da loja). Limites da 0037 mantidos (6 por pedido; 90 s por etapa).

create or replace function private.route_request_core(_order uuid, _leg text, _from jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_leg text := private.tracking_leg(_order, auth.uid()); o public.orders%rowtype; b record; l public.delivery_locations%rowtype;
        lim int; dest jsonb; orig jsonb; rid uuid; f_lat double precision; f_lng double precision;
begin
  if auth.uid() is null or v_leg is null or v_leg is distinct from _leg then raise exception 'Esta entrega não está atribuída a você nesta etapa.' using errcode = '42501'; end if;
  select * into o from public.orders where id = _order;
  select bc.lat, bc.lng into b from public.businesses bc where bc.id = o.business_id;

  if _from is not null then
    f_lat := (_from->>'lat')::double precision; f_lng := (_from->>'lng')::double precision;
    if f_lat is null or f_lng is null or f_lat not between -34 and 6 or f_lng not between -75 and -28 then
      raise exception 'Ponto de partida inválido.' using errcode = '22023';
    end if;
    if b.lat is not null and (abs(f_lat - b.lat) > 0.9 or abs(f_lng - b.lng) > 0.9) then
      raise exception 'Você está longe demais do estabelecimento para traçar a rota (mais de 100 km).' using errcode = 'P0001';
    end if;
  end if;

  if v_leg = 'coleta' then
    if b.lat is null then raise exception 'O restaurante ainda não marcou o endereço no mapa; use o endereço escrito.' using errcode = 'P0001'; end if;
    dest := jsonb_build_object('lat', b.lat, 'lng', b.lng);
    if _from is not null then
      orig := jsonb_build_object('lat', round(f_lat::numeric, 6), 'lng', round(f_lng::numeric, 6));
    else
      select * into l from public.delivery_locations where order_id = _order and courier_id = auth.uid();
      if l.order_id is null or l.received_at < now() - interval '2 minutes' then
        raise exception 'Ligue o GPS (ou cadastre seu endereço em Meus dados) para traçar a rota até o restaurante.' using errcode = 'P0001';
      end if;
      orig := jsonb_build_object('lat', l.lat, 'lng', l.lng);
    end if;
  else
    if o.delivery_lat is null then raise exception 'O endereço do cliente ainda não foi localizado no mapa; use o endereço escrito.' using errcode = 'P0001'; end if;
    dest := jsonb_build_object('lat', o.delivery_lat, 'lng', o.delivery_lng);
    if b.lat is not null then
      orig := jsonb_build_object('lat', b.lat, 'lng', b.lng);
    elsif _from is not null then
      orig := jsonb_build_object('lat', round(f_lat::numeric, 6), 'lng', round(f_lng::numeric, 6));
    else
      select * into l from public.delivery_locations where order_id = _order and courier_id = auth.uid();
      if l.order_id is null then raise exception 'O restaurante não marcou o endereço no mapa; ligue o GPS para traçar a rota.' using errcode = 'P0001'; end if;
      orig := jsonb_build_object('lat', l.lat, 'lng', l.lng);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('route:' || _order::text));
  if (select count(*) from private.route_requests where order_id = _order) >= 6 then
    raise exception 'Limite de rotas desta entrega atingido; use o endereço escrito.' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.route_requests r where r.order_id = _order and r.leg = _leg and r.created_at > now() - interval '90 seconds') then
    raise exception 'A rota acabou de ser traçada; aguarde um pouco para traçar de novo.' using errcode = 'P0001';
  end if;
  lim := private.routing_daily_limit();
  if (select count(*) from private.route_requests where created_at > now() - interval '1 day') >= lim then
    raise exception 'Cálculo de rotas indisponível no momento; use o endereço escrito.' using errcode = 'P0001';
  end if;
  insert into private.route_requests(order_id, leg, requested_by) values (_order, _leg, auth.uid()) returning id into rid;
  return jsonb_build_object('ticket', rid, 'origin', orig, 'destination', dest);
end $$;
revoke all on function private.route_request_core(uuid, text, jsonb) from public, anon, authenticated;

-- sem ponto de partida (usa a localização compartilhada); a entrega sai da loja
create or replace function public.route_request(_order uuid, _leg text) returns jsonb
language sql security definer set search_path = '' as $$ select private.route_request_core(_order, _leg, null) $$;

-- com ponto de partida do aparelho (GPS agora ou endereço cadastrado do entregador)
create or replace function public.route_request_from(_order uuid, _leg text, _lat double precision, _lng double precision) returns jsonb
language sql security definer set search_path = '' as $$
  select private.route_request_core(_order, _leg, jsonb_build_object('lat', _lat, 'lng', _lng))
$$;

do $$ begin
  revoke all on function public.route_request(uuid, text) from public, anon;
  grant execute on function public.route_request(uuid, text) to authenticated;
  revoke all on function public.route_request_from(uuid, text, double precision, double precision) from public, anon;
  grant execute on function public.route_request_from(uuid, text, double precision, double precision) to authenticated;
end $$;
