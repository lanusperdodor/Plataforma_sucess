-- Testes da 0011 (pedidos) e 0012 (entregas parceiras). Tudo é revertido. Sucesso: NOTICE 'RLS_ORDERS_OK'.
begin;

create schema tsto;
grant usage on schema tsto to public;
create function tsto.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tsto.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsto.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsto.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsto.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsto.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsto.val(q text) returns text language plpgsql as $$
declare v text; begin execute q into v; return v; end $$;
grant execute on all functions in schema tsto to public;

-- cu1/cu2 clientes; own/att dono e atendente de A; ownb dono de B; k1/k2 entregadores da cidade C; k3 da cidade D; kp pendente
insert into auth.users(id, email) values
  ('44440000-0000-0000-0000-0000000000c1', 'o-cliente1@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000c2', 'o-cliente2@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000a1', 'o-dono-a@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000a2', 'o-atendente-a@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000b1', 'o-dono-b@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000e1', 'o-entregador1@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000e2', 'o-entregador2@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000e3', 'o-entregador3@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000e4', 'o-entregador-pendente@teste.invalid');
insert into public.cities(id, name, state, slug) values
  ('44449000-0000-0000-0000-000000000001', 'Cidade O', 'TO', 'tsto-cidade-c'),
  ('44449000-0000-0000-0000-000000000002', 'Cidade P', 'TO', 'tsto-cidade-d');
insert into public.businesses(id, name, slug, owner_id, status, city_id, delivery_offer, accepts_pickup, min_order_cents, own_delivery_fee_cents, address_line) values
  ('44441000-0000-0000-0000-00000000000a', 'Hamburgueria A', 'tsto-a', '44440000-0000-0000-0000-0000000000a1', 'active', '44449000-0000-0000-0000-000000000001', 'partner', true, 1000, 0, 'Rua A, 10'),
  ('44441000-0000-0000-0000-00000000000b', 'Pizzaria B', 'tsto-b', '44440000-0000-0000-0000-0000000000b1', 'active', '44449000-0000-0000-0000-000000000001', 'own', false, 0, 700, 'Rua B, 20'),
  ('44441000-0000-0000-0000-00000000000f', 'Fechada F', 'tsto-f', '44440000-0000-0000-0000-0000000000b1', 'active', '44449000-0000-0000-0000-000000000001', 'own', true, 0, 0, null);
insert into public.business_members(business_id, user_id, member_role) values
  ('44441000-0000-0000-0000-00000000000a', '44440000-0000-0000-0000-0000000000a1', 'owner'),
  ('44441000-0000-0000-0000-00000000000a', '44440000-0000-0000-0000-0000000000a2', 'attendant'),
  ('44441000-0000-0000-0000-00000000000b', '44440000-0000-0000-0000-0000000000b1', 'owner'),
  ('44441000-0000-0000-0000-00000000000f', '44440000-0000-0000-0000-0000000000b1', 'owner');
-- A e B abertos o dia todo; F sem horário (fechada)
insert into public.business_hours(business_id, weekday, opens, closes)
select b, d, '00:00', '24:00' from unnest(array['44441000-0000-0000-0000-00000000000a', '44441000-0000-0000-0000-00000000000b']::uuid[]) b,
  generate_series(0, 6) d;
insert into public.menu_categories(id, business_id, name) values
  ('44442000-0000-0000-0000-00000000000a', '44441000-0000-0000-0000-00000000000a', 'Lanches'),
  ('44442000-0000-0000-0000-00000000000b', '44441000-0000-0000-0000-00000000000b', 'Pizzas'),
  ('44442000-0000-0000-0000-00000000000f', '44441000-0000-0000-0000-00000000000f', 'Itens');
insert into public.products(id, business_id, category_id, name, price_cents, is_available) values
  ('44443000-0000-0000-0000-000000000001', '44441000-0000-0000-0000-00000000000a', '44442000-0000-0000-0000-00000000000a', 'X-Burger', 3000, true),
  ('44443000-0000-0000-0000-000000000002', '44441000-0000-0000-0000-00000000000a', '44442000-0000-0000-0000-00000000000a', 'Água', 500, true),
  ('44443000-0000-0000-0000-000000000003', '44441000-0000-0000-0000-00000000000a', '44442000-0000-0000-0000-00000000000a', 'Esgotado', 900, false),
  ('44443000-0000-0000-0000-000000000004', '44441000-0000-0000-0000-00000000000b', '44442000-0000-0000-0000-00000000000b', 'Pizza', 4000, true),
  ('44443000-0000-0000-0000-000000000005', '44441000-0000-0000-0000-00000000000f', '44442000-0000-0000-0000-00000000000f', 'Item F', 2000, true);
insert into public.option_groups(id, business_id, product_id, name, min_select, max_select) values
  ('44444000-0000-0000-0000-000000000001', '44441000-0000-0000-0000-00000000000a', '44443000-0000-0000-0000-000000000001', 'Ponto', 1, 1),
  ('44444000-0000-0000-0000-000000000002', '44441000-0000-0000-0000-00000000000a', '44443000-0000-0000-0000-000000000001', 'Extras', 0, 2),
  ('44444000-0000-0000-0000-000000000003', '44441000-0000-0000-0000-00000000000b', '44443000-0000-0000-0000-000000000004', 'Borda', 0, 1);
insert into public.options(id, business_id, group_id, name, price_delta_cents, is_available) values
  ('44445000-0000-0000-0000-000000000001', '44441000-0000-0000-0000-00000000000a', '44444000-0000-0000-0000-000000000001', 'Ao ponto', 0, true),
  ('44445000-0000-0000-0000-000000000002', '44441000-0000-0000-0000-00000000000a', '44444000-0000-0000-0000-000000000001', 'Bem passado', 0, true),
  ('44445000-0000-0000-0000-000000000003', '44441000-0000-0000-0000-00000000000a', '44444000-0000-0000-0000-000000000002', 'Bacon', 500, true),
  ('44445000-0000-0000-0000-000000000004', '44441000-0000-0000-0000-00000000000a', '44444000-0000-0000-0000-000000000002', 'Queijo extra', 300, false),
  ('44445000-0000-0000-0000-000000000005', '44441000-0000-0000-0000-00000000000b', '44444000-0000-0000-0000-000000000003', 'Catupiry', 800, true);
insert into public.couriers(user_id, full_name, phone, city_id, vehicle, status, is_online, terms_version, terms_accepted_at) values
  ('44440000-0000-0000-0000-0000000000e1', 'Edu Um', '35999990001', '44449000-0000-0000-0000-000000000001', 'bicicleta', 'approved', true, 't1', now()),
  ('44440000-0000-0000-0000-0000000000e2', 'Eva Dois', '35999990002', '44449000-0000-0000-0000-000000000001', 'bicicleta', 'approved', false, 't1', now()),
  ('44440000-0000-0000-0000-0000000000e3', 'Enzo Tres', '35999990003', '44449000-0000-0000-0000-000000000002', 'bicicleta', 'approved', true, 't1', now()),
  ('44440000-0000-0000-0000-0000000000e4', 'Eli Quatro', '35999990004', '44449000-0000-0000-0000-000000000001', 'bicicleta', 'pending', false, 't1', now());

do $$
declare
  cu1 constant uuid := '44440000-0000-0000-0000-0000000000c1';
  cu2 constant uuid := '44440000-0000-0000-0000-0000000000c2';
  own constant uuid := '44440000-0000-0000-0000-0000000000a1';
  att constant uuid := '44440000-0000-0000-0000-0000000000a2';
  ownb constant uuid := '44440000-0000-0000-0000-0000000000b1';
  k1 constant uuid := '44440000-0000-0000-0000-0000000000e1';
  k2 constant uuid := '44440000-0000-0000-0000-0000000000e2';
  k3 constant uuid := '44440000-0000-0000-0000-0000000000e3';
  kp constant uuid := '44440000-0000-0000-0000-0000000000e4';
  ba constant uuid := '44441000-0000-0000-0000-00000000000a';
  bb constant uuid := '44441000-0000-0000-0000-00000000000b';
  bf constant uuid := '44441000-0000-0000-0000-00000000000f';
  burger constant text := '44443000-0000-0000-0000-000000000001';
  agua constant text := '44443000-0000-0000-0000-000000000002';
  esgotado constant text := '44443000-0000-0000-0000-000000000003';
  pizza constant text := '44443000-0000-0000-0000-000000000004';
  ponto constant text := '44445000-0000-0000-0000-000000000001';
  bacon constant text := '44445000-0000-0000-0000-000000000003';
  queijo constant text := '44445000-0000-0000-0000-000000000004';
  catupiry constant text := '44445000-0000-0000-0000-000000000005';
  items jsonb;
  o1 uuid; o1b uuid; o2 uuid; o3 uuid; o4 uuid; rv uuid;
  code text;
  r record;
  s jsonb;
begin
  -- ======================= 1. criar pedido: preço calculado no servidor =======================
  items := jsonb_build_array(jsonb_build_object('product_id', burger, 'quantity', 2, 'option_ids', jsonb_build_array(ponto, bacon),
                                                'price_cents', 1, 'notes', 'sem cebola'));
  perform tsto.anon();
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'delivery_partner', 'cash', 'Cli', '35999990000', 'Rua X, 1', null, null, null, 'chave-anon-1')$q$, ba, items),
                      'anon faz pedido');
  perform tsto.login(cu1);
  o1 := public.place_order(ba, items, 'delivery_partner', 'cash', 'Carla Cliente', '(35) 99999-0000', 'Rua das Flores, 100, Centro',
                           'portão azul', 'capricha', 10000, 'chave-pedido-0001');
  select * into r from public.orders where id = o1;
  -- (3000 + 500) * 2 = 7000; comissão 2% acima de R$ 50 = 140; entrega parceira 400 cliente + 200 loja = 500 entregador + 100 plataforma
  perform tsto.ok(r.subtotal_cents = 7000 and r.delivery_fee_cents = 400 and r.total_cents = 7400, 'valores do pedido (preço enviado pelo navegador ignorado)');
  perform tsto.ok(r.commission_cents = 140 and r.merchant_delivery_contribution_cents = 200 and r.courier_pay_cents = 500
                  and r.platform_delivery_fee_cents = 100, 'comissão e repasses do snapshot');
  perform tsto.ok(r.status = 'placed' and r.customer_id = cu1 and r.pricing_snapshot ? 'config', 'pedido registrado com snapshot');
  perform tsto.ok(tsto.count(format('select 1 from public.order_items where order_id = %L and unit_price_cents = 3500 and quantity = 2 and notes = %L', o1, 'sem cebola')) = 1,
                  'item com adicionais no preço unitário');
  -- idempotência
  perform tsto.ok(public.place_order(ba, items, 'delivery_partner', 'cash', 'Carla Cliente', '(35) 99999-0000', 'Rua das Flores, 100, Centro',
                                     null, null, null, 'chave-pedido-0001') = o1, 'mesma chave devolve o mesmo pedido');
  perform tsto.ok(tsto.count(format('select 1 from public.orders where customer_id = %L', cu1)) = 1, 'sem pedido duplicado');

  -- validações
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-fechada-1')$q$,
                      bf, jsonb_build_array(jsonb_build_object('product_id', '44443000-0000-0000-0000-000000000005', 'quantity', 1))), 'loja fechada', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-grupo-01')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', burger, 'quantity', 1))), 'grupo obrigatório sem escolha', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-outro-01')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', burger, 'quantity', 1, 'option_ids', jsonb_build_array(ponto, catupiry)))),
                      'adicional de outro produto', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-indisp-1')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', burger, 'quantity', 1, 'option_ids', jsonb_build_array(ponto, queijo)))),
                      'adicional indisponível', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-esgot-01')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', esgotado, 'quantity', 1))), 'produto indisponível', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-outral-1')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1))), 'produto de outra loja', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-minimo-1')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 1))), 'abaixo do pedido mínimo', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'delivery_own', 'cash', 'Carla', '35999990000', 'Rua X, 1', null, null, null, 'chave-modal-01')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 4))), 'modalidade não oferecida', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'delivery_partner', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-ender-01')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 4))), 'entrega sem endereço', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, 100, 'chave-troco-01')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 4))), 'troco menor que o total', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'pix_on_delivery', 'Carla', '35999990000', null, null, null, 5000, 'chave-troco-02')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 4))), 'troco no Pix', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'chave-qtd-001')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 0))), 'quantidade zero', array['P0001']);
  perform tsto.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Carla', '35999990000', null, null, null, null, 'curta')$q$,
                      ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 4))), 'chave de idempotência curta', array['P0001']);

  -- escrita direta bloqueada
  perform tsto.denied(format('update public.orders set total_cents = 0 where id = %L', o1), 'cliente altera valor do pedido');
  perform tsto.denied(format('update public.orders set status = %L where id = %L', 'delivered', o1), 'cliente altera status direto');
  perform tsto.denied($q$insert into public.order_events(order_id, status) values (gen_random_uuid(), 'placed')$q$, 'cliente grava histórico');
  perform tsto.denied(format('delete from public.orders where id = %L', o1), 'cliente apaga pedido');

  -- ======================= 2. visibilidade =======================
  perform tsto.ok(tsto.count('select 1 from public.order_items') = 1 and tsto.count('select 1 from public.order_events') = 1, 'cliente vê itens e histórico do próprio pedido');
  perform tsto.login(cu2);
  perform tsto.ok(tsto.count('select 1 from public.orders') = 0 and tsto.count('select 1 from public.order_items') = 0, 'outro cliente não vê o pedido');
  perform tsto.login(ownb);
  perform tsto.ok(tsto.count('select 1 from public.orders') = 0, 'dono de outra loja não vê o pedido');
  perform tsto.login(att);
  perform tsto.ok(tsto.count(format('select 1 from public.orders where id = %L', o1)) = 1, 'atendente vê pedido da loja');
  perform tsto.login(k1);
  perform tsto.ok(tsto.count('select 1 from public.orders') = 0, 'entregador não vê pedido antes do aceite');
  perform tsto.anon();
  perform tsto.denied('select * from public.orders', 'anon lê pedidos');
  perform tsto.su();
  perform tsto.ok(tsto.count(format($q$select 1 from public.notifications where user_id in (%L, %L) and kind = 'order_new' and link = %L$q$,
                  own, att, '/painel/' || ba || '/pedidos')) = 2, 'equipe da loja notificada do novo pedido');

  -- ======================= 3. status =======================
  perform tsto.login(cu1);
  perform tsto.denied(format($q$select public.update_order_status(%L, 'accepted')$q$, o1), 'cliente aceita o próprio pedido', array['P0001']);
  perform tsto.login(ownb);
  perform tsto.denied(format($q$select public.update_order_status(%L, 'accepted')$q$, o1), 'outra loja aceita o pedido');
  perform tsto.login(att);
  perform tsto.denied(format($q$select public.update_order_status(%L, 'ready')$q$, o1), 'pula etapas', array['P0001']);
  perform tsto.denied(format($q$select public.update_order_status(%L, 'rejected')$q$, o1), 'recusa sem motivo', array['P0001']);
  perform public.update_order_status(o1, 'accepted');
  perform tsto.login(cu1);
  perform tsto.denied(format($q$select public.update_order_status(%L, 'cancelled')$q$, o1), 'cliente cancela depois do aceite', array['P0001']);
  perform tsto.login(att);
  perform public.update_order_status(o1, 'preparing');
  perform tsto.ok(tsto.count(format($q$select 1 from public.deliveries where order_id = %L$q$, o1)) = 0, 'sem oferta antes de pronto');
  perform public.update_order_status(o1, 'ready');
  perform tsto.denied(format($q$select public.update_order_status(%L, 'out_for_delivery')$q$, o1), 'loja despacha entrega parceira', array['P0001']);
  perform tsto.denied(format($q$select public.update_order_status(%L, 'delivered')$q$, o1), 'loja marca entregue na entrega parceira', array['P0001']);
  perform tsto.denied(format('select confirmation_code from public.deliveries where order_id = %L', o1), 'loja lê código de confirmação');
  perform tsto.ok(tsto.count(format($q$select 1 from public.deliveries where order_id = %L and status = 'offered'$q$, o1)) = 1, 'pronto vira oferta');
  perform tsto.su();
  perform tsto.ok(tsto.count(format($q$select 1 from public.notifications where user_id = %L and kind = 'order_update'$q$, cu1)) = 3, 'cliente notificado de cada etapa');
  perform tsto.ok(tsto.count($q$select 1 from public.notifications where kind = 'delivery_offer'$q$) = 1
                  and tsto.count(format($q$select 1 from public.notifications where kind = 'delivery_offer' and user_id = %L$q$, k1)) = 1,
                  'só entregadores disponíveis da cidade recebem a oferta');

  -- ======================= 4. entregas =======================
  perform tsto.login(kp);
  perform tsto.denied('select * from public.courier_list_offers()', 'entregador pendente vê ofertas');
  perform tsto.denied(format('select public.courier_accept_delivery(%L)', o1), 'entregador pendente aceita');
  perform tsto.login(k3);
  perform tsto.ok(tsto.count('select * from public.courier_list_offers()') = 0, 'entregador de outra cidade não vê a oferta');
  perform tsto.denied(format('select public.courier_accept_delivery(%L)', o1), 'entregador de outra cidade aceita', array['P0001']);
  perform tsto.login(k2);
  perform tsto.ok(tsto.count('select * from public.courier_list_offers()') = 0, 'entregador indisponível não vê ofertas');
  perform tsto.denied(format('select public.courier_accept_delivery(%L)', o1), 'entregador indisponível aceita', array['P0001']);
  perform tsto.login(k1);
  select * into r from public.courier_list_offers();
  perform tsto.ok(r.order_id = o1 and r.courier_pay_cents = 500 and r.items_count = 1 and r.neighborhood_hint = 'Centro', 'oferta com ganho e só o bairro');
  perform tsto.denied('select * from public.deliveries', 'entregador lê tabela de entregas direto', array['42501']);
  perform public.courier_accept_delivery(o1);
  perform tsto.ok(tsto.count(format('select 1 from public.orders where id = %L', o1)) = 1, 'entregador vê o pedido aceito');
  perform tsto.ok(tsto.val('select customer_phone from public.courier_my_deliveries(true)') = '(35) 99999-0000', 'entregador recebe contato após o aceite');
  perform tsto.login(k2);
  perform public.set_courier_online(true);
  perform tsto.denied(format('select public.courier_accept_delivery(%L)', o1), 'segundo entregador aceita a mesma entrega', array['P0001']);
  perform tsto.ok(tsto.count('select 1 from public.orders') = 0, 'segundo entregador não vê o pedido');
  -- cliente vê o código; ninguém mais
  perform tsto.login(cu1);
  select * into r from public.my_delivery(o1);
  perform tsto.ok(r.status = 'accepted' and r.confirmation_code ~ '^[0-9]{4}$' and r.courier_first_name = 'Edu', 'cliente vê código e entregador');
  code := r.confirmation_code;
  perform tsto.login(cu2);
  perform tsto.ok(tsto.count(format('select * from public.my_delivery(%L)', o1)) = 0, 'outro cliente não vê o código');
  -- liberar antes da coleta devolve a oferta; outro entregador assume
  perform tsto.login(k1);
  perform public.courier_release_delivery(o1);
  perform tsto.ok(tsto.count('select * from public.courier_my_deliveries(true)') = 0, 'entrega liberada');
  perform tsto.login(k2);
  perform public.courier_accept_delivery(o1);
  perform tsto.denied(format('select public.courier_complete_delivery(%L, %L)', o1, code), 'conclui sem coletar', array['P0001']);
  perform public.courier_pickup_delivery(o1);
  perform tsto.denied(format('select public.courier_release_delivery(%L)', o1), 'libera depois da coleta', array['P0001']);
  perform tsto.login(k1);
  perform tsto.denied(format('select public.courier_pickup_delivery(%L)', o1), 'outro entregador coleta', array['P0001']);
  perform tsto.login(k2);
  perform public.courier_complete_delivery(o1, case when code = '0000' then '1111' else '0000' end);
  perform tsto.su();
  perform tsto.ok((select status = 'picked_up' and failed_code_attempts = 1 from public.deliveries where order_id = o1), 'código errado não conclui');
  perform tsto.ok((select status = 'out_for_delivery' from public.orders where id = o1), 'pedido em rota após a coleta');
  perform tsto.login(k2);
  perform public.courier_complete_delivery(o1, code);
  perform tsto.su();
  perform tsto.ok((select status = 'delivered' from public.orders where id = o1) and (select status = 'delivered' from public.deliveries where order_id = o1),
                  'pedido entregue com o código');
  perform tsto.login(k2);
  s := public.courier_earnings();
  perform tsto.ok((s->>'total_cents')::int = 500 and (s->>'deliveries')::int = 1 and (s->>'today_cents')::int = 500, 'ganhos do entregador');
  perform tsto.ok(tsto.count('select * from public.courier_my_deliveries(false)') = 1, 'histórico do entregador');
  perform tsto.login(k1);
  perform tsto.ok((public.courier_earnings()->>'total_cents')::int = 0, 'quem liberou não ganha');

  -- ======================= 5. avaliação verificada =======================
  perform tsto.login(cu2);
  perform tsto.denied(format('select public.submit_review(%L, 5)', o1), 'avalia pedido de outro', array['P0001']);
  perform tsto.denied(format($q$insert into public.reviews(business_id, rating) values (%L, 5)$q$, ba), 'avaliação direta na tabela');
  perform tsto.login(cu1);
  perform tsto.denied(format('select public.submit_review(%L, 6)', o1), 'nota fora da escala', array['P0001']);
  rv := public.submit_review(o1, 5, 'Chegou quentinho');
  perform tsto.denied(format('select public.submit_review(%L, 1)', o1), 'avalia duas vezes', array['P0001']);
  perform tsto.login(att);
  perform tsto.denied(format($q$select public.reply_review(%L, 'Obrigado')$q$, rv), 'atendente responde avaliação');
  perform tsto.login(ownb);
  perform tsto.denied(format($q$select public.reply_review(%L, 'Obrigado')$q$, rv), 'outra loja responde');
  perform tsto.login(own);
  perform public.reply_review(rv, 'Obrigado, Carla!');
  perform tsto.anon();
  perform tsto.ok(tsto.val(format('select reply from public.reviews where id = %L', rv)) = 'Obrigado, Carla!'
                  and tsto.val(format('select author_name from public.reviews where id = %L', rv)) = 'Carla', 'avaliação e resposta públicas');
  perform tsto.denied('select user_id from public.reviews', 'anon lê autor da avaliação');
  perform tsto.su();
  perform tsto.ok((select rating_count = 1 and rating_avg = 5 from public.businesses where id = ba), 'média da loja atualizada');

  -- ======================= 6. relatório de vendas =======================
  perform tsto.login(att);
  perform tsto.denied(format('select public.business_sales_summary(%L)', ba), 'atendente vê relatório');
  perform tsto.login(own);
  s := public.business_sales_summary(ba, 30);
  perform tsto.ok((s->>'orders_completed')::int = 1 and (s->>'gross_cents')::int = 7000 and (s->>'commission_cents')::int = 140
                  and (s->>'delivery_costs_cents')::int = 300 and s->'top_products'->0->>'name' = 'X-Burger', 'relatório de vendas');

  -- ======================= 7. retirada, entrega própria, cancelamentos =======================
  perform tsto.login(cu1);
  o2 := public.place_order(ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 3)), 'pickup', 'pix_on_delivery',
                           'Carla', '35999990000', 'ignorado', null, null, null, 'chave-pedido-0002');
  perform tsto.ok((select delivery_fee_cents = 0 and commission_cents = 0 and total_cents = 1500 and delivery_address is null from public.orders where id = o2),
                  'retirada sem taxa; sem comissão até R$ 50');
  perform public.update_order_status(o2, 'cancelled');
  perform tsto.ok((select status = 'cancelled' from public.orders where id = o2), 'cliente cancela antes do aceite');
  o3 := public.place_order(bb, jsonb_build_array(jsonb_build_object('product_id', pizza, 'quantity', 1, 'option_ids', jsonb_build_array(catupiry))),
                           'delivery_own', 'card_on_delivery', 'Carla', '35999990000', 'Rua Y, 2', null, null, null, 'chave-pedido-0003');
  perform tsto.ok((select subtotal_cents = 4800 and delivery_fee_cents = 700 and platform_delivery_fee_cents = 100 and courier_pay_cents = 0 from public.orders where id = o3),
                  'entrega própria: taxa da loja e tarifa da plataforma');
  perform tsto.login(cu2);
  perform tsto.denied(format($q$select public.update_order_status(%L, 'cancelled')$q$, o3), 'cancela pedido de outro');
  perform tsto.login(ownb);
  perform public.update_order_status(o3, 'accepted');
  perform public.update_order_status(o3, 'preparing');
  perform public.update_order_status(o3, 'ready');
  perform public.update_order_status(o3, 'out_for_delivery');
  perform public.update_order_status(o3, 'delivered');
  perform tsto.su();
  perform tsto.ok(tsto.count(format('select 1 from public.deliveries where order_id = %L', o3)) = 0, 'entrega própria não gera oferta');
  -- pedido pronto sem entregador pode ser cancelado pela loja e a oferta some
  perform tsto.login(cu1);
  o4 := public.place_order(ba, jsonb_build_array(jsonb_build_object('product_id', agua, 'quantity', 4)), 'delivery_partner', 'cash',
                           'Carla', '35999990000', 'Rua Z, 3, Bairro Alto', null, null, null, 'chave-pedido-0004');
  perform tsto.login(own);
  perform public.update_order_status(o4, 'accepted');
  perform public.update_order_status(o4, 'preparing');
  perform public.update_order_status(o4, 'ready');
  perform tsto.denied(format($q$select public.update_order_status(%L, 'cancelled')$q$, o4), 'loja cancela sem motivo', array['P0001']);
  perform public.update_order_status(o4, 'cancelled', 'Sem entregador disponível');
  perform tsto.su();
  perform tsto.ok((select status = 'cancelled' from public.deliveries where order_id = o4), 'oferta cancelada com o pedido');
  perform tsto.login(k1);
  perform tsto.ok(tsto.count('select * from public.courier_list_offers()') = 0, 'oferta cancelada some da lista');
  perform tsto.login(cu1);
  perform tsto.denied(format('select public.submit_review(%L, 4)', o4), 'avalia pedido cancelado', array['P0001']);
  perform tsto.su();

  -- ======================= 8. LGPD =======================
  perform private.anonymize_user(cu1);
  perform tsto.ok((select customer_name = 'Cliente removido' and delivery_address = 'Endereço removido' and notes is null from public.orders where id = o1),
                  'anonimização remove dados pessoais do pedido e mantém o valor');
  perform tsto.ok((select total_cents = 7400 from public.orders where id = o1), 'valor contábil preservado');
  perform private.anonymize_user(k2);
  perform tsto.ok((select status = 'delivered' and courier_id = k2 from public.deliveries where order_id = o1), 'histórico de entrega preservado sem o cadastro');
end $$;

-- funções internas fora da API
do $$
begin
  perform tsto.login('44440000-0000-0000-0000-0000000000c1');
  perform tsto.denied($q$select private.require_active_courier()$q$, 'cliente chama função interna');
  perform tsto.su();
  perform tsto.ok(not has_function_privilege('anon', 'public.courier_accept_delivery(uuid)', 'execute'), 'anon executa aceite');
  perform tsto.ok(not has_function_privilege('anon', 'public.business_sales_summary(uuid, integer)', 'execute'), 'anon executa relatório');
end $$;

do $$ begin raise notice 'RLS_ORDERS_OK'; end $$;
rollback;
