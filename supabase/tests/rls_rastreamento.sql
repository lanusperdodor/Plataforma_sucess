-- Testes da 0037 (rastreamento no mapa). Tudo é revertido. Sucesso: NOTICE 'RLS_RASTREAMENTO_OK'.
begin;
create schema tsrt;
grant usage on schema tsrt to public;
create function tsrt.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tsrt.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsrt.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsrt.denied(stmt text, msg text, codes text[] default array['42501', 'P0001']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsrt.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsrt.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsrt to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000037';
  m uuid; e1 uuid; e2 uuid; func uuid; k1 uuid; kp uuid; c1 uuid; c2 uuid; lan uuid; sup uuid; cheese text; arroz text;
  o1 uuid; o2 uuid; t jsonb; rq jsonb;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Rastreio', 'MG', 'tsrt-cidade');
  m := private.create_auth_user('rt-master@teste.invalid', 'senha-master-1', 'Master RT');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsrt.login(m);
  perform public.admin_create_test_data(city);
  perform tsrt.su();
  e1 := tsrt.uid('empresario1'); e2 := tsrt.uid('empresario2'); func := tsrt.uid('funcionario');
  k1 := tsrt.uid('entregador'); kp := tsrt.uid('entregador2'); c1 := tsrt.uid('cliente1'); c2 := tsrt.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id into sup from public.businesses where owner_id = e2;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';
  select id::text into arroz from public.products where business_id = sup and name = 'Arroz 5 kg';
  perform set_config('tucai.internal', 'on', true);
  update public.businesses set lat = -20.07000, lng = -44.57000 where id in (lan, sup);
  perform set_config('tucai.internal', 'off', true);

  -- pedido com entregador parceiro
  perform tsrt.login(c1);
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'rt-0000001');
  perform tsrt.denied(format($q$select public.customer_set_delivery_point(%L, 10, -44)$q$, o1), 'ponto fora do Brasil');
  perform public.customer_set_delivery_point(o1, -20.081234, -44.581234);
  perform tsrt.ok((select delivery_lat = -20.08123 and delivery_lng = -44.58123 from public.orders where id = o1), 'ponto de entrega gravado (5 casas)');
  perform tsrt.login(c2);
  perform tsrt.denied(format($q$select public.customer_set_delivery_point(%L, -20.1, -44.6)$q$, o1), 'outro cliente não marca ponto no pedido alheio');
  perform tsrt.denied(format($q$select public.delivery_tracking(%L)$q$, o1), 'outro cliente não acompanha o pedido');

  -- antes do aceite ninguém rastreia
  perform tsrt.login(k1);
  perform tsrt.denied(format($q$select public.courier_track_location(%L, -20.07, -44.57)$q$, o1), 'entregador sem aceite não envia posição');
  perform public.set_courier_online(true);
  perform public.courier_accept_delivery(o1);
  -- leitura direta da tabela de posições é proibida para todos
  perform tsrt.denied('select * from public.delivery_locations', 'tabela de posições fechada', array['42501']);
  perform tsrt.denied('select * from public.delivery_routes', 'tabela de rotas fechada', array['42501']);
  perform tsrt.ok(public.courier_track_location(o1, -20.0712345, -44.5712345, 12, 90, 30) = 'coleta', 'posição na perna de coleta');
  perform tsrt.denied(format($q$select public.courier_track_location(%L, -20.07, -44.57, 5, null, null, now() + interval '1 hour')$q$, o1), 'horário no futuro recusado');
  perform tsrt.denied(format($q$select public.courier_track_location(%L, 40.7, -74.0)$q$, o1), 'coordenada fora do Brasil');

  -- cliente: ~100 m antes da coleta; loja vê a aproximação; tick sem coordenadas
  perform tsrt.login(c1);
  t := public.delivery_tracking(o1);
  perform tsrt.ok(t->>'viewer' = 'cliente' and t->>'leg' = 'coleta' and (t->'position'->>'lat')::numeric = -20.071 and (t->'position'->>'accuracy_m')::int >= 100
                  and t->'position'->'heading' = 'null'::jsonb, 'cliente recebe posição arredondada antes da coleta: ' || (t->'position')::text);
  perform tsrt.ok((t->'destination'->>'lat')::numeric = -20.08123, 'cliente vê o próprio destino');
  perform tsrt.ok(tsrt.count(format('select 1 from public.delivery_tracking_ticks where order_id = %L', o1)) = 1, 'cliente recebe o aviso de mudança (RLS)');
  perform tsrt.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_tracking_ticks' and column_name in ('lat', 'lng')),
                  'aviso de tempo real não carrega coordenadas');
  perform tsrt.login(func);
  t := public.delivery_tracking(o1);
  perform tsrt.ok(t->>'viewer' = 'loja' and t->>'leg' = 'coleta' and t->'position' <> 'null'::jsonb and t->'destination' = 'null'::jsonb, 'funcionário vê aproximação para coleta, sem destino do cliente');
  perform tsrt.login(e2);
  perform tsrt.denied(format($q$select public.delivery_tracking(%L)$q$, o1), 'outro estabelecimento não vê');
  perform tsrt.ok(tsrt.count(format('select 1 from public.delivery_tracking_ticks where order_id = %L', o1)) = 0, 'outro estabelecimento não recebe aviso');
  perform tsrt.login(kp);
  perform tsrt.denied(format($q$select public.delivery_tracking(%L)$q$, o1), 'entregador próprio de outra loja não vê');

  -- rota: bilhete de uso único, teto por entrega
  perform tsrt.login(c1);
  perform tsrt.denied(format($q$select public.route_request(%L, 'coleta')$q$, o1), 'cliente não pede rota');
  perform tsrt.login(k1);
  perform tsrt.denied(format($q$select public.route_request(%L, 'entrega')$q$, o1), 'rota de outra etapa recusada');
  rq := public.route_request(o1, 'coleta');
  perform tsrt.ok((rq->'destination'->>'lat')::numeric = -20.07 and (rq->'origin'->>'lat')::numeric = -20.07123, 'rota da posição atual até a loja');
  perform tsrt.denied(format($q$select public.route_request(%L, 'coleta')$q$, o1), 'nova rota em menos de 90 s recusada');
  perform public.route_store((rq->>'ticket')::uuid, '[[-44.57123,-20.07123],[-44.57,-20.07]]'::jsonb, 180, 40, 'teste');
  perform tsrt.denied(format($q$select public.route_store(%L, '[[0,0],[1,1]]'::jsonb, 1, 1, 'x')$q$, rq->>'ticket'), 'bilhete não é reutilizável');
  perform tsrt.login(c1);
  t := public.delivery_tracking(o1);
  perform tsrt.ok((t->'route'->>'distance_m')::int = 180 and jsonb_array_length(t->'route'->'geometry') = 2, 'cliente vê a rota gravada');

  -- coleta: precisão do cliente melhora; loja deixa de ver
  perform tsrt.login(e1);
  perform public.update_order_status(o1, 'accepted');
  perform public.update_order_status(o1, 'preparing');
  perform public.update_order_status(o1, 'ready');
  perform tsrt.login(k1);
  perform public.courier_pickup_delivery(o1);
  perform tsrt.ok(public.courier_track_location(o1, -20.0755555, -44.5755555) = 'entrega', 'posição na perna de entrega');
  perform tsrt.login(c1);
  t := public.delivery_tracking(o1);
  perform tsrt.ok(t->>'leg' = 'entrega' and (t->'position'->>'lat')::numeric = -20.0756, 'cliente recebe ~10 m depois da coleta');
  perform tsrt.ok(t->'route' = 'null'::jsonb, 'rota da coleta não aparece na perna de entrega');
  perform tsrt.login(func);
  t := public.delivery_tracking(o1);
  perform tsrt.ok(t->'leg' = 'null'::jsonb and t->'position' = 'null'::jsonb, 'loja não acompanha depois da coleta');

  -- Master vê com auditoria (uma vez a cada 30 min)
  perform tsrt.login(m);
  perform public.delivery_tracking(o1); perform public.delivery_tracking(o1);
  perform tsrt.ok((select count(*) from public.audit_logs where action = 'tracking.view' and entity_id = o1::text) = 1, 'acesso do Master auditado sem inundar a auditoria');

  -- entregador para de compartilhar; ao concluir tudo é apagado
  perform tsrt.login(k1);
  perform public.courier_track_location(o1, -20.0760000, -44.5760000);
  perform tsrt.su();
  perform set_config('tucai.internal', 'on', true);
  update public.deliveries set status = 'delivered', delivered_at = now() where order_id = o1;
  perform set_config('tucai.internal', 'off', true);
  perform tsrt.ok(not exists (select 1 from public.delivery_locations where order_id = o1) and not exists (select 1 from public.delivery_routes where order_id = o1),
                  'entrega concluída apaga posição e rotas');
  perform tsrt.login(k1);
  perform tsrt.denied(format($q$select public.courier_track_location(%L, -20.07, -44.57)$q$, o1), 'depois de concluir não envia mais');

  -- entregador próprio: só o pedido atribuído a ele
  perform tsrt.login(c1);
  o2 := public.place_order(sup, jsonb_build_array(jsonb_build_object('product_id', arroz, 'quantity', 1)), 'delivery_own', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'rt-0000002');
  perform tsrt.login(kp);
  perform tsrt.denied(format($q$select public.courier_track_location(%L, -20.07, -44.57)$q$, o2), 'entregador próprio sem atribuição não envia');
  perform tsrt.login(e2);
  perform public.update_order_status(o2, 'accepted');
  perform public.merchant_assign_own_courier(o2, kp);
  perform tsrt.login(kp);
  perform tsrt.ok(public.courier_track_location(o2, -20.0701, -44.5701) = 'coleta', 'entregador próprio atribuído envia posição');
  perform tsrt.login(k1);
  perform tsrt.denied(format($q$select public.courier_track_location(%L, -20.07, -44.57)$q$, o2), 'entregador parceiro não envia em entrega própria');
  perform public.courier_stop_tracking(o2);  -- não é dele: não apaga nada
  perform tsrt.login(kp);
  perform public.courier_stop_tracking(o2);
  perform tsrt.su();
  perform tsrt.ok(not exists (select 1 from public.delivery_locations where order_id = o2), 'parar de compartilhar apaga a posição');

  raise notice 'RLS_RASTREAMENTO_OK';
end $$;
rollback;
