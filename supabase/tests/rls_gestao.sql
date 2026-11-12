-- Testes da 0027 (Tucaí Gestão: mesas, comandas, cozinha e caixa). Tudo é revertido. Sucesso: NOTICE 'RLS_GESTAO_OK'.
begin;
create schema tsgg;
grant usage on schema tsgg to public;
create function tsgg.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); set role authenticated; end $$;
create function tsgg.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsgg.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsgg.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsgg.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsgg.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsgg.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsgg to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '77779000-0000-0000-0000-000000000001';
  m uuid; loj uuid; dono uuid; func uuid; caixa uuid; c1 uuid; bm uuid; br uuid; cheese text; cafe text;
  mesa4 uuid; mesa5 uuid; tab uuid; tab2 uuid; balcao uuid; it uuid; op uuid := gen_random_uuid(); closeop uuid := gen_random_uuid(); res jsonb; r record; qr uuid;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Gestão', 'MG', 'tsgg-cidade');
  m := private.create_auth_user('gg-master@teste.invalid', 'senha-master-1', 'Master GG');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsgg.login(m);
  res := public.admin_create_test_data(city);
  perform tsgg.su();
  loj := tsgg.uid('empresario1'); dono := tsgg.uid('empresario2'); func := tsgg.uid('funcionario'); c1 := tsgg.uid('cliente1');
  caixa := private.create_auth_user('gg-caixa@teste.invalid', 'senha-caixa-1', 'Operador Caixa');
  select id into bm from public.businesses where owner_id = loj;
  select id into br from public.businesses where owner_id = dono;
  select id::text into cheese from public.products where business_id = bm and name = 'Cheeseburger';
  select id::text into cafe from public.products where business_id = bm and name = 'Refrigerante lata';

  -- equipe do Mercadinho: comandas (atendente), cozinha e operador de caixa (atendente + permissão extra de caixa)
  res := jsonb_build_object('func', (select email from auth.users where id = func));
  perform tsgg.login(loj);
  -- o Funcionário — Lanchonete já é atendente da lanchonete (atendimento + cozinha)
  perform public.merchant_invite_member(bm, 'gg-caixa@teste.invalid', 'attendant');
  perform tsgg.login(caixa);
  perform tsgg.denied(format('select public.gestao_open_cash(%L, 10000)', bm), 'atendente sem permissão de caixa abre o caixa');
  perform tsgg.login(loj);
  perform public.merchant_set_member_permission(bm, caixa, 'cash.manage', true);
  perform tsgg.login(func);
  perform tsgg.denied(format($q$select public.merchant_set_member_permission(%L, %L, 'cash.manage', true)$q$, bm, func), 'funcionário se dá permissão de caixa');

  -- mesas (sem limite fixo) e plano
  perform tsgg.login(dono);
  perform tsgg.denied(format('select public.gestao_create_tables(%L, 4)', br), 'Plano Padrão usa mesas/comandas');
  perform tsgg.login(loj);
  perform tsgg.ok(public.gestao_create_tables(bm, 30, 'Área interna', 4) = 30, '30 mesas criadas');
  perform public.gestao_save_table(bm, null, 'Varanda 1', 'Varanda', 6, true);
  select id into mesa4 from public.business_tables where business_id = bm and name = 'Mesa 04';
  select id into mesa5 from public.business_tables where business_id = bm and name = 'Mesa 05';

  -- caixa aberto pelo operador
  perform tsgg.login(caixa);
  perform public.gestao_open_cash(bm, 10000);
  perform tsgg.denied(format('select public.gestao_open_cash(%L, 5000)', bm), 'dois caixas abertos', array['P0001']);

  -- Mesa 04: abrir, lançar 2 cheeseburgers + 1 café; mesma operação não duplica
  perform tsgg.login(func);
  tab := public.gestao_open_tab(bm, mesa4, null, 2);
  perform tsgg.denied(format('select public.gestao_open_tab(%L, %L)', bm, mesa4), 'duas comandas na mesma mesa', array['P0001']);
  perform tsgg.ok(public.gestao_add_items(tab, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 2, 'notes', 'sem cebola'),
                                                                 jsonb_build_object('product_id', cafe, 'quantity', 1, 'price_cents', 1)), op) = 2, 'itens lançados');
  perform tsgg.ok(public.gestao_add_items(tab, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 2)), op) = 0, 'repetição da mesma operação não duplica');
  perform tsgg.su();
  perform tsgg.ok(private.tab_total(tab) = 2 * 2200 + 600, 'preço do cardápio, calculado no servidor');
  -- cozinha recebe com a origem
  perform tsgg.login(func);  -- o funcionário também faz a cozinha
  perform tsgg.ok(tsgg.count($q$select 1 from public.gestao_kitchen('$q$ || bm || $q$') where origin = 'mesa' and ref_label = 'Mesa 04 — Comanda #001'$q$) = 2, 'cozinha recebe "Mesa 04 — Comanda #001"');
  for it in select id from public.business_tab_items where tab_id = tab loop
    perform public.gestao_item_status(it, 'em_preparo');
    perform public.gestao_item_status(it, 'pronto');
  end loop;
  perform tsgg.denied(format($q$select public.gestao_item_status(%L, 'novo')$q$, it), 'voltar etapa', array['P0001']);
  perform tsgg.login(func);
  select * into r from public.gestao_board(bm) x where x.table_id = mesa4;
  perform tsgg.ok(r.situation = 'pronto' and r.total_cents = 5000 and r.people = 2, 'quadro: Mesa 04 com pedido pronto');
  perform tsgg.ok((select situation from public.gestao_board(bm) x where x.table_id = mesa5) = 'livre', 'quadro: Mesa 05 livre');
  for it in select id from public.business_tab_items where tab_id = tab loop perform public.gestao_item_status(it, 'servido'); end loop;
  -- transferir mesa e balcão
  perform public.gestao_transfer_tab(tab, mesa5);
  perform public.gestao_transfer_tab(tab, mesa4);
  perform tsgg.denied(format($q$select public.gestao_open_tab(%L, null, '')$q$, bm), 'balcão sem identificação', array['P0001']);
  balcao := public.gestao_open_tab(bm, null, 'João (balcão)');
  perform public.gestao_add_items(balcao, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), gen_random_uuid());
  perform tsgg.login(func);  -- o funcionário também faz a cozinha
  perform tsgg.ok(tsgg.count($q$select 1 from public.gestao_kitchen('$q$ || bm || $q$') where ref_label like 'Balcão — Comanda #002'$q$) = 1, 'cozinha recebe "Balcão — Comanda #002"');
  perform tsgg.login(func);
  select id into it from public.business_tab_items where tab_id = balcao;
  perform tsgg.denied(format($q$select public.gestao_cancel_item(%L, '')$q$, it), 'cancelar sem motivo', array['P0001']);
  perform public.gestao_cancel_item(it, 'Cliente desistiu');
  -- fechamento: pedir conta, conferir e registrar pagamento no caixa
  perform public.gestao_request_close(tab);
  perform tsgg.denied(format($q$select public.gestao_close_tab(%L, '[{"method":"dinheiro","amount_cents":5000}]', 0, %L)$q$, tab, gen_random_uuid()), 'atendente sem caixa fecha comanda');
  perform tsgg.login(caixa);
  perform tsgg.denied(format($q$select public.gestao_close_tab(%L, '[{"method":"dinheiro","amount_cents":1000}]', 0, %L)$q$, tab, gen_random_uuid()), 'pagamento não bate com o total', array['P0001']);
  res := public.gestao_close_tab(tab, '[{"method":"dinheiro","amount_cents":4000},{"method":"pix","amount_cents":500}]', 500, closeop);
  perform tsgg.ok(res->>'status' = 'fechada', 'comanda fechada com desconto e pagamentos');
  perform tsgg.ok(public.gestao_close_tab(tab, '[]', 0, closeop)->>'status' = 'ja_fechada', 'fechamento repetido não duplica a venda');
  perform tsgg.ok((select count(*) from public.cash_movements where tab_id = tab and kind = 'venda') = 2, 'duas formas de pagamento registradas uma vez');
  perform tsgg.ok((select situation from public.gestao_board(bm) x where x.table_id = mesa4) = 'livre', 'mesa liberada');
  -- movimentos sensíveis e fechamento do caixa
  perform tsgg.denied(format($q$select public.gestao_cash_movement(%L, 'sangria', 'dinheiro', 1000, 'Retirada', %L)$q$, bm, gen_random_uuid()), 'operador de caixa faz sangria sem gerente');
  perform public.gestao_cash_movement(bm, 'suprimento', 'dinheiro', 2000, 'Troco extra', gen_random_uuid());
  perform tsgg.login(loj);
  perform public.gestao_cash_movement(bm, 'sangria', 'dinheiro', 3000, 'Depósito no banco', gen_random_uuid());
  perform tsgg.login(caixa);
  res := public.gestao_close_cash(bm, 13000);
  -- esperado em dinheiro: 100,00 + 40,00 + 20,00 − 30,00 = 130,00
  perform tsgg.ok((res->>'expected_cash_cents')::int = 13000 and (res->>'difference_cents')::int = 0 and (res->'by_method'->>'pix')::int = 500, 'fechamento do caixa: esperado, contado e por forma');
  perform tsgg.ok(jsonb_array_length(res->'movements') = 4, 'relatório com movimentações e responsáveis');
  perform tsgg.su();
  perform tsgg.ok((select count(*) from public.audit_logs where action like 'gestao.%' and (entity_id = tab::text or entity_id = it::text)) >= 3, 'abertura, cancelamento e fechamento auditados');

  -- isolamento: outra loja e cliente não veem comandas nem caixa
  perform tsgg.login(dono);
  perform tsgg.ok(tsgg.count(format('select 1 from public.business_tabs where business_id = %L', bm)) = 0, 'outra loja não vê comandas');
  perform tsgg.ok(tsgg.count(format('select 1 from public.cash_movements where business_id = %L', bm)) = 0, 'outra loja não vê o caixa');
  perform tsgg.login(c1);
  perform tsgg.denied(format('select * from public.gestao_board(%L)', bm), 'cliente abre o quadro de mesas');
  -- QR da mesa: só identifica mesa e cardápio; loja de teste não aparece para visitante
  perform tsgg.su();
  select qr_token into qr from public.business_tables where id = mesa4;
  perform tsgg.anon();
  perform tsgg.ok(tsgg.count(format('select 1 from public.table_by_qr(%L)', qr)) = 0, 'QR de loja de teste invisível para visitante');
  perform tsgg.login(c1);
  perform tsgg.ok((select table_name from public.table_by_qr(qr)) = 'Mesa 04', 'QR identifica a mesa');
  perform tsgg.ok(tsgg.count(format('select 1 from public.table_by_qr(%L)', gen_random_uuid())) = 0, 'QR inválido não abre nada');
end $$;

do $$ begin raise notice 'RLS_GESTAO_OK'; end $$;
rollback;
