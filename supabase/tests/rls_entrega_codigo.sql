-- Testes da 0024: cheeseburger no Mercadinho de ponta a ponta, código de entrega seguro e finanças do lojista.
-- Tudo é revertido. Sucesso: NOTICE 'RLS_ENTREGA_CODIGO_OK'.
begin;
create schema tsec;
grant usage on schema tsec to public;
create function tsec.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tsec.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsec.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsec.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsec.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsec.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tsec.step(msg text) returns void language plpgsql as $$ begin raise notice 'CHEESEBURGER: %', msg; end $$;
grant execute on all functions in schema tsec to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '55559000-0000-0000-0000-000000000001';
  m uuid; c1 uuid; c2 uuid; loj uuid; dono uuid; k1 uuid; k2 uuid; bm uuid; br uuid; cheese text; o uuid; o2 uuid; o3 uuid;
  code text; wrong text; r jsonb; v int; res jsonb; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Cheeseburger', 'MG', 'tsec-cidade');
  m := private.create_auth_user('ec-master@teste.invalid', 'senha-master-1', 'Master EC');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsec.login(m);
  res := public.admin_create_test_data(city);
  perform tsec.su();
  c1 := tsec.uid('cliente1'); c2 := tsec.uid('cliente2'); loj := tsec.uid('empresario1'); dono := tsec.uid('empresario2');
  k1 := tsec.uid('entregador'); k2 := tfx.partner_courier(city);
  select id into bm from public.businesses where owner_id = loj;
  select id into br from public.businesses where owner_id = dono;
  perform tsec.ok((select delivery_offer = 'partner' and name like '[Teste] Lanchonete do Tuca%' from public.businesses where id = bm), 'Mercadinho de homologação usa entregador parceiro');
  select id::text into cheese from public.products where business_id = bm and name = 'Cheeseburger';
  perform tsec.ok(cheese is not null, 'Mercadinho vende Cheeseburger');

  -- 1. Cliente 1 compra o cheeseburger
  perform tsec.login(k1); perform public.set_courier_online(true);
  perform tsec.login(c1);
  o := public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'pix_on_delivery',
                          'Cliente Teste Um', '(35) 99999-0000', 'Rua das Flores, 100, Centro', null, 'sem cebola', null, 'cheese-0000001');
  perform tsec.ok((select status = 'placed' and business_id = bm and customer_id = c1 and fulfillment = 'delivery_partner' and subtotal_cents = 2200
                     and delivery_fee_cents = 400 and total_cents = 2600 and commission_cents = 0 from public.orders where id = o), 'pedido persistido: loja, cliente, modalidade, valores (sem comissão até R$ 50)');
  perform tsec.ok(tsec.count(format('select 1 from public.order_events where order_id = %L and status = %L', o, 'placed')) = 1, 'evento inicial');
  perform tsec.step('cliente comprou; aguardando confirmação');
  -- 2. Mercadinho recebe e aceita: cliente vê "em preparo"
  perform tsec.login(loj);
  perform tsec.ok(tsec.count(format('select 1 from public.orders where id = %L and status = %L', o, 'placed')) = 1, 'Mercadinho recebe o pedido');
  perform public.merchant_accept_order(o, 15);
  perform tsec.denied(format('select public.merchant_accept_order(%L, 15)', o), 'aceite duplicado', array['P0001']);
  perform tsec.login(c1);
  perform tsec.ok((select status from public.orders where id = o) = 'preparing', 'cliente vê em preparo');
  perform tsec.step('Mercadinho aceitou; em preparo');
  -- 3. pronto: procura entregador
  perform tsec.login(loj);
  perform tsec.denied(format($q$select public.update_order_status(%L, 'out_for_delivery')$q$, o), 'pular etapa', array['P0001']);
  perform public.update_order_status(o, 'ready');
  perform tsec.login(c1);
  perform tsec.ok((select status = 'offered' and confirmation_code ~ '^[0-9]{4}$' from public.my_delivery(o)), 'cliente vê procurando entregador e já tem o código (desde a confirmação, 0026)');
  perform tsec.login(k2);
  perform tsec.ok(tsec.count('select 1 from public.courier_list_offers()') = 0, 'entregador offline não vê a oferta');
  perform tsec.login(k1);
  perform tsec.ok(tsec.count(format('select 1 from public.courier_list_offers() where order_id = %L', o)) = 1, 'entregador aprovado e online vê a oferta do cheeseburger');
  -- 4. entregador aceita: cliente e loja avisados
  perform public.courier_accept_delivery(o);
  perform tsec.su();
  perform tsec.ok(exists (select 1 from public.notifications where user_id = c1 and message like '%entregador encontrado%'), 'cliente avisado: entregador encontrado');
  perform tsec.ok(exists (select 1 from public.notifications where user_id = loj and message like '%a caminho para coletar%'), 'loja avisada do entregador');
  perform tsec.ok((select confirmation_code is null from public.deliveries where order_id = o), 'código não fica em texto aberto');
  perform tsec.login(c1);
  select confirmation_code into code from public.my_delivery(o);
  perform tsec.ok(code ~ '^[0-9]{4}$' and (select courier_first_name from public.my_delivery(o)) = 'Entregador', 'cliente vê o código e o primeiro nome do entregador');
  perform tsec.ok(code = (select confirmation_code from public.my_delivery(o)), 'código estável ao recarregar');
  perform tsec.login(c2);
  perform tsec.ok(tsec.count(format('select 1 from public.my_delivery(%L)', o)) = 0, 'outro cliente não vê o código');
  perform tsec.login(loj);
  perform tsec.denied(format('select confirmation_code from public.deliveries where order_id = %L', o), 'loja lê o código');
  perform tsec.login(k1);
  perform tsec.ok(not exists (select 1 from public.courier_my_deliveries(true) where order_id = o and (row_to_json(courier_my_deliveries)::text like '%' || code || '%')), 'resposta do entregador não traz o código');
  -- 5. coleta; finalizar sem código é bloqueado
  perform tsec.denied(format($q$select public.courier_verify_code(%L, %L)$q$, o, code), 'valida antes de coletar', array['P0001']);
  perform public.courier_pickup_delivery(o);
  perform tsec.login(c1);
  perform tsec.ok((select status from public.orders where id = o) = 'out_for_delivery', 'cliente vê em rota');
  perform tsec.login(k1);
  perform tsec.denied(format($q$select public.courier_finish_delivery(%L, gen_random_uuid())$q$, o), 'finalizar sem código', array['P0001']);
  -- 6. código errado: não revela nada; bloqueio após 3
  wrong := lpad(((code::int + 1) % 10000)::text, 4, '0');
  r := public.courier_verify_code(o, wrong);
  perform tsec.ok(not (r->>'ok')::boolean and r->>'reason' = 'invalido' and r::text not like '%' || code || '%', 'código inválido sem revelar o esperado');
  perform tsec.denied(format($q$select public.courier_finish_delivery(%L, gen_random_uuid())$q$, o), 'finalizar após código errado', array['P0001']);
  perform public.courier_verify_code(o, wrong);
  r := public.courier_verify_code(o, wrong);
  perform tsec.ok(r->>'reason' = 'bloqueado' and r->>'locked_until' is not null, '3 erros: bloqueio temporário');
  r := public.courier_verify_code(o, code);
  perform tsec.ok(not (r->>'ok')::boolean and r->>'reason' = 'bloqueado', 'bloqueado até com o código certo');
  perform tsec.login(k2);
  perform tsec.denied(format($q$select public.courier_verify_code(%L, %L)$q$, o, code), 'outro entregador valida');
  perform tsec.su();
  update public.deliveries set code_locked_until = now() - interval '1 second' where order_id = o;  -- passa o tempo do bloqueio
  perform tsec.ok(not exists (select 1 from public.audit_logs where entity_id = o::text and (details::text like '%' || code || '%' or details::text like '%' || wrong || '%')),
                  'auditoria das tentativas sem o código');
  perform tsec.ok((select count(*) from public.audit_logs where entity_id = o::text and action = 'delivery.code_fail') = 3, 'tentativas auditadas');
  -- 7. código certo: confirma e libera a finalização (idempotente por operação)
  perform tsec.login(k1);
  r := public.courier_verify_code(o, code);
  perform tsec.ok((r->>'ok')::boolean, 'código confirmado');
  perform tsec.ok(public.courier_finish_delivery(o, '55550000-0000-0000-0000-00000000f001') = 'finalizada', 'entrega finalizada');
  perform tsec.ok(public.courier_finish_delivery(o, '55550000-0000-0000-0000-00000000f001') = 'ja_finalizada', 'mesma operação repetida é segura');
  perform tsec.denied(format($q$select public.courier_finish_delivery(%L, gen_random_uuid())$q$, o), 'segunda finalização', array['P0001']);
  perform tsec.denied(format($q$select public.courier_verify_code(%L, %L)$q$, o, code), 'código usado de novo', array['P0001']);
  perform tsec.login(c1);
  perform tsec.ok((select status from public.orders where id = o) = 'delivered' and (select confirmation_code is null from public.my_delivery(o)), 'cliente vê entregue; código expira');
  perform tsec.login(loj);
  perform tsec.ok((select status from public.orders where id = o) = 'delivered', 'Mercadinho vê entregue');
  perform tsec.login(m);
  perform tsec.ok((select status from public.admin_list_orders('concluidos') where id = o) = 'delivered', 'Master vê entregue');
  perform tsec.su();
  perform tsec.ok((select string_agg(status::text, ',' order by created_at, id) from public.order_events where order_id = o)
                  = 'placed,accepted,preparing,ready,ready,out_for_delivery,delivered', 'histórico completo');
  perform tsec.step('entregue com código; cliente, loja e Master veem');

  -- 8. código com zero à esquerda, 10 tentativas e exceção administrativa
  perform tsec.login(c1);
  o2 := public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente Teste Um', '35999990000', 'Rua B, 2, Centro', null, null, null, 'cheese-0000002');
  perform tsec.login(loj); perform public.merchant_accept_order(o2, 10); perform public.update_order_status(o2, 'ready');
  perform tsec.login(k1); perform public.courier_accept_delivery(o2); perform public.courier_pickup_delivery(o2);
  perform tsec.su();
  select g into v from generate_series(1, 5000) g where private.delivery_code(o2, g) like '0%' limit 1;
  update public.deliveries set code_version = v where order_id = o2;
  perform tsec.login(c1);
  select confirmation_code into code from public.my_delivery(o2);
  perform tsec.ok(code like '0%' and char_length(code) = 4, 'código com zero à esquerda');
  perform tsec.login(k1);
  perform tsec.ok(not (public.courier_verify_code(o2, ltrim(code, '0'))->>'ok')::boolean, 'sem o zero à esquerda é inválido');
  perform tsec.su();
  update public.deliveries set failed_code_attempts = 9, code_locked_until = null where order_id = o2;
  perform tsec.login(k1);
  r := public.courier_verify_code(o2, lpad(((code::int + 1) % 10000)::text, 4, '0'));
  perform tsec.su();
  perform tsec.ok((select code_locked_until > now() + interval '1 year' from public.deliveries where order_id = o2), '10 tentativas: bloqueio até o suporte');
  perform tsec.ok(exists (select 1 from public.notifications where user_id = m and kind = 'ops_alert' and message like '%código bloqueado%'), 'Master avisado');
  perform tsec.login(m);
  perform tsec.denied(format($q$select public.admin_force_complete_delivery(%L, 'Cliente confirmou por telefone com o suporte')$q$, o2), 'exceção sem MFA');
  perform tsec.login(m, 'aal2');
  perform tsec.denied(format($q$select public.admin_force_complete_delivery(%L, 'curto')$q$, o2), 'exceção sem justificativa', array['P0001']);
  perform public.admin_force_complete_delivery(o2, 'Cliente confirmou por telefone com o suporte');
  perform tsec.su();
  perform tsec.ok((select status from public.orders where id = o2) = 'delivered' and exists (select 1 from public.audit_logs where action = 'delivery.force_complete' and entity_id = o2::text),
                  'exceção administrativa auditada');

  -- 9. entrega cancelada não aceita código
  perform tsec.login(c1);
  o3 := public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente Teste Um', '35999990000', 'Rua C, 3, Centro', null, null, null, 'cheese-0000003');
  perform tsec.login(loj); perform public.merchant_accept_order(o3, 10); perform public.update_order_status(o3, 'ready');
  perform tsec.login(k1); perform public.courier_accept_delivery(o3);
  perform tsec.login(loj); perform public.update_order_status(o3, 'cancelled', 'Cliente desistiu por telefone');
  perform tsec.login(k1);
  perform tsec.denied(format($q$select public.courier_verify_code(%L, '1234')$q$, o3), 'código em entrega cancelada', array['P0001']);

  -- 10. finanças do lojista: gastos, custo do produto e lucro estimado (isolados por estabelecimento)
  perform tsec.login(loj);
  insert into public.business_expenses(business_id, category, description, amount_cents, spent_on, recurrence)
  values (bm, 'aluguel', 'Aluguel do ponto', 100000, hoje, 'mensal'), (bm, 'embalagens', 'Caixas', 5000, hoje, 'unica');
  res := public.merchant_finance(bm, hoje, hoje);
  perform tsec.ok((res->>'itens_sem_custo')::int = 2 and (res->>'custo_produtos_cents')::int = 0, 'lucro avisa produtos sem custo');
  insert into public.business_product_costs(product_id, business_id, cost_cents) values (cheese::uuid, bm, 900);
  res := public.merchant_finance(bm, hoje, hoje);
  perform tsec.ok((res->>'pedidos')::int = 2 and (res->>'faturamento_bruto_cents')::int = 4400 and (res->>'custo_produtos_cents')::int = 1800
                  and (res->>'despesas_cents')::int = 105000 and (res->>'itens_sem_custo')::int = 0 and (res->>'cancelados')::int = 1, 'painel e lucro com valores reais');
  perform tsec.login(dono);
  perform tsec.ok(tsec.count(format('select 1 from public.business_expenses where business_id = %L', bm)) = 0, 'outra loja não vê os gastos');
  perform tsec.ok(tsec.count(format('select 1 from public.business_product_costs where business_id = %L', bm)) = 0, 'outra loja não vê os custos');
  perform tsec.denied(format($q$select public.merchant_finance(%L, current_date, current_date)$q$, bm), 'outra loja lê o lucro');
  perform tsec.denied(format($q$insert into public.business_product_costs(product_id, business_id, cost_cents) values (%L, %L, 1)$q$, cheese, br), 'custo de produto de outra loja');
  perform tsec.login(c1);
  perform tsec.ok(tsec.count('select 1 from public.business_product_costs') = 0, 'cliente não vê custos');
end $$;

do $$ begin raise notice 'RLS_ENTREGA_CODIGO_OK'; end $$;
rollback;
