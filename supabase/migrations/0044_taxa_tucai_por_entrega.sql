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
