-- Teste de ponta a ponta da homologação (0022), no banco: cliente → restaurante → cozinha → entregador → Master,
-- com as contas de homologação criadas pela função do Master e os papéis reais (RLS e permissões valem).
-- Tudo é revertido. Sucesso: NOTICE 'E2E_HOMOLOGACAO_OK'.
begin;
create schema tste;
grant usage on schema tste to public;
create function tste.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); set role authenticated; end $$;
create function tste.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tste.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tste.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tste.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tste.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tste.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tste.step(n int, msg text) returns void language plpgsql as $$ begin raise notice 'E2E passo %: %', n, msg; end $$;
grant execute on all functions in schema tste to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

do $$
declare
  city constant uuid := '22229000-0000-0000-0000-000000000001';
  m uuid; ownr uuid; cr uuid; kr uuid; breal uuid := '22221000-0000-0000-0000-000000000001'; preal text := '22223000-0000-0000-0000-000000000001';
  res jsonb; res2 jsonb;
  dono uuid; func uuid; coz uuid; k1 uuid; k2 uuid; c1 uuid; c2 uuid; op uuid; lojista uuid; prest uuid;
  brest uuid; burger text; salada text; refri text; ponto text; bacon text;
  items jsonb; o1 uuid; o1b uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid;
  code text; detail jsonb; r record; n int;
begin
  -- ---------- preparação: Master, um estabelecimento REAL com cliente e entregador REAIS na mesma cidade ----------
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Homologação', 'MG', 'tste-cidade');
  m := private.create_auth_user('e2e-master@teste.invalid', 'senha-master-1', 'Master E2E');
  ownr := private.create_auth_user('e2e-dono-real@teste.invalid', 'senha-real-1', 'Dono Real');
  cr := private.create_auth_user('e2e-cliente-real@teste.invalid', 'senha-real-2', 'Cliente Real');
  kr := private.create_auth_user('e2e-entregador-real@teste.invalid', 'senha-real-3', 'Entregador Real');
  insert into public.user_roles(user_id, role) values (m, 'platform_master'), (kr, 'courier_partner');
  insert into public.businesses(id, name, slug, owner_id, status, city_id, delivery_offer, accepts_pickup, min_order_cents, address_line)
  values (breal, 'Restaurante Real', 'tste-real', ownr, 'active', city, 'partner', true, 0, 'Rua Real, 1');
  insert into public.business_members(business_id, user_id, member_role) values (breal, ownr, 'owner');
  insert into public.business_hours(business_id, weekday, opens, closes) select breal, d, '00:00', '24:00' from generate_series(0, 6) d;
  insert into public.menu_categories(id, business_id, name) values ('22222000-0000-0000-0000-000000000001', breal, 'Pratos');
  insert into public.products(id, business_id, category_id, name, price_cents) values (preal::uuid, breal, '22222000-0000-0000-0000-000000000001', 'Prato real', 3000);
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, status, is_online, terms_version, terms_accepted_at)
  values (kr, 'Entregador Real', '35999990009', city, 'bicicleta', 'approved', true, 't1', now());

  -- ---------- contas de homologação: 9 perfis, sem duplicar ----------
  perform tste.login(m);
  res := public.admin_create_test_data(city);
  perform tste.ok(jsonb_array_length(res->'logins') = 10 and res->>'password' is not null and not (res->>'reused')::boolean, 'cria as 10 contas (9 perfis + 2º entregador)');
  res2 := public.admin_create_test_data(city);
  perform tste.ok((res2->>'reused')::boolean and jsonb_array_length(res2->'logins') = 0 and res2->>'password' is null, 'segunda chamada reaproveita o lote sem duplicar');
  perform tste.su();
  dono := tste.uid('restaurante'); func := tste.uid('funcionario'); coz := tste.uid('cozinha'); lojista := tste.uid('lojista');
  prest := tste.uid('prestador'); k1 := tste.uid('entregador'); k2 := tste.uid('entregador2'); c1 := tste.uid('cliente1'); c2 := tste.uid('cliente2');
  op := tste.uid('operador');
  perform tste.ok(dono is not null and func is not null and coz is not null and lojista is not null and prest is not null
                  and k1 is not null and k2 is not null and c1 is not null and c2 is not null and op is not null, 'todas as contas existem no Auth');
  perform tste.ok((select count(*) from auth.users where encrypted_password = extensions.crypt(res->>'password', encrypted_password) and email like '%@teste.example.com') = 10,
                  'senha das contas é a informada uma única vez');
  select id into brest from public.businesses where owner_id = dono;
  perform tste.ok((select is_test from public.businesses where id = brest) and (select count(*) from public.businesses where is_test) = 3, 'restaurante, loja e prestador marcados como teste');
  perform tste.ok((select member_role from public.business_members where business_id = brest and user_id = func) = 'attendant'
                  and (select member_role from public.business_members where business_id = brest and user_id = coz) = 'kitchen', 'funcionário e cozinha vinculados');
  select id::text into burger from public.products where business_id = brest and name = 'X-Burger';
  select id::text into salada from public.products where business_id = brest and name = 'X-Salada';
  select id::text into refri from public.products where business_id = brest and name = 'Refrigerante lata';
  select o.id::text into ponto from public.options o join public.option_groups g on g.id = o.group_id where g.product_id = burger::uuid and o.name = 'Ao ponto';
  select o.id::text into bacon from public.options o join public.option_groups g on g.id = o.group_id where g.product_id = burger::uuid and o.name = 'Bacon';

  -- ---------- separação teste x produção ----------
  perform tste.anon();
  perform tste.ok(tste.count(format('select 1 from public.public_businesses where id = %L', brest)) = 0, 'visitante não vê estabelecimento de teste');
  perform tste.ok(tste.count(format('select 1 from public.public_businesses where id = %L', breal)) = 1, 'visitante vê o real');
  perform tste.login(cr);
  perform tste.ok(tste.count(format('select 1 from public.public_businesses where id = %L', brest)) = 0, 'cliente real não vê estabelecimento de teste');
  perform tste.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Cliente Real', '35999990000', null, null, null, null, 'real-em-teste-1')$q$,
                             brest, jsonb_build_array(jsonb_build_object('product_id', refri, 'quantity', 2))), 'cliente real compra em loja de teste', array['P0001']);
  perform tste.login(c1);
  perform tste.ok(tste.count(format('select 1 from public.public_businesses where id = %L', brest)) = 1, 'cliente de teste vê o restaurante de homologação');
  perform tste.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'Cliente Teste', '35999990000', null, null, null, null, 'teste-em-real-1')$q$,
                             breal, jsonb_build_array(jsonb_build_object('product_id', preal, 'quantity', 1))), 'conta de teste compra em loja real', array['P0001']);
  perform tste.login(dono);
  perform tste.denied(format('update public.businesses set is_test = false where id = %L', brest), 'dono desmarca o teste', array['42501']);

  -- ======================= CENÁRIO OBRIGATÓRIO =======================
  -- 1-4. cliente entra, escolhe o restaurante, adiciona dois produtos e finaliza (pagamento na entrega: sem cobrança online)
  perform tste.login(c1);
  perform tste.step(1, 'cliente de teste autenticado');
  items := jsonb_build_array(
    jsonb_build_object('product_id', burger, 'quantity', 1, 'option_ids', jsonb_build_array(ponto, bacon), 'price_cents', 1),
    jsonb_build_object('product_id', salada, 'quantity', 1));
  o1 := public.place_order(brest, items, 'delivery_partner', 'pix_on_delivery', 'Cliente Teste Um', '(35) 99999-0000', 'Rua das Flores, 100, Centro',
                           'Portão azul', null, null, 'e2e-pedido-0001');
  o1b := public.place_order(brest, items, 'delivery_partner', 'pix_on_delivery', 'Cliente Teste Um', '(35) 99999-0000', 'Rua das Flores, 100, Centro',
                            'Portão azul', null, null, 'e2e-pedido-0001');
  perform tste.ok(o1 = o1b, 'clique duplo não duplica o pedido (idempotência)');
  perform tste.step(4, 'pedido criado');
  perform tste.ok((select subtotal_cents = 5800 and delivery_fee_cents = 400 and total_cents = 6200 and commission_cents = 116
                          and merchant_delivery_contribution_cents = 200 and courier_pay_cents = 500 and platform_delivery_fee_cents = 100 and is_test
                     from public.orders where id = o1), 'valores calculados no servidor (2% acima de R$ 50; R$ 4 / 2 / 5 / 1)');
  select o.code into code from public.orders o where o.id = o1;

  -- 5. restaurante recebe
  perform tste.login(func);
  perform tste.ok(tste.count(format('select 1 from public.orders where id = %L and status = %L', o1, 'placed')) = 1, 'funcionário vê o pedido novo');
  perform tste.ok(tste.count(format('select 1 from public.order_items where order_id = %L', o1)) = 2, 'itens visíveis');
  perform tste.su();
  perform tste.ok(exists (select 1 from public.notifications where user_id = dono and kind = 'order_new')
                  and exists (select 1 from public.notifications where user_id = coz and kind = 'order_new'), 'equipe notificada do pedido novo');
  perform tste.step(5, 'restaurante recebeu');
  -- cozinha não aceita nem recusa
  perform tste.login(coz);
  perform tste.denied(format('select public.merchant_accept_order(%L, 20)', o1), 'cozinha aceita pedido');
  perform tste.denied(format($q$select public.update_order_status(%L, 'rejected', 'x')$q$, o1), 'cozinha recusa pedido', array['P0001']);
  -- 6. restaurante confirma com tempo estimado
  perform tste.login(func);
  perform tste.denied(format('select public.merchant_accept_order(%L, 2)', o1), 'tempo de preparo inválido', array['P0001']);
  perform public.merchant_accept_order(o1, 20);
  perform tste.ok((select status = 'accepted' and prep_minutes = 20 and estimated_ready_at > now() from public.orders where id = o1), 'aceito com previsão');
  perform tste.step(6, 'restaurante confirmou');
  -- 7-8. cozinha prepara e disponibiliza
  perform tste.login(coz);
  perform public.update_order_status(o1, 'preparing');
  perform tste.denied(format($q$select public.update_order_status(%L, 'cancelled', 'x')$q$, o1), 'cozinha cancela', array['P0001']);
  perform tste.step(7, 'cozinha preparando');
  -- entregadores de teste ficam disponíveis antes de o pedido ficar pronto
  perform tste.login(k1); perform public.set_courier_online(true);
  perform tste.login(k2); perform public.set_courier_online(true);
  perform tste.login(coz);
  perform public.update_order_status(o1, 'ready');
  perform tste.su();
  perform tste.ok((select status = 'offered' and is_test and offer_round = 1 and offer_expires_at > now() from public.deliveries where order_id = o1), 'oferta criada com prazo');
  perform tste.step(8, 'disponível para coleta');
  -- 9. entregadores de teste recebem a oferta; o real, não
  perform tste.ok(exists (select 1 from public.notifications where user_id = k1 and kind = 'delivery_offer')
                  and exists (select 1 from public.notifications where user_id = k2 and kind = 'delivery_offer'), 'entregadores de teste notificados');
  perform tste.ok(not exists (select 1 from public.notifications where user_id = kr and kind = 'delivery_offer'), 'entregador real não recebe oferta de teste');
  perform tste.login(kr);
  perform tste.ok(tste.count('select 1 from public.courier_list_offers()') = 0, 'entregador real não lista oferta de teste');
  perform tste.denied(format('select public.courier_accept_delivery(%L)', o1), 'entregador real aceita oferta de teste', array['P0001']);
  perform tste.login(k1);
  select * into r from public.courier_list_offers() where order_id = o1;
  perform tste.ok(r.courier_pay_cents = 500 and r.items_count = 2 and r.neighborhood_hint = 'Centro', 'oferta com remuneração e bairro, sem dados do cliente');
  perform tste.step(9, 'entregador recebeu a oferta');
  -- 10. aceite atômico: o segundo entregador perde
  perform public.courier_accept_delivery(o1);
  perform tste.login(k2);
  perform tste.denied(format('select public.courier_accept_delivery(%L)', o1), 'dois entregadores aceitam a mesma entrega', array['P0001']);
  perform tste.ok(tste.count(format('select 1 from public.orders where id = %L', o1)) = 0, 'outro entregador não vê o pedido');
  perform tste.step(10, 'entregador aceitou');
  -- 11. coleta
  perform tste.login(k1);
  perform tste.ok((select customer_name = 'Cliente Teste Um' and delivery_address = 'Rua das Flores, 100, Centro' from public.courier_my_deliveries(true) where order_id = o1),
                  'após o aceite o entregador vê endereço e cliente');
  perform public.courier_pickup_delivery(o1);
  perform tste.login(c1);
  perform tste.ok((select status from public.orders where id = o1) = 'out_for_delivery', 'cliente vê que saiu para entrega');
  perform tste.step(11, 'coletado');
  -- 12. conclusão com o código que só o cliente vê
  perform tste.login(k1);
  perform public.courier_complete_delivery(o1, 'xxxx');
  perform tste.ok((select status from public.courier_my_deliveries(true) where order_id = o1) = 'picked_up', 'código errado não conclui');
  perform tste.login(c1);
  select confirmation_code into code from public.my_delivery(o1);
  perform tste.login(k1);
  perform public.courier_complete_delivery(o1, code);
  perform tste.step(12, 'entrega concluída');
  -- 13. cliente vê entregue (estado recuperado ao recarregar: tudo está no banco)
  perform tste.login(c1);
  perform tste.ok((select status from public.orders where id = o1) = 'delivered', 'cliente vê entregue');
  perform tste.ok(exists (select 1 from public.notifications where user_id = c1 and kind = 'order_update' and message like '%entregue%'), 'cliente notificado');
  perform tste.step(13, 'cliente vê entregue');
  perform tste.login(k1);
  perform tste.ok((public.courier_earnings()->>'total_cents')::int = 500 and (public.courier_earnings()->>'deliveries')::int = 1, 'ganhos do entregador');
  perform tste.ok(tste.count('select 1 from public.courier_my_deliveries(false)') = 1, 'histórico do entregador');
  -- 14. Master e operador veem o histórico completo
  perform tste.login(m);
  perform tste.ok(tste.count($q$select 1 from public.admin_list_orders('concluidos')$q$) = 1, 'Master lista o pedido concluído');
  detail := public.admin_order_detail(o1);
  perform tste.ok(jsonb_array_length(detail->'events') >= 7 and detail->'delivery'->>'status' = 'delivered'
                  and detail->'delivery'->'courier'->>'name' = 'Entregador Teste' and (detail->>'is_test')::boolean, 'detalhe com eventos, entrega e entregador');
  perform tste.ok((select string_agg(e->>'actor', ',' order by ord) from jsonb_array_elements(detail->'events') with ordinality t(e, ord))
                  = 'cliente,estabelecimento,estabelecimento,estabelecimento,entregador,entregador,entregador', 'quem fez cada passo');
  perform tste.step(14, 'Master vê histórico');
  perform tste.login(op);
  perform tste.ok(tste.count($q$select 1 from public.admin_list_orders('todos')$q$) >= 1, 'operador administrativo acompanha pedidos');
  perform tste.denied(format($q$select public.admin_cancel_order(%L, 'teste')$q$, o1), 'operador sem orders.manage cancela');
  -- 15. valores e eventos no banco
  perform tste.su();
  perform tste.ok((select string_agg(status::text, ',' order by created_at, id) from public.order_events where order_id = o1)
                  = 'placed,accepted,preparing,ready,ready,out_for_delivery,delivered', 'sequência de eventos gravada');
  perform tste.ok((select status = 'delivered' and courier_id = k1 and delivered_at is not null and courier_pay_cents = 500 from public.deliveries where order_id = o1), 'entrega gravada');
  perform tste.ok(private.platform_fees(null, now() - interval '1 day', now() + interval '1 day') = 0, 'pedido de teste fora do financeiro da plataforma');
  perform tste.ok(exists (select 1 from public.audit_logs where action = 'delivery.accept' and entity_id = o1::text)
                  and exists (select 1 from public.audit_logs where action = 'delivery.complete' and entity_id = o1::text), 'auditoria do despacho');
  perform tste.step(15, 'valores e eventos conferidos');

  -- ======================= FALHAS =======================
  -- restaurante recusa
  perform tste.login(c1);
  o2 := public.place_order(brest, jsonb_build_array(jsonb_build_object('product_id', refri, 'quantity', 2)), 'pickup', 'cash',
                           'Cliente Teste Um', '35999990000', null, null, null, null, 'e2e-pedido-0002');
  perform tste.login(dono);
  perform tste.denied(format($q$select public.update_order_status(%L, 'rejected')$q$, o2), 'recusa sem motivo', array['P0001']);
  perform public.update_order_status(o2, 'rejected', 'Sem gás no momento');
  perform tste.login(c1);
  perform tste.ok((select status = 'rejected' and rejection_reason = 'Sem gás no momento' from public.orders where id = o2), 'cliente vê a recusa e o motivo');

  -- cliente cancela antes do aceite
  o3 := public.place_order(brest, jsonb_build_array(jsonb_build_object('product_id', refri, 'quantity', 2)), 'pickup', 'cash',
                           'Cliente Teste Um', '35999990000', null, null, null, null, 'e2e-pedido-0003');
  perform public.update_order_status(o3, 'cancelled');
  perform tste.ok((select status from public.orders where id = o3) = 'cancelled', 'cliente cancela antes do aceite');

  -- entregadores recusam, a oferta expira, é redistribuída e gera alerta
  o4 := public.place_order(brest, jsonb_build_array(jsonb_build_object('product_id', salada, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente Teste Um', '35999990000', 'Rua B, 2, Centro', null, null, null, 'e2e-pedido-0004');
  perform tste.login(dono);
  perform public.merchant_accept_order(o4, 15);
  perform public.update_order_status(o4, 'preparing');
  perform public.update_order_status(o4, 'ready');
  perform tste.login(k1); perform public.courier_decline_delivery(o4);
  perform tste.ok(tste.count('select 1 from public.courier_list_offers()') = 0, 'recusada some da lista de quem recusou');
  perform tste.login(k2);
  perform tste.ok(tste.count('select 1 from public.courier_list_offers()') = 1, 'continua para o outro entregador');
  perform public.courier_decline_delivery(o4);
  perform tste.su();
  perform tste.ok((select offer_round from public.deliveries where order_id = o4) = 2, 'todos recusaram: nova rodada imediata');
  perform tste.login(k1);
  perform tste.ok(tste.count('select 1 from public.courier_list_offers()') = 1, 'na nova rodada a oferta volta para todos');
  perform tste.su();
  update public.deliveries set offer_expires_at = now() - interval '1 minute' where order_id = o4;
  perform private.sweep_deliveries();
  perform tste.ok((select offer_round from public.deliveries where order_id = o4) = 3, 'prazo expirado: redistribuída');
  update public.deliveries set offer_expires_at = now() - interval '1 minute' where order_id = o4;
  perform private.sweep_deliveries();
  perform tste.ok((select attention_reason is not null from public.deliveries where order_id = o4), 'sem entregador após as rodadas: alerta');
  perform tste.ok(exists (select 1 from public.notifications where user_id = m and kind = 'ops_alert')
                  and exists (select 1 from public.notifications where user_id = dono and kind = 'ops_alert'), 'Master e restaurante alertados');
  perform tste.login(m);
  perform tste.ok(tste.count($q$select 1 from public.admin_list_orders('atencao') where attention is not null$q$) = 1, 'Master vê a falha operacional');
  perform public.admin_redispatch(o4);
  perform tste.su();
  perform tste.ok((select offer_round = 1 and attention_reason is null and status = 'offered' from public.deliveries where order_id = o4), 'Master redistribui');
  -- Master cancela com motivo (ocorrência) e a entrega é cancelada junto
  perform tste.login(m);
  perform tste.denied(format($q$select public.admin_cancel_order(%L, '')$q$, o4), 'cancelamento sem motivo', array['P0001']);
  perform public.admin_cancel_order(o4, 'Restaurante sem entregador disponível');
  perform tste.su();
  perform tste.ok((select status from public.orders where id = o4) = 'cancelled' and (select status from public.deliveries where order_id = o4) = 'cancelled', 'ocorrência tratada');
  perform tste.ok(exists (select 1 from public.audit_logs where action = 'orders.cancel' and entity_id = o4::text), 'cancelamento auditado');

  -- entregador libera antes da coleta: a oferta volta para os outros
  perform tste.login(c1);
  o5 := public.place_order(brest, jsonb_build_array(jsonb_build_object('product_id', salada, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente Teste Um', '35999990000', 'Rua C, 3, Centro', null, null, null, 'e2e-pedido-0005');
  perform tste.login(dono);
  perform public.merchant_accept_order(o5, 10);
  perform public.update_order_status(o5, 'preparing');
  perform public.update_order_status(o5, 'ready');
  perform tste.login(k2); perform public.courier_accept_delivery(o5); perform public.courier_release_delivery(o5);
  perform tste.ok(tste.count('select 1 from public.courier_list_offers()') = 0, 'quem liberou não recebe de novo na mesma rodada');
  perform tste.login(k1);
  perform tste.ok(tste.count('select 1 from public.courier_list_offers()') = 1, 'oferta reaberta para os demais');
  -- localização só quando o entregador compartilha, e é apagada ao ficar indisponível
  perform public.courier_update_location(-20.7389, -47.2486);
  perform public.set_courier_online(false);
  perform tste.su();
  perform tste.ok((select last_lat is null and last_location_at is null from public.couriers where user_id = k1), 'localização apagada ao ficar offline');

  -- acessos não autorizados
  perform tste.login(c2);
  perform tste.ok(tste.count(format('select 1 from public.orders where id = %L', o1)) = 0, 'cliente não vê pedido de outro cliente');
  perform tste.ok(tste.count(format('select 1 from public.my_delivery(%L)', o1)) = 0, 'cliente não vê código de outro');
  perform tste.denied(format($q$select public.update_order_status(%L, 'cancelled')$q$, o5), 'cliente mexe em pedido de outro');
  perform tste.login(ownr);
  perform tste.ok(tste.count(format('select 1 from public.orders where id in (%L, %L)', o1, o5)) = 0, 'outro estabelecimento não vê os pedidos');
  perform tste.denied(format($q$select public.update_order_status(%L, 'cancelled', 'x')$q$, o5), 'outro estabelecimento altera pedido');
  perform tste.login(lojista);
  perform tste.ok(tste.count(format('select 1 from public.orders where id = %L', o1)) = 0, 'lojista de outra loja de teste não vê');
  perform tste.login(c1);
  perform tste.denied('select * from public.admin_list_orders()', 'cliente acessa painel Master');
  perform tste.anon();
  perform tste.denied('select 1 from public.orders', 'sessão perdida: pedidos inacessíveis');
  perform tste.denied(format($q$select public.place_order(%L, %L, 'pickup', 'cash', 'X', '35999990000', null, null, null, null, 'anon-0000001')$q$,
                             brest, jsonb_build_array(jsonb_build_object('product_id', refri, 'quantity', 2))), 'sessão perdida: não pede');
end $$;

do $$ begin raise notice 'E2E_HOMOLOGACAO_OK'; end $$;
rollback;
