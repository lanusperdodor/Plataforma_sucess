-- Auditoria de segurança: o que alguém consegue fazer abrindo o F12 e chamando a API direto com o próprio login.
-- Cada bloco simula uma tentativa de manipulação; o banco precisa recusar. Tudo é revertido. Sucesso: 'RLS_MANIPULACAO_OK'.
begin;
create schema tsmp;
grant usage on schema tsmp to public;
create function tsmp.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true); set role authenticated; end $$;
create function tsmp.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsmp.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsmp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
-- a instrução precisa falhar com permissão negada / regra de negócio, OU não afetar nenhuma linha
create function tsmp.blocked(stmt text, msg text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when insufficient_privilege or raise_exception or check_violation or not_null_violation or foreign_key_violation then return;
  end;
  if n > 0 then raise exception 'FALHOU: % (afetou % linha(s))', msg, n; end if;
end $$;
create function tsmp.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsmp.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsmp to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000042';
  m uuid; e1 uuid; e2 uuid; func uuid; k1 uuid; kp uuid; c1 uuid; c2 uuid; lan uuid; sup uuid; cheese text; price int; o1 uuid; o2 uuid; t int;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Auditoria', 'MG', 'tsmp-cidade');
  m := private.create_auth_user('mp-master@teste.invalid', 'senha-master-1', 'Master MP');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsmp.login(m);
  perform public.admin_create_test_data(city);
  perform tsmp.su();
  e1 := tsmp.uid('empresario1'); e2 := tsmp.uid('empresario2'); func := tsmp.uid('funcionario');
  k1 := tsmp.uid('entregador'); kp := tsmp.uid('entregador2'); c1 := tsmp.uid('cliente1'); c2 := tsmp.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id into sup from public.businesses where owner_id = e2;
  select id::text, price_cents into cheese, price from public.products where business_id = lan and name = 'Cheeseburger';

  -- ===== 1. Preço e pedido (cliente) =====
  perform tsmp.login(c1);
  -- preço falso no pedido: o servidor usa o preço do cadastro
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1, 'unit_price_cents', 1, 'price_cents', 1, 'line_total_cents', 1)),
                           'delivery_partner', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'mp-0000001');
  select subtotal_cents into t from public.orders where id = o1;
  perform tsmp.ok(t = price, 'preço enviado pelo navegador é ignorado (subtotal = preço do cadastro)');
  perform tsmp.ok((select delivery_fee_cents = 400 and courier_pay_cents = 500 and platform_delivery_fee_cents = 100 from public.orders where id = o1), 'frete e repasse vêm da regra do servidor');
  perform tsmp.blocked(format($q$select public.place_order(%L, jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', -5)), 'pickup', 'cash', 'X', '(35) 99999-0001', null, null, null, null, 'mp-0000009')$q$, lan, cheese), 'quantidade negativa');
  perform tsmp.blocked(format($q$insert into public.orders(code, customer_id, business_id, status, fulfillment, payment_method, customer_name, customer_phone, subtotal_cents, delivery_fee_cents, total_cents) values ('X', %L, %L, 'delivered', 'pickup', 'cash', 'X', '1', 1, 0, 1)$q$, c1, lan), 'cliente cria pedido direto na tabela');
  perform tsmp.blocked(format($q$update public.orders set total_cents = 1, subtotal_cents = 1 where id = %L$q$, o1), 'cliente altera o total do próprio pedido');
  perform tsmp.blocked(format($q$update public.orders set status = 'delivered' where id = %L$q$, o1), 'cliente marca o próprio pedido como entregue');
  perform tsmp.blocked(format($q$update public.order_items set unit_price_cents = 1 where order_id = %L$q$, o1), 'cliente altera preço dos itens');
  -- ID de outro cliente
  perform tsmp.login(c2);
  perform tsmp.ok(tsmp.count(format('select 1 from public.orders where id = %L', o1)) = 0, 'Cliente 2 não lê o pedido do Cliente 1 trocando o ID');
  perform tsmp.ok(tsmp.count(format('select 1 from public.order_items where order_id = %L', o1)) = 0, 'Cliente 2 não lê os itens do Cliente 1');
  perform tsmp.ok(tsmp.count(format('select * from public.my_delivery(%L)', o1)) = 0, 'Cliente 2 não vê código/entregador do pedido do Cliente 1');
  perform tsmp.blocked(format($q$select public.update_order_status(%L, 'cancelled')$q$, o1), 'Cliente 2 cancela pedido do Cliente 1');
  perform tsmp.ok(tsmp.count('select 1 from public.profiles where id <> auth.uid() and phone is not null') = 0, 'cliente não lê telefone de outras pessoas');

  -- ===== 2. Entregador: repasse, saldo e saque =====
  perform tsmp.login(k1);
  perform public.set_courier_online(true);
  perform public.courier_accept_delivery(o1);
  perform tsmp.blocked(format($q$update public.deliveries set courier_pay_cents = 99999 where order_id = %L$q$, o1), 'entregador aumenta o próprio repasse');
  perform tsmp.blocked(format($q$update public.deliveries set status = 'delivered' where order_id = %L$q$, o1), 'entregador conclui sem o código do cliente');
  perform tsmp.blocked(format($q$insert into public.courier_withdrawals(courier_id, amount_cents, pix_key) values (%L, 100000, 'pix')$q$, k1), 'entregador cria saque direto na tabela');
  perform tsmp.blocked($q$select public.courier_request_withdrawal('chave-pix')$q$, 'saque sem saldo liberado');
  perform tsmp.blocked($q$update public.courier_withdrawals set status = 'pago'$q$, 'entregador marca saque como pago');
  perform tsmp.blocked($q$select public.admin_decide_withdrawal('00000000-0000-0000-0000-000000000000', 'pago')$q$, 'entregador usa função do Master');
  perform tsmp.blocked(format($q$update public.couriers set city_id = city_id, is_online = true, status = 'approved' where user_id = %L$q$, k1), 'entregador altera o próprio cadastro/aprovação direto');
  perform tsmp.blocked(format($q$select public.courier_complete_delivery(%L, '0000')$q$, o1), 'código errado não conclui');
  -- entregador próprio de outra loja não mexe na entrega da rede
  perform tsmp.login(kp);
  perform tsmp.blocked(format($q$select public.courier_accept_delivery(%L)$q$, o1), 'entregador próprio aceita entrega da rede');
  perform tsmp.blocked(format($q$select public.own_courier_set_status(%L, 'delivered')$q$, o1), 'entregador próprio conclui pedido que não é dele');

  -- ===== 3. Empresário: cobranças, plano, outra loja =====
  perform tsmp.login(e2);
  perform tsmp.ok(tsmp.count(format('select 1 from public.orders where business_id = %L', lan)) = 0, 'Empresário 2 não vê pedidos da lanchonete');
  perform tsmp.blocked(format($q$update public.products set price_cents = 1 where business_id = %L$q$, lan), 'Empresário 2 altera preço da lanchonete');
  perform tsmp.blocked(format($q$select public.update_order_status(%L, 'cancelled')$q$, o1), 'Empresário 2 mexe em pedido da lanchonete');
  perform tsmp.login(e1);
  perform tsmp.blocked(format($q$update public.orders set commission_cents = 0, merchant_delivery_contribution_cents = 0 where id = %L$q$, o1), 'empresário zera comissão/taxa do pedido');
  perform tsmp.blocked(format($q$insert into public.platform_charges(business_id, kind, description, amount_cents, due_on, status) values (%L, 'plano', 'x', 1, current_date, 'paga')$q$, lan), 'empresário cria cobrança paga');
  perform tsmp.blocked($q$update public.platform_charges set status = 'paga', paid_at = now()$q$, 'empresário marca cobrança como paga');
  perform tsmp.blocked(format($q$insert into public.business_subscriptions(business_id, plan_code, price_cents, current_period_end) values (%L, 'presencial_delivery', 0, current_date + 365)$q$, lan), 'empresário se dá plano Premium grátis');
  perform tsmp.blocked(format($q$update public.businesses set status = 'active', is_featured = true where id = %L$q$, sup), 'empresário altera outra loja');
  perform tsmp.blocked(format($q$insert into public.business_members(business_id, user_id, member_role) values (%L, %L, 'owner')$q$, sup, e1), 'empresário vira dono de outra loja');
  -- funcionário não vê financeiro
  perform tsmp.login(func);
  perform tsmp.blocked(format($q$select public.merchant_finance(%L, current_date - 30, current_date)$q$, lan), 'funcionário sem permissão abre o financeiro');
  perform tsmp.blocked(format($q$select public.merchant_set_member_role(%L, %L, 'manager')$q$, lan, func), 'funcionário se promove a gerente');

  -- ===== 4. Privilégios administrativos =====
  perform tsmp.login(c1);
  perform tsmp.blocked(format($q$insert into public.user_roles(user_id, role) values (%L, 'platform_master')$q$, c1), 'cliente se dá papel de Master');
  perform tsmp.blocked(format($q$select public.grant_role(%L, 'platform_operator')$q$, c1), 'cliente usa grant_role');
  perform tsmp.blocked($q$select public.admin_set_maintenance('manutencao', 'x', null, 'MANUTENCAO')$q$, 'cliente liga o modo manutenção');
  perform tsmp.blocked($q$select public.admin_remove_all_test_data('EXCLUIR')$q$, 'cliente apaga dados');
  perform tsmp.blocked($q$select * from public.admin_finance_report(current_date - 30, current_date)$q$, 'cliente lê o financeiro da plataforma');
  perform tsmp.blocked($q$select * from public.admin_courier_withdrawals()$q$, 'cliente lê saques');
  perform tsmp.ok(tsmp.count('select 1 from public.audit_logs') = 0, 'cliente não lê auditoria');
  perform tsmp.ok(tsmp.count('select 1 from public.user_roles where user_id <> auth.uid()') = 0, 'cliente não lê papéis de outras contas');

  -- ===== 5. Visitante sem login =====
  perform tsmp.anon();
  perform tsmp.blocked('select * from public.orders', 'visitante lê pedidos');
  perform tsmp.blocked($q$select * from public.delivery_tracking('00000000-0000-0000-0000-000000000000')$q$, 'visitante lê rastreamento');
  perform tsmp.blocked($q$select public.courier_request_withdrawal('x')$q$, 'visitante pede saque');

  -- os valores originais continuam intactos
  perform tsmp.su();
  perform tsmp.ok((select subtotal_cents = price and courier_pay_cents = 500 and commission_cents >= 0 from public.orders where id = o1), 'pedido intacto após as tentativas');
  perform tsmp.ok((select courier_pay_cents from public.deliveries where order_id = o1) = 500, 'repasse intacto');
  perform tsmp.ok(not exists (select 1 from public.courier_withdrawals), 'nenhum saque foi criado');
  perform tsmp.ok(not exists (select 1 from public.user_roles where user_id = c1 and role in ('platform_master', 'platform_operator')), 'nenhum privilégio concedido');
  raise notice 'RLS_MANIPULACAO_OK';
end $$;
rollback;
