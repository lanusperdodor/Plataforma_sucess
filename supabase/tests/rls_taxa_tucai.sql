-- 0044: R$ 1 da Tucaí por entrega concluída (independente ou própria), sem duplicar; própria fora da rede. Tudo é revertido.
-- Sucesso: 'RLS_TAXA_TUCAI_OK'.
begin;
create schema tstx;
grant usage on schema tstx to public;
create function tstx.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true); set role authenticated; end $$;
create function tstx.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstx.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstx.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege or raise_exception then return; end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', msg;
end $$;
create function tstx.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tstx to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000045';
  m uuid; e1 uuid; e2 uuid; k1 uuid; kp uuid; c1 uuid; lan uuid; sup uuid; cheese text; arroz text; op uuid; oo uuid; r public.orders%rowtype; total int; n int;
  ref date := (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month')::date;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Taxa', 'MG', 'tstx-cidade');
  m := private.create_auth_user('tx-master@teste.invalid', 'senha-master-1', 'Master TX');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tstx.login(m);
  perform public.admin_create_test_data(city);
  perform tstx.su();
  e1 := tstx.uid('empresario1'); e2 := tstx.uid('empresario2'); k1 := tstx.uid('entregador'); kp := tstx.uid('entregador2'); c1 := tstx.uid('cliente1');
  select id into lan from public.businesses where owner_id = e1;
  select id into sup from public.businesses where owner_id = e2;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';
  select id::text into arroz from public.products where business_id = sup and name = 'Arroz 5 kg';

  -- entrega com entregador independente: Tucaí 1, entregador = cliente + loja − 1 (não sai do ganho dele)
  perform tstx.login(c1);
  op := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'tx-0000001');
  select * into r from public.orders where id = op;
  perform tstx.ok(r.platform_delivery_fee_cents = 100 and r.courier_pay_cents = r.delivery_fee_cents + r.merchant_delivery_contribution_cents - 100 and r.delivery_subsidy_cents = 0,
                  'independente: Tucaí 1 e entregador = cliente + loja − 1 (' || r.courier_pay_cents || ')');

  -- entrega própria: Tucaí 1 (da tabela vigente), sem valores da rede; frete é o da loja
  oo := public.place_order(sup, jsonb_build_array(jsonb_build_object('product_id', arroz, 'quantity', 1)), 'delivery_own', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'tx-0000002');
  select * into r from public.orders where id = oo;
  perform tstx.ok(r.platform_delivery_fee_cents = 100 and r.courier_pay_cents = 0 and r.merchant_delivery_contribution_cents = 0 and r.delivery_band is null,
                  'própria: Tucaí 1, sem pagamento da rede');
  perform tstx.su();
  perform tstx.ok(r.delivery_fee_cents = (select own_delivery_fee_cents from public.businesses where id = sup), 'própria: frete definido pela loja');

  -- só entrega concluída entra na cobrança (datas do mês passado: desliga o carimbo automático só neste teste)
  perform tstx.su();
  alter table public.orders disable trigger orders_updated;
  update public.orders set is_test = false, updated_at = ref + interval '10 days' where id in (op, oo);
  total := private.store_charge_total(sup, ref::timestamp at time zone 'America/Sao_Paulo', (ref + interval '1 month')::timestamp at time zone 'America/Sao_Paulo');
  perform tstx.ok(total = 0, 'pedido não entregue não é cobrado');
  update public.orders set status = 'delivered', updated_at = ref + interval '10 days' where id = oo;
  total := private.store_charge_total(sup, ref::timestamp at time zone 'America/Sao_Paulo', (ref + interval '1 month')::timestamp at time zone 'America/Sao_Paulo');
  perform tstx.ok(total = (select commission_cents + 100 from public.orders where id = oo), 'própria entregue: loja paga R$ 1 (uma vez) + comissão: ' || total);

  alter table public.orders enable trigger orders_updated;
  -- cobrança do mês: uma vez só
  perform tstx.login(m);
  perform public.admin_charge_commission(sup, ref);
  perform tstx.denied(format('select public.admin_charge_commission(%L, %L::date)', sup, ref), 'cobrança duplicada do mesmo mês');
  perform tstx.su();
  select count(*) into n from public.platform_charges where business_id = sup and kind = 'comissao' and reference_month = ref;
  perform tstx.ok(n = 1, 'um único lançamento no mês');

  -- receita no Financeiro do Master
  perform tstx.login(m);
  perform tstx.ok((public.admin_delivery_money(ref, (ref + interval '1 month - 1 day')::date, true)->>'tucai_proprias_cents')::int >= 100, 'Master vê a receita da entrega própria');

  -- taxa nunca abaixo de R$ 1
  perform tstx.denied($q$select public.admin_set_delivery_pricing('[{"ate_m":1500,"entregador_cents":500}]'::jsonb, 50, 500, 200, false)$q$, 'taxa da Tucaí abaixo de R$ 1');

  -- entregador próprio COM cadastro aprovado de parceiro também vê e aceita ofertas da rede (0052)
  perform tstx.su();
  perform tstx.ok(private.is_any_own_courier(kp), 'Entregador 2 é entregador próprio do supermercado');
  -- 0055: já logado, fica Online direto (sem página de cadastro): cidade da loja, nome do perfil
  perform tstx.ok(not exists (select 1 from public.couriers where user_id = kp), 'entregador próprio ainda sem cadastro de parceiro');
  perform tstx.login(k1);
  perform tstx.denied($q$select public.own_courier_go_online()$q$, 'independente usa a função do próprio');
  perform tstx.login(kp);
  -- 0056: um clique, sem digitar nada (dados vêm da conta; veículo fica não informado)
  perform tstx.ok(public.own_courier_go_online() = 'approved', 'liberado na hora com um clique');
  perform tstx.su();
  perform tstx.ok((select is_online and city_id = (select city_id from public.businesses where id = sup) and vehicle is null
                          and full_name = (select full_name from public.profiles where id = kp) from public.couriers where user_id = kp),
                  'Online, na cidade da loja, com o nome do perfil e sem veículo inventado');
  perform tstx.login(kp);
  perform public.set_courier_online(false);
  perform tstx.ok(public.own_courier_go_online() = 'approved', 'próximas vezes: só fica Online');
  perform tstx.su();
  perform tstx.ok((select is_online from public.couriers where user_id = kp), 'Online de novo');
  perform tstx.login(kp);
  perform tstx.ok(exists (select 1 from public.courier_list_offers() where order_id = op), 'entregador próprio com cadastro de parceiro vê a oferta da rede');
  perform tstx.login(k1);
  perform public.set_courier_online(true);
  perform tstx.ok(exists (select 1 from public.courier_list_offers() where order_id = op), 'independente vê a mesma oferta');
  perform tstx.login(kp);
  perform public.courier_accept_delivery(op);
  perform tstx.login(k1);
  perform tstx.ok(not exists (select 1 from public.courier_list_offers() where order_id = op), 'aceita pelo primeiro: some para os outros');
  perform tstx.denied(format('select public.courier_accept_delivery(%L)', op), 'segundo entregador aceita a mesma entrega');
  raise notice 'RLS_TAXA_TUCAI_OK';
end $$;
rollback;
