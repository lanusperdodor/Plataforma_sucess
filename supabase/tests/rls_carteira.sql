-- Testes da 0036 (carteira do entregador, saques e custo de entrega correto). Tudo é revertido. Sucesso: NOTICE 'RLS_CARTEIRA_OK'.
begin;
create schema tscw;
grant usage on schema tscw to public;
create function tscw.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tscw.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tscw.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tscw.denied(stmt text, msg text, codes text[] default array['42501', 'P0001']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tscw.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tscw.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tscw to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000036';
  m uuid; e1 uuid; k1 uuid; c1 uuid; lan uuid; cheese text; o1 uuid; o2 uuid; o3 uuid; w jsonb; wid uuid; money jsonb; ov jsonb;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Carteira', 'MG', 'tscw-cidade');
  m := private.create_auth_user('cw-master@teste.invalid', 'senha-master-1', 'Master CW');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tscw.login(m);
  perform public.admin_create_test_data(city);
  perform tscw.su();
  e1 := tscw.uid('empresario1'); k1 := tscw.uid('entregador'); c1 := tscw.uid('cliente1');
  select id into lan from public.businesses where owner_id = e1;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';

  perform tscw.login(c1);
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'cw-0000001');
  o2 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'cw-0000002');
  o3 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'cw-0000003');
  perform tscw.su();
  -- regra gravada no pedido: cliente 4 + loja 2 = entregador 5 + Tucaí 1
  perform tscw.ok((select delivery_fee_cents = 400 and merchant_delivery_contribution_cents = 200 and courier_pay_cents = 500 and platform_delivery_fee_cents = 100
                     from public.orders where id = o1), 'repasse 4 + 2 = 5 + 1 gravado no pedido');
  -- duas entregas concluídas há 8 dias (já liberadas), uma hoje (guardada)
  perform set_config('tucai.internal', 'on', true);
  update public.orders set status = 'delivered' where id in (o1, o2, o3);
  update public.deliveries set status = 'delivered', courier_id = k1, accepted_at = now() - interval '8 days', delivered_at = now() - interval '8 days' where order_id in (o1, o2);
  update public.deliveries set status = 'delivered', courier_id = k1, accepted_at = now(), delivered_at = now() where order_id = o3;
  perform set_config('tucai.internal', 'off', true);

  perform tscw.login(k1);
  w := public.courier_wallet();
  perform tscw.ok((w->>'ganho_total_cents')::int = 1500 and (w->>'guardado_cents')::int = 500 and (w->>'disponivel_cents')::int = 1000, 'carteira: 15 ganhos, 5 guardados, 10 disponíveis: ' || w::text);
  perform tscw.ok((w->>'deliveries_today')::int = 1 and (w->>'today_cents')::int = 500 and (w->>'deliveries_month')::int >= 1
                  and (w->>'month_cents')::int = case when date_trunc('month', now() at time zone 'America/Sao_Paulo') <= (now() - interval '8 days') at time zone 'America/Sao_Paulo' then 1500 else 500 end,
                  'resumo de hoje e do mês (0038): ' || w::text);
  perform tscw.ok(jsonb_array_length(w->'liberacoes') = 1 and (w->'liberacoes'->0->>'cents')::int = 500, 'próxima liberação: 5 daqui a 7 dias');
  perform tscw.denied($q$select public.courier_request_withdrawal('  ')$q$, 'saque sem chave Pix');
  w := public.courier_request_withdrawal('chave@pix.example');
  perform tscw.ok((w->>'amount_cents')::int = 1000, 'saque leva todo o disponível');
  wid := (w->>'id')::uuid;
  perform tscw.denied($q$select public.courier_request_withdrawal('chave@pix.example')$q$, 'um saque em análise por vez');
  w := public.courier_wallet();
  perform tscw.ok((w->>'disponivel_cents')::int = 0 and (w->>'em_saque_cents')::int = 1000, 'valor em análise sai do disponível');
  perform tscw.ok(tscw.count('select 1 from public.courier_withdrawals') = 1, 'entregador vê o próprio saque');
  perform tscw.denied(format($q$select public.admin_decide_withdrawal(%L, 'pago')$q$, wid), 'entregador não aprova o próprio saque');
  perform tscw.denied(format($q$update public.courier_withdrawals set status = 'pago' where id = %L$q$, wid), 'gravação direta bloqueada');

  -- outros perfis não veem nem mexem
  perform tscw.login(c1);
  perform tscw.ok(tscw.count('select 1 from public.courier_withdrawals') = 0, 'cliente não vê saques');
  perform tscw.denied('select public.courier_wallet()', 'cliente não tem carteira');
  perform tscw.denied($q$select * from public.admin_courier_withdrawals()$q$, 'cliente não lista saques');

  -- Master recusa (volta ao disponível), entregador pede de novo, Master paga
  perform tscw.login(m);
  perform tscw.ok(tscw.count($q$select 1 from public.admin_courier_withdrawals('solicitado')$q$) = 1, 'Master vê o pedido de saque');
  perform tscw.denied(format($q$select public.admin_decide_withdrawal(%L, 'recusado', '')$q$, wid), 'recusa exige motivo');
  perform public.admin_decide_withdrawal(wid, 'recusado', 'Chave Pix inválida');
  perform tscw.login(k1);
  perform tscw.ok((public.courier_wallet()->>'disponivel_cents')::int = 1000, 'recusado: valor volta ao disponível');
  wid := (public.courier_request_withdrawal('11999990000')->>'id')::uuid;
  perform tscw.login(m);
  perform public.admin_decide_withdrawal(wid, 'pago');
  perform tscw.denied(format($q$select public.admin_decide_withdrawal(%L, 'pago')$q$, wid), 'não paga duas vezes');
  perform tscw.login(k1);
  w := public.courier_wallet();
  perform tscw.ok((w->>'sacado_cents')::int = 1000 and (w->>'disponivel_cents')::int = 0 and (w->>'guardado_cents')::int = 500, 'pago: sacado 10, guardado 5');
  perform tscw.ok(exists (select 1 from public.notifications where user_id = k1 and link = '/entregador/saques'), 'entregador avisado');

  -- Master: quem pagou e quem recebeu (pedidos de teste incluídos por padrão)
  perform tscw.login(m);
  money := public.admin_delivery_money(current_date - 30, current_date);
  perform tscw.ok((money->>'entregas_parceiras')::int = 3 and (money->>'clientes_pagaram_cents')::int = 1200 and (money->>'lojas_pagaram_cents')::int = 600
                  and (money->>'entregadores_ganharam_cents')::int = 1500 and (money->>'tucai_parceiras_cents')::int = 300, 'Tucaí recebe R$ 1 por entrega: ' || money::text);
  perform tscw.ok((money->>'saques_pagos_cents')::int = 1000 and (money->>'saldo_entregadores_cents')::int = 500, 'saques pagos e saldo dos entregadores');
  perform tscw.ok((public.admin_delivery_money(current_date - 30, current_date, false)->>'entregas_parceiras')::int = 0, 'sem teste: zero entregas reais');

  -- estabelecimento: custo de entrega é só a contribuição (R$ 2), não R$ 2 + R$ 1
  perform tscw.login(e1);
  ov := public.merchant_overview(lan);
  perform tscw.ok((ov->>'taxas_mes_cents')::int = 3 * 200 + (select sum(commission_cents) from public.orders where id in (o1, o2, o3))::int,
                  'taxas do mês = comissão + R$ 2 por entrega: ' || (ov->>'taxas_mes_cents'));
  perform tscw.su();
  raise notice 'RLS_CARTEIRA_OK';
end $$;
rollback;
