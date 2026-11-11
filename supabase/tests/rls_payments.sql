-- Testes da 0019 (Mercado Pago). Tudo é revertido. Sucesso: NOTICE 'RLS_PAYMENTS_OK'.
begin;
create schema tstp;
grant usage on schema tstp to public;
create function tstp.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); set role authenticated; end $$;
create function tstp.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstp.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstp.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstp.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
grant execute on all functions in schema tstp to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
insert into auth.users(id, email) values
  ('13130000-0000-0000-0000-0000000000f1', 'p-master@teste.invalid'), ('13130000-0000-0000-0000-0000000000f2', 'p-fin@teste.invalid'),
  ('13130000-0000-0000-0000-0000000000a1', 'p-dono@teste.invalid'), ('13130000-0000-0000-0000-0000000000b1', 'p-outro@teste.invalid');
insert into public.user_roles(user_id, role) values ('13130000-0000-0000-0000-0000000000f1', 'platform_master'), ('13130000-0000-0000-0000-0000000000f2', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values ('13130000-0000-0000-0000-0000000000f2', 'finance.view');
insert into public.businesses(id, name, slug, owner_id, status) values
  ('13131000-0000-0000-0000-00000000000a', 'Loja P', 'tstp-a', '13130000-0000-0000-0000-0000000000a1', 'active'),
  ('13131000-0000-0000-0000-00000000000b', 'Loja Q', 'tstp-b', '13130000-0000-0000-0000-0000000000b1', 'active');
insert into public.business_members(business_id, user_id, member_role) values
  ('13131000-0000-0000-0000-00000000000a', '13130000-0000-0000-0000-0000000000a1', 'owner'), ('13131000-0000-0000-0000-00000000000b', '13130000-0000-0000-0000-0000000000b1', 'owner');

do $$
declare
  m constant uuid := '13130000-0000-0000-0000-0000000000f1';
  fin constant uuid := '13130000-0000-0000-0000-0000000000f2';
  dono constant uuid := '13130000-0000-0000-0000-0000000000a1';
  outro constant uuid := '13130000-0000-0000-0000-0000000000b1';
  a constant uuid := '13131000-0000-0000-0000-00000000000a';
  sid uuid; cid uuid; k text; r record; res text;
begin
  perform tstp.login(fin);
  perform tstp.denied($q$select public.admin_payment_gateway_set(null, 'TEST-123456789012345678901234', null, true)$q$, 'operador configura gateway');
  perform tstp.ok((select not token_set from public.admin_payment_gateway_get()), 'sem configuração');

  perform tstp.login(m);
  perform tstp.denied($q$select public.admin_payment_gateway_set(null, 'chave-errada', null, false)$q$, 'token inválido', array['P0001', '23514']);
  perform tstp.denied($q$select public.admin_payment_gateway_set('APP_USR-abcdefghij123', 'TEST-1234567890123456789012345', null, false)$q$, 'ambientes misturados', array['P0001']);
  perform tstp.denied($q$select public.admin_payment_gateway_set(null, null, null, true)$q$, 'ativar sem token', array['P0001']);
  perform public.admin_payment_gateway_set('TEST-pk-abcdefghij123', 'TEST-1234567890123456789012345678', 'segredo-webhook-123456', true);
  select * into r from public.admin_payment_gateway_get();
  perform tstp.ok(r.token_set and r.token_last4 = '5678' and r.mode = 'teste' and r.enabled and r.webhook_secret_set and not r.integration_key_set, 'painel vê só os 4 últimos dígitos');
  perform tstp.ok(not exists (select 1 from public.admin_payment_gateway_get() x where x::text like '%1234567890123456%'), 'token completo nunca volta');
  -- salvar sem token mantém o atual
  perform public.admin_payment_gateway_set(null, null, null, true);
  perform tstp.ok((select token_last4 = '5678' from public.admin_payment_gateway_get()), 'campo vazio mantém o token');
  k := public.admin_generate_integration_key();
  perform tstp.ok(k ~ '^tucai_pay_[0-9a-f]{64}$', 'chave de integração forte');

  -- cobrança aberta
  sid := public.admin_set_subscription(a, 'delivery', current_date - 25, current_date + 5);
  cid := public.admin_charge_subscription(a);

  -- Worker: só com a chave
  perform tstp.anon();
  perform tstp.denied($q$select * from public.worker_payment_config('chave-falsa-chave-falsa-chave-falsa-1234')$q$, 'Worker sem chave lê o token');
  perform tstp.ok((select access_token = 'TEST-1234567890123456789012345678' from public.worker_payment_config(k)), 'Worker com a chave lê a configuração');
  perform tstp.denied(format($q$select public.worker_confirm_payment('x', %L, '1', 7900, 'pix')$q$, cid), 'confirmação sem chave');
  perform tstp.denied('select * from public.payable_charge(gen_random_uuid())', 'anon consulta cobrança');
  perform tstp.ok(public.worker_confirm_payment(k, cid, 'mp-1', 100, 'pix') = 'valor_diferente', 'valor diferente não dá baixa');
  perform tstp.ok(public.worker_confirm_payment(k, cid, 'mp-1', 7900, 'pix') = 'confirmado', 'pagamento confirmado');
  perform tstp.ok(public.worker_confirm_payment(k, cid, 'mp-1', 7900, 'pix') = 'ja_confirmado', 'aviso repetido não duplica');
  perform tstp.su();
  perform tstp.ok((select status = 'paga' and paid_method = 'pix' and provider_payment_id = 'mp-1' from public.platform_charges where id = cid), 'cobrança paga com o id do Mercado Pago');
  perform tstp.ok((select current_period_end = (current_date + 5 + interval '1 month')::date from public.business_subscriptions where id = sid), 'plano renovado');
  perform tstp.ok(tstp.count($q$select 1 from public.audit_logs where action = 'payments.confirmed'$q$) = 1, 'auditoria do pagamento');
  perform tstp.ok(not has_table_privilege('authenticated', 'private.payment_gateway', 'select') and not has_table_privilege('anon', 'private.payment_gateway', 'select'), 'tabela de credenciais fechada');

  -- quem pode pagar
  perform tstp.login(m);
  cid := public.admin_create_charge(a, 'Ajuste', 1500, current_date + 3);
  perform tstp.login(dono);
  perform tstp.ok((select amount_cents = 1500 and business_name = 'Loja P' from public.payable_charge(cid)), 'dono pode pagar a própria cobrança');
  perform tstp.login(outro);
  perform tstp.ok(tstp.count(format('select * from public.payable_charge(%L)', cid)) = 0, 'outra loja não paga');
  -- nova chave invalida a anterior
  perform tstp.login(m);
  perform public.admin_generate_integration_key();
  perform tstp.anon();
  perform tstp.denied(format('select * from public.worker_payment_config(%L)', k), 'chave antiga continua valendo');
  perform tstp.su();
end $$;

do $$ begin raise notice 'RLS_PAYMENTS_OK'; end $$;
rollback;
