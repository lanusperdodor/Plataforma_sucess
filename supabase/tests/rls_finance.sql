-- Testes da 0018 (financeiro do Master). Tudo é revertido. Sucesso: NOTICE 'RLS_FINANCE_OK'.
begin;
create schema tstf;
grant usage on schema tstf to public;
create function tstf.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); set role authenticated; end $$;
create function tstf.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstf.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstf.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstf.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstf.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
grant execute on all functions in schema tstf to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
insert into auth.users(id, email) values
  ('12120000-0000-0000-0000-0000000000f1', 'f-master@teste.invalid'),
  ('12120000-0000-0000-0000-0000000000f2', 'f-financeiro@teste.invalid'),
  ('12120000-0000-0000-0000-0000000000f3', 'f-operador@teste.invalid'),
  ('12120000-0000-0000-0000-0000000000a1', 'f-dono@teste.invalid'),
  ('12120000-0000-0000-0000-0000000000b1', 'f-outro@teste.invalid'),
  ('12120000-0000-0000-0000-0000000000c1', 'f-cliente@teste.invalid');
insert into public.user_roles(user_id, role) values
  ('12120000-0000-0000-0000-0000000000f1', 'platform_master'), ('12120000-0000-0000-0000-0000000000f2', 'platform_operator'), ('12120000-0000-0000-0000-0000000000f3', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values ('12120000-0000-0000-0000-0000000000f2', 'finance.view');
update public.profiles set full_name = 'Dona Ana', phone = '(35) 98888-0000' where id = '12120000-0000-0000-0000-0000000000a1';
insert into public.cities(id, name, state, slug) values ('12129000-0000-0000-0000-000000000001', 'Cidade F', 'TF', 'tstf-cidade');
insert into public.businesses(id, name, slug, owner_id, status, city_id, whatsapp) values
  ('12121000-0000-0000-0000-00000000000a', 'Lanchonete F', 'tstf-a', '12120000-0000-0000-0000-0000000000a1', 'active', '12129000-0000-0000-0000-000000000001', '(35) 97777-0000'),
  ('12121000-0000-0000-0000-00000000000b', 'Loja F', 'tstf-b', '12120000-0000-0000-0000-0000000000b1', 'active', '12129000-0000-0000-0000-000000000001', null);
insert into public.business_members(business_id, user_id, member_role) values
  ('12121000-0000-0000-0000-00000000000a', '12120000-0000-0000-0000-0000000000a1', 'owner'), ('12121000-0000-0000-0000-00000000000b', '12120000-0000-0000-0000-0000000000b1', 'owner');
-- pedidos concluídos no mês passado: comissão 140 + plataforma 100 ; e 0 + 100
insert into public.orders(id, customer_id, business_id, status, fulfillment, payment_method, customer_name, customer_phone, delivery_address,
  subtotal_cents, delivery_fee_cents, total_cents, commission_cents, platform_delivery_fee_cents, pricing_config_id, pricing_snapshot, idempotency_key, updated_at)
select gen_random_uuid(), '12120000-0000-0000-0000-0000000000c1', '12121000-0000-0000-0000-00000000000a', 'delivered', 'delivery_partner', 'cash', 'Cli', '35999990000', 'Rua A, 1',
       v.sub, 400, v.sub + 400, v.com, 100, (select id from public.pricing_configs where is_current), '{}'::jsonb, 'tstf-chave-' || v.k,
       (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '10 days') at time zone 'America/Sao_Paulo'
  from (values (7000, 140, 'k1'), (3000, 0, 'k2')) v(sub, com, k);

do $$
declare
  m constant uuid := '12120000-0000-0000-0000-0000000000f1';
  fin constant uuid := '12120000-0000-0000-0000-0000000000f2';
  op constant uuid := '12120000-0000-0000-0000-0000000000f3';
  dono constant uuid := '12120000-0000-0000-0000-0000000000a1';
  outro constant uuid := '12120000-0000-0000-0000-0000000000b1';
  a constant uuid := '12121000-0000-0000-0000-00000000000a';
  b constant uuid := '12121000-0000-0000-0000-00000000000b';
  sid uuid; cid uuid; ccid uuid; s jsonb; r record; last_month date := (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month')::date;
begin
  perform tstf.anon();
  perform tstf.denied('select public.admin_finance_summary()', 'anon vê financeiro');
  perform tstf.ok(tstf.count('select 1 from public.plans') = 2, 'planos públicos');
  perform tstf.login(op);
  perform tstf.denied('select public.admin_finance_summary()', 'operador sem permissão vê financeiro');
  perform tstf.login(fin);
  perform tstf.ok(public.admin_finance_summary() ? 'mrr_cents', 'operador com finance.view lê');
  perform tstf.denied(format($q$select public.admin_set_subscription(%L, 'delivery', current_date, current_date + 30)$q$, a), 'operador altera plano');

  perform tstf.login(m);
  perform tstf.denied(format($q$select public.admin_set_subscription(%L, 'ouro', current_date, current_date + 30)$q$, a), 'plano inexistente', array['P0001']);
  sid := public.admin_set_subscription(a, 'presencial_delivery', current_date - 25, current_date + 5);
  perform public.admin_set_subscription(b, 'delivery', current_date, current_date + 30);
  s := public.admin_finance_summary();
  perform tstf.ok((s->>'active_subscriptions')::int = 2 and (s->>'mrr_cents')::int = 17800 and (s->>'due_soon')::int = 1, 'resumo: assinaturas, receita mensal e vencendo');
  select * into r from public.admin_finance_businesses() x where x.business_id = a;
  perform tstf.ok(r.plan_name = 'Presencial + Delivery' and r.price_cents = 9900 and r.owner_name = 'Dona Ana' and r.whatsapp = '(35) 97777-0000' and r.current_period_end = current_date + 5, 'empresa: plano, valor, dono, WhatsApp e vencimento');

  -- mensalidade: cobra, não duplica, paga renova 1 mês
  cid := public.admin_charge_subscription(a);
  perform tstf.denied(format('select public.admin_charge_subscription(%L)', a), 'mensalidade duplicada', array['P0001']);
  perform tstf.ok((public.admin_finance_summary()->>'open_cents')::int = 9900, 'a receber');
  perform public.admin_mark_charge_paid(cid, 'pix');
  perform tstf.su();
  perform tstf.ok((select current_period_end = (current_date + 5 + interval '1 month')::date from public.business_subscriptions where id = sid), 'pagamento renova o plano');
  perform tstf.login(m);
  s := public.admin_finance_summary();
  perform tstf.ok((s->>'received_month_cents')::int = 9900 and (s->>'open_cents')::int = 0, 'recebido no mês');
  perform tstf.denied(format($q$select public.admin_mark_charge_paid(%L, 'pix')$q$, cid), 'paga duas vezes', array['P0001']);

  -- comissão do mês fechado a partir dos pedidos
  ccid := public.admin_charge_commission(a, last_month);
  perform tstf.ok((select amount_cents = 340 from public.admin_list_charges(null, a) x where x.id = ccid), 'comissão 140 + taxas 200');
  perform tstf.denied(format('select public.admin_charge_commission(%L, %L)', a, last_month), 'comissão do mês duplicada', array['P0001']);
  perform tstf.denied(format('select public.admin_charge_commission(%L, current_date)', a), 'mês corrente', array['P0001']);
  perform tstf.denied(format('select public.admin_charge_commission(%L, %L)', b, last_month), 'sem pedidos', array['P0001']);
  perform public.admin_cancel_charge(ccid);
  perform tstf.ok((public.admin_finance_summary()->>'open_cents')::int = 0, 'cancelada não entra no a receber');
  perform tstf.ok(tstf.count(format('select 1 from public.audit_logs where action like %L', 'finance.%')) >= 5, 'auditoria');

  -- o estabelecimento vê só o próprio
  perform tstf.login(dono);
  perform tstf.ok(tstf.count('select 1 from public.business_subscriptions') = 1 and tstf.count('select 1 from public.platform_charges') = 2, 'dono vê o próprio plano e cobranças');
  perform tstf.denied($q$update public.platform_charges set status = 'paga'$q$, 'dono marca pago');
  perform tstf.login(outro);
  perform tstf.ok(tstf.count('select 1 from public.platform_charges') = 0, 'outra loja não vê');
  perform tstf.su();
end $$;

do $$ begin raise notice 'RLS_FINANCE_OK'; end $$;
rollback;
