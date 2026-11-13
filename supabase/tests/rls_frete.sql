-- 0040: frete por distância por ruas. Tudo é revertido. Sucesso: 'RLS_FRETE_OK'.
begin;
create schema tsfr;
grant usage on schema tsfr to public;
create function tsfr.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true); set role authenticated; end $$;
create function tsfr.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsfr.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsfr.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsfr.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege or raise_exception then return; end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', msg;
end $$;
create function tsfr.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsfr to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000043';
  m uuid; e1 uuid; e2 uuid; k1 uuid; c1 uuid; c2 uuid; lan uuid; sup uuid; cheese text; arroz text; key text; q jsonb; o uuid; r public.orders%rowtype; total int;
  ok_items jsonb;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Frete', 'MG', 'tsfr-cidade');
  m := private.create_auth_user('fr-master@teste.invalid', 'senha-master-1', 'Master FR');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsfr.login(m);
  perform public.admin_create_test_data(city);
  key := public.admin_generate_integration_key();
  perform tsfr.su();
  e1 := tsfr.uid('empresario1'); e2 := tsfr.uid('empresario2'); k1 := tsfr.uid('entregador'); c1 := tsfr.uid('cliente1'); c2 := tsfr.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id into sup from public.businesses where owner_id = e2;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';
  ok_items := jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1));

  -- tabela aprovada (versão 1)
  perform tsfr.ok((public.delivery_pricing_current()->>'versao')::int = 2, 'tabela vigente (0043: versão 2, 5/6/6)');
  perform tsfr.ok((select count(*) = 1 from public.delivery_pricing where version = 1 and not is_current), 'versão 1 (5/6/7) guardada no histórico');
  perform tsfr.ok((select (private.delivery_split(1500, false, p)) = '{"faixa":1,"versao":2,"distancia_m":1500,"loja_cents":200,"custo_cents":600,"tucai_cents":100,"cliente_cents":400,"frete_gratis":false,"subsidio_cents":0,"entregador_cents":500}'::jsonb from public.delivery_pricing p where is_current), 'até 1,5 km: 5 + 1 = 6 → cliente 4, loja 2');
  perform tsfr.ok((select private.delivery_split(2400, false, p)->>'cliente_cents' = '500' and private.delivery_split(2400, false, p)->>'entregador_cents' = '600' and private.delivery_split(2400, false, p)->>'subsidio_cents' = '0' from public.delivery_pricing p where is_current), '1,5 a 3 km: 6 + 1 = 7 → cliente 5, loja 2');
  perform tsfr.ok((select private.delivery_split(4200, false, p)->>'entregador_cents' = '600' and private.delivery_split(4200, false, p)->>'cliente_cents' = '500' and private.delivery_split(4200, false, p)->>'loja_cents' = '200' and private.delivery_split(4200, false, p)->>'tucai_cents' = '100' and private.delivery_split(4200, false, p)->>'subsidio_cents' = '0' from public.delivery_pricing p where is_current), '3 a 5 km: cliente 5 + loja 2 = 7 − Tucaí 1 = entregador 6, sem subsídio');
  perform tsfr.ok((select private.delivery_split(5001, false, p) is null from public.delivery_pricing p where is_current), 'acima de 5 km: fora da área');
  perform tsfr.ok((select private.delivery_split(4200, true, p)->>'cliente_cents' = '0' and private.delivery_split(4200, true, p)->>'loja_cents' = '700' and private.delivery_split(4200, true, p)->>'entregador_cents' = '600' from public.delivery_pricing p where is_current), 'frete grátis: cliente 0, loja assume o custo total; entregador não perde');

  -- cotação: só com a chave de integração (o navegador não consegue gravar distância)
  perform tsfr.anon();
  perform tsfr.denied(format($q$select public.worker_store_delivery_quote('chave-falsa-chave-falsa-chave-falsa-00', %L, %L, -20.08, -44.58, 100, 30, 'x')$q$, c1, lan), 'cotação sem a chave do Worker');
  perform tsfr.login(c1);
  perform tsfr.denied(format($q$insert into public.delivery_quotes(customer_id, business_id, lat, lng, distance_m, duration_s, provider) values (%L, %L, -20.08, -44.58, 10, 1, 'eu')$q$, c1, lan), 'cliente grava cotação direto');
  perform tsfr.anon();
  q := public.worker_store_delivery_quote(key, c1, lan, -20.08123, -44.58123, 2400, 420, 'openrouteservice');
  perform tsfr.ok((q->'split'->>'cliente_cents') = '500' and not (q->>'fora_da_area')::boolean, 'Worker grava a cotação: 2,4 km → frete R$ 5');
  perform tsfr.ok((public.worker_business_point(key, lan)->>'delivery_offer') = 'partner', 'Worker lê o ponto da loja com a chave');

  -- pedido usa a cotação (2,4 km) e ignora qualquer valor do navegador
  perform tsfr.login(c1);
  o := public.place_order(lan, ok_items, 'delivery_partner', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'fr-0000001');
  select * into r from public.orders where id = o;
  perform tsfr.ok(r.delivery_fee_cents = 500 and r.merchant_delivery_contribution_cents = 200 and r.courier_pay_cents = 600 and r.platform_delivery_fee_cents = 100
                  and r.delivery_subsidy_cents = 0 and r.delivery_band = 2 and r.delivery_distance_m = 2400 and r.total_cents = r.subtotal_cents + 500, 'pedido de 2,4 km: 5/2/6/1');
  perform tsfr.ok(r.delivery_lat = -20.08123 and r.delivery_lng = -44.58123, 'ponto de entrega da cotação gravado no pedido');
  perform tsfr.login(k1); perform public.set_courier_online(true);
  perform tsfr.ok((select courier_pay_cents from public.courier_list_offers() x where x.order_id = o) = 600, 'Entregador 1 vê R$ 6 na oferta antes de aceitar');
  perform tsfr.su();
  perform tsfr.ok((select used_at is not null from public.delivery_quotes where id = (q->>'quote_id')::uuid), 'cotação usada uma vez só');
  perform tsfr.login(c1);
  -- valores do pedido continuam imutáveis para o cliente
  perform tsfr.denied(format($q$update public.orders set delivery_fee_cents = 0 where id = %L$q$, o), 'cliente zera o frete depois');

  -- cotação de outro cliente não serve; cotação vencida não serve
  perform tsfr.anon();
  q := public.worker_store_delivery_quote(key, c1, lan, -20.09, -44.59, 4200, 600, 'openrouteservice');
  perform tsfr.login(c2);
  o := public.place_order(lan, ok_items, 'delivery_partner', 'cash', 'Cliente 2', '(35) 99999-0002', 'Rua B, 2, Centro', null, null, null, 'fr-0000002');
  perform tsfr.ok((select delivery_band = 1 and delivery_fee_cents = 400 and delivery_quote_id is null from public.orders where id = o), 'cotação do Cliente 1 não vale para o Cliente 2 (sem cotação: 1ª faixa)');
  perform tsfr.su();
  update public.delivery_quotes set expires_at = now() - interval '1 minute' where id = (q->>'quote_id')::uuid;
  perform tsfr.login(c1);
  o := public.place_order(lan, ok_items, 'delivery_partner', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'fr-0000003');
  perform tsfr.ok((select delivery_band = 1 and delivery_quote_id is null from public.orders where id = o), 'cotação vencida é ignorada');

  -- 3 a 5 km: Tucaí recebe R$ 1, entregador R$ 6, sem subsídio
  perform tsfr.anon();
  q := public.worker_store_delivery_quote(key, c1, lan, -20.10, -44.60, 4800, 700, 'openrouteservice');
  perform tsfr.login(c1);
  o := public.place_order(lan, ok_items, 'delivery_partner', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua C, 3, Centro', null, null, null, 'fr-0000004');
  perform tsfr.ok((select delivery_fee_cents = 500 and merchant_delivery_contribution_cents = 200 and courier_pay_cents = 600 and platform_delivery_fee_cents = 100 and delivery_subsidy_cents = 0 and delivery_band = 3 from public.orders where id = o), '4,8 km: cliente 5, loja 2, entregador 6, Tucaí 1');

  -- acima de 5 km: recusado
  perform tsfr.anon();
  q := public.worker_store_delivery_quote(key, c1, lan, -20.20, -44.70, 7300, 900, 'openrouteservice');
  perform tsfr.ok((q->>'fora_da_area')::boolean, 'cotação de 7,3 km: fora da área');
  perform tsfr.login(c1);
  begin
    perform public.place_order(lan, ok_items, 'delivery_partner', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua D, 4', null, null, null, 'fr-0000005');
    raise exception 'FALHOU: pedido acima de 5 km deveria ser recusado';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if;
  end;

  -- frete grátis da loja
  perform tsfr.login(c2);
  perform tsfr.denied(format($q$select public.merchant_set_free_delivery(%L, true)$q$, lan), 'cliente liga frete grátis da loja');
  perform tsfr.login(e1);
  perform public.merchant_set_free_delivery(lan, true);
  perform tsfr.anon();
  q := public.worker_store_delivery_quote(key, c2, lan, -20.09, -44.59, 2900, 500, 'openrouteservice');
  perform tsfr.login(c2);
  o := public.place_order(lan, ok_items, 'delivery_partner', 'cash', 'Cliente 2', '(35) 99999-0002', 'Rua B, 2, Centro', null, null, null, 'fr-0000006');
  perform tsfr.ok((select delivery_fee_cents = 0 and merchant_delivery_contribution_cents = 700 and courier_pay_cents = 600 and total_cents = subtotal_cents from public.orders where id = o), 'frete grátis: cliente 0, loja 7 (6 + 1)');
  perform tsfr.login(e1);
  perform public.merchant_set_free_delivery(lan, false);

  -- Master: nova tabela (versão 2) e exigir cálculo; pedidos antigos mantêm os valores
  perform tsfr.login(c1);
  perform tsfr.denied($q$select public.admin_set_delivery_pricing('[{"ate_m":1000,"entregador_cents":100}]'::jsonb, 100, 500, 200, false)$q$, 'cliente muda a tabela de frete');
  perform tsfr.login(m);
  perform tsfr.denied($q$select public.admin_set_delivery_pricing('[{"ate_m":3000,"entregador_cents":500},{"ate_m":2000,"entregador_cents":600}]'::jsonb, 100, 500, 200, false)$q$, 'faixas fora de ordem');
  perform tsfr.denied($q$select public.admin_set_delivery_pricing('[{"ate_m":1500,"entregador_cents":500},{"ate_m":5000,"entregador_cents":700}]'::jsonb, 100, 500, 200, false)$q$, 'tabela em que a Tucaí deixaria de receber (7 + 1 > 5 + 2)');
  perform tsfr.ok(public.admin_set_delivery_pricing('[{"ate_m":1500,"entregador_cents":500},{"ate_m":3000,"entregador_cents":600},{"ate_m":5000,"entregador_cents":600},{"ate_m":8000,"entregador_cents":800}]'::jsonb, 100, 600, 300, true) = 3, 'Master cria a versão 3 (faixa até 8 km, com cliente até 6 e loja até 3)');
  perform tsfr.ok(exists (select 1 from public.audit_logs where action = 'finance.delivery_pricing'), 'mudança auditada');
  perform tsfr.ok((select delivery_fee_cents = 500 and delivery_band = 2 from public.orders where idempotency_key = 'fr-0000001'), 'pedido antigo não muda');
  perform tsfr.login(c1);
  begin
    perform public.place_order(lan, ok_items, 'delivery_partner', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua A, 1', null, null, null, 'fr-0000007');
    raise exception 'FALHOU: com exigência de cálculo, pedido sem cotação deveria ser recusado';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if;
  end;

  -- retirada e entrega própria não usam as faixas
  select id::text into arroz from public.products where business_id = sup and name = 'Arroz 5 kg';
  o := public.place_order(sup, jsonb_build_array(jsonb_build_object('product_id', arroz, 'quantity', 1)), 'delivery_own', 'cash', 'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'fr-0000008');
  perform tsfr.ok((select delivery_band is null and courier_pay_cents = 0 from public.orders where id = o), 'entrega própria: modelo da loja, sem faixa');

  -- cobrança mensal à loja inclui frete repassado + parte da loja (pedidos reais; aqui verificado com a função)
  perform tsfr.su();
  update public.orders set is_test = false, status = 'delivered' where idempotency_key in ('fr-0000001', 'fr-0000004');
  total := private.store_charge_total(lan, now() - interval '1 day', now() + interval '1 day');
  perform tsfr.ok(total = (select sum(commission_cents + delivery_fee_cents + merchant_delivery_contribution_cents)::int from public.orders where idempotency_key in ('fr-0000001', 'fr-0000004')),
                  'cobrança da loja = comissão + frete recebido dos clientes + parte da loja: ' || total);
  -- 0041: a loja marca o próprio ponto no mapa; outra loja, cliente e anônimo não
  perform tsfr.login(e1);
  perform public.merchant_set_location(lan, -20.0801234, -44.5801234);
  perform tsfr.ok((public.merchant_location(lan)->>'lat')::numeric = -20.080123, 'dono marca a loja no mapa');
  perform tsfr.denied(format('select public.merchant_set_location(%L, -20.1, -44.6)', sup), 'empresário marca o mapa de outra loja');
  perform tsfr.denied(format('select public.merchant_set_location(%L, 40.7, -74.0)', lan), 'ponto fora do Brasil');
  perform tsfr.denied(format('select public.merchant_set_location(%L, -20.1, null)', lan), 'só latitude');
  perform tsfr.denied(format($q$update public.businesses set lat = 0, lng = 0 where id = %L$q$, sup), 'update direto de outra loja');
  perform tsfr.login(c1);
  perform tsfr.denied(format('select public.merchant_set_location(%L, -20.1, -44.6)', lan), 'cliente muda o local da loja');
  perform tsfr.denied(format('select public.merchant_location(%L)', lan), 'cliente lê pelo painel');
  perform tsfr.anon();
  perform tsfr.denied(format('select public.merchant_set_location(%L, -20.1, -44.6)', lan), 'anônimo muda o local da loja');
  perform tsfr.login(m);
  perform public.merchant_set_location(lan, -20.08, -44.58);
  perform tsfr.ok((select lat = -20.08 from public.businesses where id = lan), 'Master corrige o ponto da loja');
  raise notice 'RLS_FRETE_OK';
end $$;
rollback;
