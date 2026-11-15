-- 0049: assinatura com débito automático. Tudo é revertido. Sucesso: 'RLS_ASSINATURA_OK'.
begin;
create schema tsas;
grant usage on schema tsas to public;
create function tsas.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true); set role authenticated; end $$;
create function tsas.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsas.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsas.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsas.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege or raise_exception then return; end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', msg;
end $$;
create function tsas.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsas to public;
update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000049';
  m uuid; e1 uuid; e2 uuid; c1 uuid; lan uuid; key text; j jsonb; r text; s public.business_subscriptions%rowtype; n int;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Assinatura', 'MG', 'tsas-cidade');
  m := private.create_auth_user('as-master@teste.invalid', 'senha-master-1', 'Master AS');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsas.login(m);
  perform public.admin_create_test_data(city);
  key := public.admin_generate_integration_key();
  perform tsas.su();
  e1 := tsas.uid('empresario1'); e2 := tsas.uid('empresario2'); c1 := tsas.uid('cliente1');
  select id into lan from public.businesses where owner_id = e1;

  -- dono escolhe o plano (valor vem do banco)
  perform tsas.login(e1);
  j := public.owner_start_subscription(lan, 'presencial_delivery');
  perform tsas.ok((j->>'price_cents')::int = 9900 and j->>'plan_name' = 'Premium' and j->>'payer_email' like 'empresario1-%', 'dados para criar a assinatura: ' || j::text);
  perform tsas.denied(format('select public.owner_start_subscription(%L, %L)', lan, 'plano_falso'), 'plano inexistente');
  perform tsas.login(e2);
  perform tsas.denied(format('select public.owner_start_subscription(%L, %L)', lan, 'delivery'), 'outro empresário assina pela loja');
  perform tsas.login(c1);
  perform tsas.denied(format('select public.owner_start_subscription(%L, %L)', lan, 'delivery'), 'cliente assina pela loja');

  -- Worker: só com a chave
  perform tsas.anon();
  perform tsas.denied(format('select public.worker_save_preapproval(%L, %L, %L, %L, %L)', 'chave-errada', lan, 'presencial_delivery', 'pre-1', e1), 'chave errada');
  perform public.worker_save_preapproval(key, lan, 'presencial_delivery', 'pre-1', e1);
  perform tsas.ok(public.worker_preapproval_status(key, 'pre-1', 'authorized') = 'autorizada', 'assinatura autorizada');
  -- mensalidade paga: cobrança paga + plano estendido, sem duplicar
  perform tsas.ok(public.worker_preapproval_payment(key, 'pre-1', 'pg-100', 5000, 'cartao') = 'valor_diferente', 'valor diferente do plano é recusado');
  perform tsas.ok(public.worker_preapproval_payment(key, 'pre-1', 'pg-100', 9900, 'cartao') = 'confirmado', 'mensalidade confirmada');
  perform tsas.ok(public.worker_preapproval_payment(key, 'pre-1', 'pg-100', 9900, 'cartao') = 'ja_confirmado', 'mesmo pagamento não duplica');
  perform tsas.su();
  select * into s from public.business_subscriptions where business_id = lan and status = 'active';
  perform tsas.ok(s.plan_code = 'presencial_delivery' and s.current_period_end >= (current_date + interval '28 days')::date, 'plano Premium ativo por ~1 mês');
  select count(*) into n from public.platform_charges where business_id = lan and kind = 'plano' and status = 'paga' and provider_payment_id = 'pg-100';
  perform tsas.ok(n = 1, 'uma cobrança paga registrada');
  perform tsas.anon();
  perform tsas.ok(public.worker_preapproval_payment(key, 'pre-1', 'pg-101', 9900, 'cartao') = 'confirmado', 'mês seguinte');
  perform tsas.su();
  perform tsas.ok((select current_period_end from public.business_subscriptions where id = s.id) >= (s.current_period_end + interval '27 days')::date, 'segundo mês estende o plano');

  -- leitura: dono vê; outro empresário e cliente não
  perform tsas.login(e1);
  perform tsas.ok((select status from public.business_gateway_subscriptions where business_id = lan) = 'autorizada', 'dono vê a assinatura');
  perform tsas.denied(format('select public.owner_start_subscription(%L, %L)', lan, 'delivery'), 'trocar de plano com assinatura ativa');
  perform tsas.login(e2);
  perform tsas.ok(not exists (select 1 from public.business_gateway_subscriptions where business_id = lan), 'outro empresário não vê');
  perform tsas.login(c1);
  perform tsas.denied(format('select public.subscription_to_cancel(%L)', lan), 'cliente cancela');
  perform tsas.login(e1);
  perform tsas.ok((public.subscription_to_cancel(lan))->>'preapproval_id' = 'pre-1', 'dono pede o cancelamento');
  perform tsas.anon();
  perform tsas.ok(public.worker_preapproval_status(key, 'pre-1', 'cancelled') = 'cancelada', 'cancelada no Mercado Pago');
  perform tsas.su();
  perform tsas.ok(not exists (select 1 from public.business_subscriptions where business_id = lan and status = 'active'), 'plano deixa de estar ativo');
  perform tsas.login(m);
  perform tsas.denied(format('select public.subscription_to_cancel(%L)', lan), 'não há assinatura ativa para cancelar de novo');
  raise notice 'RLS_ASSINATURA_OK';
end $$;
rollback;
