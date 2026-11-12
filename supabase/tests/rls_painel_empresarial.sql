-- Testes da 0026 (central do lojista). Tudo é revertido. Sucesso: NOTICE 'RLS_PAINEL_EMPRESARIAL_OK'.
begin;
create schema tspe;
grant usage on schema tspe to public;
create function tspe.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); set role authenticated; end $$;
create function tspe.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tspe.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tspe.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tspe.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tspe.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tspe to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '66669000-0000-0000-0000-000000000001';
  m uuid; c1 uuid; loj uuid; dono uuid; func uuid; coz uuid; k1 uuid; k2 uuid; bm uuid; br uuid; cheese text; salada text;
  o uuid; o2 uuid; res jsonb; r record; ing1 uuid; ing2 uuid; nu uuid;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Empresa', 'MG', 'tspe-cidade');
  m := private.create_auth_user('pe-master@teste.invalid', 'senha-master-1', 'Master PE');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tspe.login(m);
  res := public.admin_create_test_data(city);
  perform tspe.su();
  c1 := tspe.uid('cliente1'); loj := tspe.uid('lojista'); dono := tspe.uid('restaurante'); func := tspe.uid('funcionario');
  coz := tspe.uid('cozinha'); k1 := tspe.uid('entregador'); k2 := tspe.uid('entregador2');
  select id into bm from public.businesses where owner_id = loj;
  select id into br from public.businesses where owner_id = dono;
  select id::text into cheese from public.products where business_id = bm and name = 'Cheeseburger';
  select id::text into salada from public.products where business_id = br and name = 'X-Salada';

  -- planos: Mercadinho de teste com Premium por concessão de homologação; restaurante sem plano (Padrão = sem Premium)
  perform tspe.login(loj);
  res := public.business_plan(bm);
  perform tspe.ok((res->>'premium')::boolean and res->>'source' = 'homologacao' and res->>'plan_name' = 'Premium', 'Mercadinho: Premium de homologação');
  perform tspe.su();
  perform tspe.ok(exists (select 1 from public.audit_logs where action = 'plan.test_grant' and entity_id = bm::text), 'concessão auditada');
  perform tspe.ok(not exists (select 1 from public.business_subscriptions where business_id = bm), 'nenhuma assinatura falsa criada');
  perform tspe.login(dono);
  perform tspe.ok(not public.business_has_premium(br), 'restaurante sem Premium');
  perform tspe.denied(format('select * from public.merchant_costing(%L)', br), 'Padrão abre a calculadora');
  perform tspe.denied(format('select public.merchant_finance(%L, current_date, current_date)', br), 'Padrão abre Meu Lucro');
  perform tspe.denied(format($q$insert into public.business_expenses(business_id, category, amount_cents, spent_on) values (%L, 'aluguel', 1000, current_date)$q$, br), 'Padrão grava gasto direto na tabela');
  perform tspe.ok(public.merchant_overview(br) is not null, 'visão geral liberada em qualquer plano');
  perform tspe.login(m);
  perform tspe.denied(format($q$select public.admin_grant_test_plan(%L, 'presencial_delivery', 'tentativa em loja real')$q$, gen_random_uuid()), 'concessão em loja que não é de teste', array['P0001']);
  perform tspe.login(loj);
  perform tspe.denied(format($q$select public.admin_grant_test_plan(%L, 'presencial_delivery', 'auto concessão')$q$, bm), 'lojista se concede Premium');
  perform public.merchant_request_plan_change(bm, 'delivery');
  perform tspe.su();
  perform tspe.ok(exists (select 1 from public.notifications where user_id = m and kind = 'ops_alert' and message like '%pediu o plano Padrão%'), 'pedido de mudança de plano chega ao Master');

  -- oferta antecipada: o entregador vê o pedido assim que é feito, com a situação do preparo
  perform tspe.login(k1); perform public.set_courier_online(true);
  perform tspe.login(c1);
  o := public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                          'Cliente Teste Um', '35999990000', 'Rua das Flores, 100, Centro', null, null, null, 'pe-0000001');
  perform tspe.su();
  perform tspe.ok(exists (select 1 from public.notifications where user_id = loj and kind = 'order_new' and message = 'Novo pedido #' || (select code from public.orders where id = o) || ' — 1× Cheeseburger'),
                  'aviso de pedido novo traz os itens');
  perform tspe.login(k1);
  select * into r from public.courier_list_offers() x where x.order_id = o;
  perform tspe.ok(r.order_status = 'placed' and r.business_name like '[Teste] Mercadinho%' and r.city_name = 'Cidade Empresa' and r.courier_pay_cents = 500, 'oferta antecipada com estabelecimento, cidade, valor e preparo');
  perform public.courier_accept_delivery(o);
  perform tspe.ok((select delivery_address = 'Centro' and customer_name is null from public.courier_my_deliveries(true) where order_id = o), 'antes do aceite da loja: só o bairro, sem dados do cliente');
  perform tspe.denied(format('select public.courier_pickup_delivery(%L)', o), 'coleta antes de pronto', array['P0001']);
  -- operador de comandas: o lojista convida o funcionário (conta já existente) como atendente do Mercadinho
  perform tspe.su();
  res := jsonb_build_object('email', (select email from auth.users where id = func));
  perform tspe.login(loj);
  perform tspe.ok(public.merchant_invite_member(bm, res->>'email', 'attendant') = 'vinculado', 'funcionário vira operador de comandas');
  perform tspe.login(c1);
  perform tspe.denied(format('select public.merchant_accept_order(%L, 15)', o), 'cliente aceita o próprio pedido');
  perform tspe.login(func);
  perform tspe.denied(format('select public.merchant_overview(%L)', bm), 'comandas vê o financeiro');
  perform public.merchant_accept_order(o, 15);
  perform tspe.su();
  perform tspe.ok((select actor_id from public.order_events where order_id = o and status = 'accepted') = func, 'registra quem aceitou');
  perform tspe.login(k1);
  perform tspe.ok((select delivery_address = 'Rua das Flores, 100, Centro' and order_status = 'preparing' from public.courier_my_deliveries(true) where order_id = o), 'depois do aceite: endereço completo e preparo visível');
  perform tspe.login(func);
  perform public.update_order_status(o, 'ready');
  perform tspe.su();
  perform tspe.ok(exists (select 1 from public.notifications where user_id = k1 and message like '%pronto para coleta%'), 'entregador avisado que ficou pronto');
  perform tspe.login(k1);
  perform public.courier_pickup_delivery(o);
  perform tspe.login(c1);
  perform tspe.ok((select status from public.orders where id = o) = 'out_for_delivery', 'cliente vê a caminho');

  -- recusa depois de entregador aceitar: entrega cancelada e entregador avisado
  perform tspe.login(k2); perform public.set_courier_online(true);
  perform tspe.login(c1);
  o2 := public.place_order(br, jsonb_build_array(jsonb_build_object('product_id', salada, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente Teste Um', '35999990000', 'Rua B, 2, Centro', null, null, null, 'pe-0000002');
  perform tspe.login(k2); perform public.courier_accept_delivery(o2);
  perform tspe.login(dono); perform public.update_order_status(o2, 'rejected', 'Acabou o pão');
  perform tspe.su();
  perform tspe.ok((select status from public.deliveries where order_id = o2) = 'cancelled'
                  and exists (select 1 from public.notifications where user_id = k2 and message like '%recusado%'), 'recusa cancela a entrega e avisa o entregador');

  -- calculadora (Premium): ingredientes, ficha técnica, embalagem, margem, preço sugerido e histórico
  perform tspe.login(loj);
  insert into public.business_ingredients(business_id, name, unit, purchase_cost_cents, purchase_qty) values (bm, 'Pão', 'un', 1200, 12) returning id into ing1;   -- R$ 1,00/un
  insert into public.business_ingredients(business_id, name, unit, purchase_cost_cents, purchase_qty) values (bm, 'Carne', 'kg', 4000, 1) returning id into ing2;  -- R$ 40/kg
  insert into public.product_recipe_items(product_id, ingredient_id, business_id, quantity) values (cheese::uuid, ing1, bm, 1), (cheese::uuid, ing2, bm, 0.15);  -- 1,00 + 6,00
  insert into public.business_product_costs(product_id, business_id, packaging_cents, operational_cents, target_margin_bps) values (cheese::uuid, bm, 100, 50, 5000);
  select * into r from public.merchant_costing(bm) x where x.product_id = cheese::uuid;
  perform tspe.ok(r.recipe_cents = 700 and r.unit_cost_cents = 850 and r.fee_cents = 0 and r.margin_cents = 1350 and r.margin_bps = 6136 and r.suggested_price_cents = 1700,
                  'custo: ficha técnica + embalagem + operacional; margem e preço sugerido');
  perform public.merchant_save_costing_snapshot(bm, cheese::uuid);
  perform tspe.ok(tspe.count(format('select 1 from public.business_costing_snapshots where business_id = %L', bm)) = 1, 'histórico de cálculo');
  perform tspe.login(dono);
  perform tspe.ok(tspe.count(format('select 1 from public.business_ingredients where business_id = %L', bm)) = 0, 'outra loja não vê ingredientes');

  -- equipe: dono convida (conta existente vira integrante; e-mail novo fica convidado e entra ao ativar)
  perform tspe.login(func);
  perform tspe.denied(format($q$select public.merchant_invite_member(%L, 'x@teste.invalid', 'kitchen')$q$, bm), 'comandas convida integrante');
  perform tspe.login(loj);
  perform tspe.ok(public.merchant_invite_member(bm, 'PE-MASTER@teste.invalid', 'attendant') = 'vinculado', 'conta existente vira integrante');
  perform tspe.ok(public.merchant_invite_member(bm, 'nova.comanda@teste.invalid', 'attendant') = 'convidado', 'e-mail novo fica convidado');
  perform tspe.denied(format($q$select public.merchant_invite_member(%L, 'y@teste.invalid', 'owner')$q$, bm), 'convida proprietário', array['P0001', '22P02']);
  perform tspe.ok(tspe.count(format('select 1 from public.merchant_team(%L) where pending', bm)) = 1, 'convite pendente listado');
  perform tspe.su();
  nu := private.create_auth_user('nova.comanda@teste.invalid', 'senha-nova-1', 'Nova Comanda');
  perform tspe.ok((select member_role from public.business_members where business_id = bm and user_id = nu) = 'attendant', 'convite aplicado ao ativar a conta');
  perform tspe.login(loj);
  perform public.merchant_set_member_role(bm, nu, 'kitchen');
  perform tspe.denied(format('select public.merchant_remove_member(%L, %L)', bm, loj), 'remove a si mesmo/proprietário', array['P0001']);
  perform public.merchant_remove_member(bm, nu);
  perform tspe.su();
  perform tspe.ok(not exists (select 1 from public.business_members where business_id = bm and user_id = nu), 'integrante removido');
  perform tspe.ok((select count(*) from public.audit_logs where action like 'business.member%' and entity_id = bm::text) >= 4, 'equipe auditada');

  -- visão geral com números reais
  perform tspe.login(loj);
  res := public.merchant_overview(bm);
  perform tspe.ok((res->>'recebidos_hoje')::int >= 1 and (res->>'em_andamento')::int >= 1 and (res->>'premium')::boolean and jsonb_array_length(res->'serie') = 14, 'visão geral do dia e série de 14 dias');
end $$;

do $$ begin raise notice 'RLS_PAINEL_EMPRESARIAL_OK'; end $$;
rollback;
