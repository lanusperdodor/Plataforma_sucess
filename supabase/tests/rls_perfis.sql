-- Testes da 0032 (quatro perfis + sete contas de teste). Tudo é revertido. Sucesso: NOTICE 'RLS_PERFIS_OK'.
-- Tudo é revertido. Sucesso: NOTICE 'RLS_ENTREGA_CODIGO_OK'.
begin;
create schema tspf;
grant usage on schema tspf to public;
create function tspf.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tspf.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tspf.blocked(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm like '%em manutenção%' then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido bloqueado pela manutenção)', msg;
end $$;
create function tspf.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tspf.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tspf.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tspf.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tspf.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tspf.step(msg text) returns void language plpgsql as $$ begin raise notice 'CHEESEBURGER: %', msg; end $$;
grant execute on all functions in schema tspf to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000001';
  m uuid; e1 uuid; e2 uuid; func uuid; k1 uuid; kp uuid; c1 uuid; c2 uuid; lan uuid; sup uuid;
  cheese text; arroz text; o1 uuid; o2 uuid; o3 uuid; oc2 uuid; res jsonb;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Perfis', 'MG', 'tspf-cidade');
  m := private.create_auth_user('pf-master@teste.invalid', 'senha-master-1', 'Master PF');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tspf.login(m);
  res := public.admin_create_test_data(city);
  perform tspf.su();
  e1 := tspf.uid('empresario1'); e2 := tspf.uid('empresario2'); func := tspf.uid('funcionario');
  k1 := tspf.uid('entregador'); kp := tspf.uid('entregador2'); c1 := tspf.uid('cliente1'); c2 := tspf.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id into sup from public.businesses where owner_id = e2;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';
  select id::text into arroz from public.products where business_id = sup and name = 'Arroz 5 kg';

  -- 7. login único: papéis e vínculos de cada conta (mesmo Supabase Auth)
  perform tspf.ok(jsonb_array_length(res->'logins') = 7, 'sete contas operacionais');
  perform tspf.ok((select member_role from public.business_members where business_id = lan and user_id = e1) = 'owner'
                  and (select member_role from public.business_members where business_id = sup and user_id = e2) = 'owner', 'empresários são donos dos seus estabelecimentos');
  perform tspf.ok((select member_role from public.business_members where user_id = func) = 'attendant' and (select count(*) from public.business_members where user_id = func) = 1, 'funcionário só na lanchonete');
  perform tspf.ok(exists (select 1 from public.user_roles where user_id = k1 and role = 'courier_partner') and exists (select 1 from public.couriers where user_id = k1 and status = 'approved'),
                  'entregador 1: parceiro independente aprovado');
  perform tspf.ok((select member_role from public.business_members where user_id = kp) = 'courier_own' and (select business_id from public.business_members where user_id = kp) = sup
                  and not exists (select 1 from public.user_roles where user_id = kp and role = 'courier_partner') and not exists (select 1 from public.couriers where user_id = kp),
                  'entregador 2: próprio do supermercado, fora da rede independente');
  perform tspf.ok((select array_agg(role::text order by role) from public.user_roles where user_id = c1) = (select array_agg(role::text order by role) from public.user_roles where user_id = c2)
                  and not exists (select 1 from public.business_members where user_id in (c1, c2)), '5. clientes com exatamente os mesmos papéis');
  perform tspf.ok(not exists (select 1 from public.user_roles r join private.test_data_runs t on r.user_id = any(t.user_ids) where r.role in ('platform_master', 'platform_operator')),
                  'nenhuma conta de teste com privilégio administrativo');
  perform tspf.ok(public.business_has_premium(lan) and not public.business_has_premium(sup), 'lanchonete Premium de homologação; supermercado no Padrão');

  -- 5/6. clientes compram ao mesmo tempo; privacidade entre eles
  perform tspf.login(k1); perform public.set_courier_online(true);
  perform tspf.login(c1);
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'pf-0000001');
  o3 := public.place_order(sup, jsonb_build_array(jsonb_build_object('product_id', arroz, 'quantity', 1)), 'delivery_own', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'pf-0000003');
  perform tspf.login(c2);
  oc2 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 2)), 'pickup', 'cash',
                            'Cliente 2', '(35) 99999-0002', null, null, null, null, 'pf-0000002');
  perform tspf.ok(tspf.count(format('select 1 from public.orders where id = %L', o1)) = 0, '6. Cliente 2 não vê pedido do Cliente 1');
  perform tspf.login(c1);
  perform tspf.ok(tspf.count(format('select 1 from public.orders where id = %L', oc2)) = 0 and tspf.count('select 1 from public.orders') = 2, '6. Cliente 1 vê só os próprios pedidos');
  perform tspf.denied(format($q$select public.update_order_status(%L, 'cancelled')$q$, oc2), 'Cliente 1 cancela pedido do Cliente 2');

  -- 1. empresários: cada um no seu estabelecimento
  perform tspf.login(e1);
  perform tspf.ok(public.merchant_overview(lan) is not null and tspf.count(format('select 1 from public.orders where business_id = %L', lan)) = 2, 'empresário 1 vê a lanchonete');
  perform tspf.ok(tspf.count(format('select 1 from public.orders where business_id = %L', sup)) = 0, 'empresário 1 não vê pedidos do supermercado');
  perform tspf.denied(format('select public.merchant_overview(%L)', sup), 'empresário 1 abre a visão geral do supermercado');
  perform tspf.denied(format($q$select public.merchant_invite_member(%L, 'x@teste.invalid', 'attendant')$q$, sup), 'empresário 1 mexe na equipe do supermercado');
  perform tspf.login(e2);
  perform tspf.ok(tspf.count(format('select 1 from public.orders where business_id = %L', sup)) = 1, 'empresário 2 vê o supermercado');
  perform tspf.ok(tspf.count(format('select 1 from public.orders where business_id = %L', lan)) = 0, 'empresário 2 não vê pedidos da lanchonete');
  perform tspf.denied(format('select public.merchant_overview(%L)', lan), 'empresário 2 abre a visão geral da lanchonete');
  perform tspf.denied(format('select * from public.gestao_board(%L)', lan), 'empresário 2 abre comandas da lanchonete');

  -- 2. funcionário: atendimento + cozinha, sem financeiro nem gestão
  perform tspf.login(func);
  perform tspf.ok(tspf.count(format('select 1 from public.orders where business_id = %L', lan)) = 2, 'funcionário vê os pedidos da lanchonete');
  perform public.merchant_accept_order(o1, 15);
  perform tspf.ok((select status from public.orders where id = o1) = 'preparing', 'funcionário aceita (já em preparo)');
  perform public.update_order_status(o1, 'ready');
  perform tspf.ok((select status from public.orders where id = o1) = 'ready', 'funcionário marca pronto');
  perform public.merchant_accept_order(oc2, 10);
  perform public.update_order_status(oc2, 'ready');
  perform public.update_order_status(oc2, 'picked_up');
  perform tspf.ok((select status from public.orders where id = oc2) = 'picked_up', 'funcionário encaminha a retirada');
  perform tspf.ok(public.gestao_open_tab(lan, null, 'Balcão 1', 1) is not null and tspf.count(format('select 1 from public.gestao_kitchen(%L)', lan)) >= 0, 'funcionário abre comanda e vê a cozinha');
  perform tspf.denied(format('select public.merchant_overview(%L)', lan), 'funcionário vê o financeiro/visão geral');
  perform tspf.denied(format('select public.merchant_finance(%L, current_date, current_date)', lan), 'funcionário vê Meu Lucro');
  perform tspf.denied(format('select * from public.merchant_costing(%L)', lan), 'funcionário vê a calculadora de custos');
  perform tspf.denied(format($q$select public.merchant_invite_member(%L, 'y@teste.invalid', 'attendant')$q$, lan), 'funcionário gerencia equipe');
  perform tspf.denied(format($q$select public.merchant_set_member_permission(%L, %L, 'cash.manage', true)$q$, lan, func), 'funcionário se dá permissões');
  perform tspf.denied(format('select public.gestao_open_cash(%L, 1000)', lan), 'funcionário opera caixa sem permissão');
  perform tspf.denied('select public.admin_coverage_summary()', 'funcionário acessa a administração da plataforma');

  -- 3. entregador independente: só ofertas de parceiro
  perform tspf.login(k1);
  perform tspf.ok(tspf.count(format('select 1 from public.courier_list_offers() where order_id = %L', o1)) = 1, 'independente recebe a oferta da lanchonete (parceiro)');
  perform tspf.ok(tspf.count(format('select 1 from public.courier_list_offers() where order_id = %L', o3)) = 0, 'independente não recebe entrega própria do supermercado');
  perform tspf.ok(tspf.count('select 1 from public.own_courier_deliveries(true)') = 0, 'independente não vê entregas próprias');
  perform tspf.su();
  perform tspf.ok(not exists (select 1 from public.deliveries where order_id = o3), 'entrega própria não vira oferta da rede');

  -- 4. entregador próprio: só o que o supermercado atribuir
  perform tspf.login(kp);
  perform tspf.denied('select * from public.courier_list_offers()', 'próprio lista ofertas da rede independente');
  perform tspf.ok(tspf.count(format('select 1 from public.orders where id = %L', o3)) = 0, 'próprio não vê pedido ainda não atribuído');
  perform tspf.ok(tspf.count(format('select 1 from public.orders where business_id = %L', lan)) = 0, 'próprio não vê pedidos de outra loja');
  perform tspf.login(func);
  perform tspf.denied(format('select public.merchant_assign_own_courier(%L, %L)', o3, kp), 'funcionário da lanchonete atribui entrega do supermercado');
  perform tspf.login(e2);
  perform tspf.denied(format('select public.merchant_assign_own_courier(%L, %L)', o3, k1), 'atribuir entregador independente como próprio', array['P0001']);
  perform public.merchant_accept_order(o3, 20);
  perform public.merchant_assign_own_courier(o3, kp);
  perform tspf.ok(tspf.count(format('select 1 from public.merchant_own_couriers(%L)', sup)) = 1, 'empresário lista seus entregadores próprios');
  perform tspf.login(kp);
  perform tspf.ok((select customer_name = 'Cliente 1' and delivery_address = 'Rua A, 1, Centro' from public.own_courier_deliveries(true) where order_id = o3), 'próprio vê a entrega atribuída com o necessário');
  perform tspf.ok(tspf.count(format('select 1 from public.orders where id = %L', o3)) = 1, 'próprio vê o pedido atribuído');
  perform tspf.denied(format($q$select public.own_courier_set_status(%L, 'out_for_delivery')$q$, o3), 'sai antes de pronto', array['P0001']);
  perform tspf.denied(format($q$select public.update_order_status(%L, 'ready')$q$, o3), 'próprio altera preparo da loja');
  perform tspf.login(e2);
  perform public.update_order_status(o3, 'ready');
  perform tspf.login(kp);
  perform public.own_courier_set_status(o3, 'out_for_delivery');
  perform public.own_courier_set_status(o3, 'delivered');
  perform tspf.ok(tspf.count('select 1 from public.own_courier_deliveries(false)') = 1 and tspf.count('select 1 from public.own_courier_deliveries(true)') = 0, 'próprio conclui e vê no histórico');
  perform tspf.denied(format($q$select public.own_courier_set_status(%L, 'delivered')$q$, o1), 'próprio conclui pedido que não é dele');
  perform tspf.login(c1);
  perform tspf.ok((select status from public.orders where id = o3) = 'delivered', 'cliente vê entregue pelo entregador próprio');
  perform tspf.su();
  perform tspf.ok(not exists (select 1 from public.notifications where user_id = kp and kind = 'order_new'), 'próprio não recebe avisos de pedido novo da loja');
  perform tspf.ok(exists (select 1 from public.notifications where user_id = kp and kind = 'delivery_offer'), 'próprio é avisado da entrega atribuída');

  -- 8/9. Master protegido; RLS direta
  perform tspf.login(e1);
  perform tspf.denied('select * from public.admin_list_test_data()', 'empresário acessa dados de teste do Master');
  perform tspf.login(m);
  perform tspf.ok(tspf.count('select 1 from public.admin_list_test_data()') = 1, '8. Master continua operando');
  perform tspf.anon();
  perform tspf.denied('select 1 from public.orders', '9. visitante lê pedidos');
  perform tspf.login(kp);
  perform tspf.ok(tspf.count('select 1 from public.business_tabs') = 0 and tspf.count('select 1 from public.cash_movements') = 0, '9. próprio não lê comandas nem caixa (RLS)');
  raise notice 'RLS_PERFIS_OK';
end $$;
rollback;
