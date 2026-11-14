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
