-- 0052 — Pedido da rede para TODOS os entregadores cadastrados na Tucaí.
-- Antes (0044), quem era entregador próprio de uma loja nunca via as ofertas da rede, mesmo tendo cadastro aprovado
-- de entregador parceiro. Agora: o entregador próprio continua recebendo as entregas atribuídas pela loja dele e,
-- se também tiver cadastro aprovado de entregador parceiro (com cidade) e ficar Online, vê e aceita as ofertas da
-- rede como qualquer outro. Quem aceitar primeiro leva (a atualização continua atômica).
-- Regras financeiras inalteradas: a oferta aceita é paga como entrega da rede (valores do próprio pedido);
-- entregas próprias continuam sem valor da rede (trigger da 0044).

create or replace function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint, offer_expires_at timestamptz, offer_round smallint,
               order_status public.order_status, city_name text, delivery_distance_m integer, store_lat numeric, store_lng numeric)
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); me_test boolean := private.is_test_user(c.user_id);
begin
  if not c.is_online then return; end if;
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


create or replace function public.courier_accept_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int; o public.orders%rowtype;
begin
  perform private.limit_for('delivery.action');
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
