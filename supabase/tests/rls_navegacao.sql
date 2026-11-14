-- Testes da 0037 (rastreamento no mapa). Tudo é revertido. Sucesso: NOTICE 'RLS_RASTREAMENTO_OK'.
begin;
create schema tsnv;
grant usage on schema tsnv to public;
create function tsnv.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tsnv.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsnv.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsnv.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsnv.denied(stmt text, msg text, codes text[] default array['42501', 'P0001']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsnv.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsnv.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsnv to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000046';
  m uuid; e1 uuid; e2 uuid; func uuid; k1 uuid; kp uuid; c1 uuid; c2 uuid; lan uuid; sup uuid; cheese text; arroz text;
  o1 uuid; o2 uuid; t jsonb; rq jsonb;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Navegação', 'MG', 'tsnv-cidade');
  m := private.create_auth_user('nv-master@teste.invalid', 'senha-master-1', 'Master NV');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsnv.login(m);
  perform public.admin_create_test_data(city);
  perform tsnv.su();
  e1 := tsnv.uid('empresario1'); e2 := tsnv.uid('empresario2'); func := tsnv.uid('funcionario');
  k1 := tsnv.uid('entregador'); kp := tsnv.uid('entregador2'); c1 := tsnv.uid('cliente1'); c2 := tsnv.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id into sup from public.businesses where owner_id = e2;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';
  select id::text into arroz from public.products where business_id = sup and name = 'Arroz 5 kg';
  perform set_config('tucai.internal', 'on', true);
  update public.businesses set lat = -20.07000, lng = -44.57000 where id in (lan, sup);
  perform set_config('tucai.internal', 'off', true);

  -- pedido com entregador parceiro
  perform tsnv.login(c1);
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'nv-0000001');
  perform tsnv.denied(format($q$select public.customer_set_delivery_point(%L, 10, -44)$q$, o1), 'ponto fora do Brasil');
  perform public.customer_set_delivery_point(o1, -20.081234, -44.581234);
  perform tsnv.ok((select delivery_lat = -20.08123 and delivery_lng = -44.58123 from public.orders where id = o1), 'ponto de entrega gravado (5 casas)');
  perform tsnv.login(c2);
  perform tsnv.denied(format($q$select public.customer_set_delivery_point(%L, -20.1, -44.6)$q$, o1), 'outro cliente não marca ponto no pedido alheio');
  perform tsnv.denied(format($q$select public.delivery_tracking(%L)$q$, o1), 'outro cliente não acompanha o pedido');

  -- antes do aceite ninguém rastreia
  perform tsnv.login(k1);
  perform tsnv.denied(format($q$select public.courier_track_location(%L, -20.07, -44.57)$q$, o1), 'entregador sem aceite não envia posição');
  perform public.set_courier_online(true);
  perform public.courier_accept_delivery(o1);
  -- leitura direta da tabela de posições é proibida para todos
  perform tsnv.denied('select * from public.delivery_locations', 'tabela de posições fechada', array['42501']);
  perform tsnv.denied('select * from public.delivery_routes', 'tabela de rotas fechada', array['42501']);
  perform tsnv.ok(public.courier_track_location(o1, -20.0712345, -44.5712345, 12, 90, 30) = 'coleta', 'posição na perna de coleta');
  perform tsnv.denied(format($q$select public.courier_track_location(%L, -20.07, -44.57, 5, null, null, now() + interval '1 hour')$q$, o1), 'horário no futuro recusado');
  perform tsnv.denied(format($q$select public.courier_track_location(%L, 40.7, -74.0)$q$, o1), 'coordenada fora do Brasil');

  -- cliente: ~100 m antes da coleta; loja vê a aproximação; tick sem coordenadas
  perform tsnv.login(c1);
  t := public.delivery_tracking(o1);
  perform tsnv.ok(t->>'viewer' = 'cliente' and t->>'leg' = 'coleta' and (t->'position'->>'lat')::numeric = -20.071 and (t->'position'->>'accuracy_m')::int >= 100
                  and t->'position'->'heading' = 'null'::jsonb, 'cliente recebe posição arredondada antes da coleta: ' || (t->'position')::text);
  perform tsnv.ok((t->'destination'->>'lat')::numeric = -20.08123, 'cliente vê o próprio destino');
  perform tsnv.ok(tsnv.count(format('select 1 from public.delivery_tracking_ticks where order_id = %L', o1)) = 1, 'cliente recebe o aviso de mudança (RLS)');
  perform tsnv.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_tracking_ticks' and column_name in ('lat', 'lng')),
                  'aviso de tempo real não carrega coordenadas');
  perform tsnv.login(func);
  t := public.delivery_tracking(o1);
  perform tsnv.ok(t->>'viewer' = 'loja' and t->>'leg' = 'coleta' and t->'position' <> 'null'::jsonb and t->'destination' = 'null'::jsonb, 'funcionário vê aproximação para coleta, sem destino do cliente');
  perform tsnv.login(e2);
  perform tsnv.denied(format($q$select public.delivery_tracking(%L)$q$, o1), 'outro estabelecimento não vê');
  perform tsnv.ok(tsnv.count(format('select 1 from public.delivery_tracking_ticks where order_id = %L', o1)) = 0, 'outro estabelecimento não recebe aviso');
  perform tsnv.login(kp);
  perform tsnv.denied(format($q$select public.delivery_tracking(%L)$q$, o1), 'entregador próprio de outra loja não vê');

  -- ofertas: distância da entrega e ponto aproximado da loja (≈100 m), sem dados do cliente
  -- (o pedido acima já foi aceito; um segundo pedido fica em oferta)
  perform tsnv.login(c2);
  o2 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 2', '(35) 99999-0002', 'Rua B, 2, Centro', null, null, null, 'nv-0000002');
  perform tsnv.su();
  update public.orders set delivery_distance_m = 2260 where id = o2;
  perform tsnv.login(kp);
  perform tsnv.denied('select * from public.courier_list_offers()', 'entregador próprio (sem cadastro de independente) não lista ofertas');
  perform tsnv.login(k1);
  perform tsnv.ok(exists (select 1 from public.courier_list_offers() f where f.order_id = o2 and f.delivery_distance_m = 2260 and f.store_lat = -20.070 and f.store_lng = -44.570),
                  'oferta com distância da entrega e ponto aproximado da loja');
  perform tsnv.ok(not exists (select 1 from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
                   where r.routine_schema = 'public' and r.routine_name = 'courier_list_offers' and p.parameter_name in ('delivery_lat', 'delivery_lng', 'customer_name')),
                  'oferta não traz ponto nem nome do cliente');
  perform tsnv.login(c1);
  perform tsnv.denied('select * from public.courier_list_offers()', 'cliente lista ofertas');

  -- instruções de conversão: só o entregador da etapa
  perform tsnv.login(k1);
  rq := public.route_request(o1, 'coleta');
  perform public.route_store((rq->>'ticket')::uuid, '[[-44.57123,-20.07123],[-44.5705,-20.0712],[-44.57,-20.07]]'::jsonb, 180, 40, 'teste',
    '[{"text":"Siga pela <b>Rua A</b>","type":"depart","distance_m":80,"at":[-44.57123,-20.07123]},{"text":"Vire à direita na Av. Principal","type":"turn-right","distance_m":100,"at":[-44.5705,-20.0712]},{"text":"Você chegou","type":"arrive","distance_m":0,"at":[-44.57,-20.07]},"lixo"]'::jsonb);
  t := public.courier_route_steps(o1);
  perform tsnv.ok(t->>'leg' = 'coleta' and jsonb_array_length(t->'steps') = 3, 'instruções gravadas (item inválido descartado): ' || (t->'steps')::text);
  perform tsnv.ok((t->'steps'->0->>'text') = 'Siga pela bRua A/b', 'texto sem < >: ' || (t->'steps'->0->>'text'));
  perform tsnv.ok((t->'steps'->1->>'type') = 'turn-right' and (t->'steps'->1->>'distance_m')::int = 100, 'tipo e distância da conversão');
  perform tsnv.ok(((public.delivery_tracking(o1))->'route'->>'distance_m')::int = 180, 'rota da etapa salva junto');
  perform tsnv.login(c1);
  perform tsnv.denied(format('select public.courier_route_steps(%L)', o1), 'cliente não lê as instruções do entregador');
  perform tsnv.login(e1);
  perform tsnv.denied(format('select public.courier_route_steps(%L)', o1), 'loja não lê as instruções');
  perform tsnv.login(kp);
  perform tsnv.denied(format('select public.courier_route_steps(%L)', o1), 'outro entregador não lê');
  perform tsnv.anon();
  perform tsnv.denied(format('select public.courier_route_steps(%L)', o1), 'anônimo não lê');
  -- a versão antiga (sem instruções) continua funcionando
  perform tsnv.su();
  delete from private.route_requests where order_id = o1;
  perform tsnv.login(k1);
  rq := public.route_request(o1, 'coleta');
  perform public.route_store((rq->>'ticket')::uuid, '[[-44.57123,-20.07123],[-44.57,-20.07]]'::jsonb, 190, 41, 'teste');
  perform tsnv.ok(((public.delivery_tracking(o1))->'route'->>'distance_m')::int = 190, 'rota sem instruções ainda é aceita');
  raise notice 'RLS_NAVEGACAO_OK';
end $$;
rollback;
