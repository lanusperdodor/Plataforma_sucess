-- Testes da 0030 (modo manutenção global). Tudo é revertido. Sucesso: NOTICE 'RLS_MANUTENCAO_OK'.
-- Tudo é revertido. Sucesso: NOTICE 'RLS_ENTREGA_CODIGO_OK'.
begin;
create schema tsmn;
grant usage on schema tsmn to public;
create function tsmn.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tsmn.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsmn.blocked(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm like '%em manutenção%' then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido bloqueado pela manutenção)', msg;
end $$;
create function tsmn.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsmn.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsmn.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsmn.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsmn.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tsmn.step(msg text) returns void language plpgsql as $$ begin raise notice 'CHEESEBURGER: %', msg; end $$;
grant execute on all functions in schema tsmn to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '66669000-0000-0000-0000-000000000001';
  m uuid; op uuid; c1 uuid; c2 uuid; loj uuid; k1 uuid; k2 uuid; bm uuid; cheese text; o1 uuid; o2 uuid; o3 uuid; code text; tab uuid; ch uuid; ch2 uuid;
  res jsonb; key text := 'tucai_pay_' || repeat('a', 64); n_orders int;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Manutenção', 'MG', 'tsmn-cidade');
  m := private.create_auth_user('mn-master@teste.invalid', 'senha-master-1', 'Master MN');
  op := private.create_auth_user('mn-op@teste.invalid', 'senha-op-1', 'Operador MN');
  insert into public.user_roles(user_id, role) values (m, 'platform_master'), (op, 'platform_operator');
  perform tsmn.login(m);
  res := public.admin_create_test_data(city);
  perform tsmn.su();
  c1 := tsmn.uid('cliente1'); c2 := tsmn.uid('cliente2'); loj := tsmn.uid('empresario1'); k1 := tsmn.uid('entregador'); k2 := tsmn.uid('entregador');  -- só um independente entre as sete contas
  select id into bm from public.businesses where owner_id = loj;
  select id::text into cheese from public.products where business_id = bm and name = 'Cheeseburger';
  insert into private.integration_keys(name, key_hash) values ('payments', encode(extensions.digest(key, 'sha256'), 'hex'))
  on conflict (name) do update set key_hash = excluded.key_hash;

  -- operação normal em andamento: entrega em rota, pedido aguardando, comanda aberta, caixa aberto, cobrança aberta
  perform tsmn.login(k1); perform public.set_courier_online(true);
  perform tsmn.login(c1);
  o1 := public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'pix_on_delivery',
                           'Cliente Teste Um', '(35) 99999-0000', 'Rua das Flores, 100', null, null, null, 'mnt-000000001');
  o2 := public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente Teste Um', '(35) 99999-0000', 'Rua das Flores, 100', null, null, null, 'mnt-000000002');
  o3 := public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente Teste Um', '(35) 99999-0000', 'Rua das Flores, 100', null, null, null, 'mnt-000000003');
  perform tsmn.login(loj);
  perform public.merchant_accept_order(o1, 10);
  perform public.update_order_status(o1, 'ready');
  perform public.gestao_open_cash(bm, 5000);
  tab := public.gestao_open_tab(bm, null, 'Balcão Ana', 1);
  perform public.gestao_add_items(tab, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), gen_random_uuid());
  perform tsmn.login(k1);
  perform public.courier_accept_delivery(o1);
  perform tsmn.login(m);
  ch := public.admin_create_charge(bm, 'Mensalidade teste', 7900, current_date + 5);
  ch2 := public.admin_create_charge(bm, 'Cobrança em processamento', 1000, current_date + 5);

  -- só Master com MFA; passa por preparação
  perform tsmn.login(op, 'aal2');
  perform tsmn.denied($q$select public.admin_set_maintenance('preparando', 'Atualização', null, 'MANUTENCAO')$q$, 'operador ativa manutenção');
  perform tsmn.login(m, 'aal1');
  perform tsmn.denied($q$select public.admin_set_maintenance('preparando', 'Atualização', null, 'MANUTENCAO')$q$, 'Master sem MFA ativa manutenção');
  perform tsmn.login(m, 'aal2');
  perform tsmn.denied($q$select public.admin_set_maintenance('manutencao', 'Atualização', null, 'MANUTENCAO')$q$, 'pular a preparação', array['P0001']);
  perform tsmn.denied($q$select public.admin_set_maintenance('preparando', 'Atualização', null, 'sim')$q$, 'sem confirmação digitada', array['P0001']);
  perform tsmn.denied($q$select public.admin_set_maintenance('preparando', 'x', null, 'MANUTENCAO')$q$, 'sem motivo', array['P0001']);
  res := public.admin_set_maintenance('preparando', 'Atualização do banco', now() + interval '2 hours', 'MANUTENCAO');
  perform tsmn.ok((res->'em_andamento'->>'entregas_em_rota')::int = 1 and (res->'em_andamento'->>'comandas_abertas')::int = 1, 'mostra operações em andamento');

  -- PREPARANDO: nada novo; o que já começou continua
  perform tsmn.anon();
  perform tsmn.ok((public.platform_status()->>'mode') = 'preparando' and not (public.platform_status() ? 'reason'), 'status público sem dados internos');
  perform tsmn.login(c2);
  perform tsmn.blocked(format($q$select public.place_order(%L, jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), 'delivery_partner', 'cash', 'Cliente Dois', '(35) 98888-0000', 'Rua A, 1', null, null, null, 'mnt-000000009')$q$, bm, cheese),
                      'cliente faz pedido novo');
  perform tsmn.denied(format($q$select * from public.payable_charge(%L)$q$, ch), 'abrir pagamento novo', array['P0001', '42501']);
  perform tsmn.login(loj);
  perform tsmn.blocked(format($q$select * from public.payable_charge(%L)$q$, ch), 'lojista abre checkout');
  perform tsmn.blocked(format($q$update public.businesses set description = 'x' where id = %L$q$, bm), 'alterar loja direto pela API');
  perform tsmn.blocked(format($q$select public.gestao_open_tab(%L, null, 'Novo', 1)$q$, bm), 'abrir comanda nova');
  perform public.merchant_accept_order(o2, 10);           -- pedido já feito pode seguir
  perform public.update_order_status(o2, 'ready');       -- (o único entregador independente está com o1 em rota)

  -- EM MANUTENÇÃO: bloqueio total; só concluir entregas em rota e fechar comanda/caixa abertos
  perform tsmn.login(m, 'aal2');
  perform public.admin_set_maintenance('manutencao', 'Atualização do banco', null, 'MANUTENCAO');
  perform tsmn.login(loj);
  perform tsmn.blocked(format('select public.merchant_accept_order(%L, 10)', o3), 'aceitar pedido novo na manutenção');
  perform tsmn.blocked(format($q$select public.gestao_cash_movement(%L, 'entrada', 'dinheiro', 1000, 'troco', gen_random_uuid())$q$, bm), 'lançamento manual de caixa');
  -- cozinha conclui o que já estava em preparo
  perform tsmn.su(); select id::text into code from public.business_tab_items where tab_id = tab; perform tsmn.login(loj);
  perform public.gestao_item_status(code::uuid, 'em_preparo'); perform public.gestao_item_status(code::uuid, 'pronto'); perform public.gestao_item_status(code::uuid, 'servido');
  perform tsmn.ok((public.gestao_close_tab(tab, jsonb_build_array(jsonb_build_object('method', 'dinheiro', 'amount_cents', 2200)), 0, gen_random_uuid())->>'status') = 'fechada',
                  'funcionário fecha a comanda aberta com pagamento registrado');
  perform tsmn.ok((public.gestao_close_cash(bm, 5000 + 2200, 'fim')->>'difference_cents')::int = 0, 'caixa fecha conferido');
  perform tsmn.login(c1);
  perform tsmn.blocked(format($q$update public.profiles set full_name = 'Outro' where id = %L$q$, c1), 'cliente altera perfil');
  select confirmation_code into code from public.my_delivery(o1);
  perform tsmn.login(k1);
  perform public.courier_pickup_delivery(o1);
  perform tsmn.ok((public.courier_verify_code(o1, code)->>'ok')::boolean, 'entregador em rota valida o código');
  perform public.courier_finish_delivery(o1, gen_random_uuid());
  perform tsmn.su();
  perform tsmn.ok((select status from public.orders where id = o1) = 'delivered', 'entrega em andamento concluída durante a manutenção');
  perform tsmn.login(k1);
  perform tsmn.blocked(format('select public.courier_accept_delivery(%L)', o2), 'entregador assume corrida nova durante a manutenção');
  perform tsmn.su();
  -- webhook de pagamento (sistema, sem usuário) continua sendo registrado
  perform tsmn.anon();
  perform tsmn.ok(public.worker_confirm_payment(key, ch2, 'mp-9001', 1000, 'pix') = 'confirmado', 'webhook confirma pagamento durante a manutenção');
  perform tsmn.ok(public.worker_confirm_payment(key, ch2, 'mp-9001', 1000, 'pix') = 'ja_confirmado', 'reenvio do webhook não duplica');
  -- Master segue gerenciando
  perform tsmn.login(m, 'aal2');
  perform tsmn.ok(public.admin_create_charge(bm, 'Ajuste Master', 500, current_date + 5) is not null, 'Master opera durante a manutenção');
  res := public.admin_maintenance_status();
  perform tsmn.ok(res->>'mode' = 'manutencao' and res->>'reason' = 'Atualização do banco', 'Master vê estado e motivo');

  -- retorno: integridade e dados preservados
  perform tsmn.denied($q$select public.admin_set_maintenance('normal', null, null, 'MANUTENCAO')$q$, 'retorno sem confirmação NORMAL', array['P0001']);
  res := public.admin_set_maintenance('normal', null, null, 'NORMAL');
  perform tsmn.ok((select bool_and(value::int = 0) from jsonb_each_text(res->'integridade')), 'verificações de integridade zeradas');
  perform tsmn.su();
  perform tsmn.ok((select status from public.orders where id = o2) = 'ready' and (select status from public.deliveries where order_id = o2) = 'offered', 'pedido em andamento preservado (oferta aguardando entregador)');
  perform tsmn.ok((select status from public.orders where id = o3) = 'placed', 'pedido aguardando preservado');
  perform tsmn.ok((select status from public.platform_charges where id = ch) = 'aberta' and (select status from public.platform_charges where id = ch2) = 'paga', 'cobranças preservadas');
  perform tsmn.ok((select count(*) from public.audit_logs where action = 'platform.maintenance') = 3, 'cada mudança auditada');
  perform tsmn.login(c2);
  perform public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                             'Cliente Dois', '(35) 98888-0000', 'Rua A, 1', null, null, null, 'mnt-000000010');
  perform tsmn.login(loj);
  perform public.merchant_accept_order(o3, 10);

  -- recuperação independente (SQL Editor), ex.: reinício/falha do app com a plataforma travada
  perform tsmn.login(m, 'aal2');
  perform public.admin_set_maintenance('preparando', 'Teste de recuperação', null, 'MANUTENCAO');
  perform tsmn.su();
  res := private.maintenance_force_normal('teste');
  perform tsmn.ok(res->>'anterior' = 'preparando' and private.platform_mode() = 'normal', 'recuperação manual volta ao normal');
  perform tsmn.ok(exists (select 1 from public.audit_logs where action = 'platform.maintenance_recovery'), 'recuperação auditada');
  raise notice 'RLS_MANUTENCAO_OK';
end $$;
rollback;
