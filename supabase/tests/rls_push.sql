-- Testes da 0053 (aviso de corrida por Web Push). Tudo é revertido. Sucesso: NOTICE 'RLS_PUSH_OK'.
begin;
create schema tspu;
grant usage on schema tspu to public;
create function tspu.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tspu.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tspu.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tspu.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tspu.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege or invalid_parameter_value or raise_exception then return; end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', msg;
end $$;
create function tspu.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tspu.ep(n text) returns text language sql immutable as $$ select 'https://fcm.googleapis.com/fcm/send/' || n $$;
grant execute on all functions in schema tspu to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000053';
  other constant uuid := '12129000-0000-0000-0000-000000000054';
  m uuid; e1 uuid; k1 uuid; k3 uuid; kx uuid; koff uuid; c1 uuid; c2 uuid; lan uuid; cheese text; o1 uuid; o2 uuid; run uuid; u uuid;
  key text; eps text[];
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Push', 'MG', 'tspu-cidade'), (other, 'Outra Push', 'MG', 'tspu-outra');
  m := private.create_auth_user('pu-master@teste.invalid', 'senha-master-1', 'Master PU');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tspu.login(m);
  perform public.admin_create_test_data(city);
  key := public.admin_generate_integration_key();
  perform tspu.su();
  e1 := tspu.uid('empresario1'); k1 := tspu.uid('entregador'); c1 := tspu.uid('cliente1'); c2 := tspu.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';
  select id into run from private.test_data_runs where removed_at is null order by created_at desc limit 1;
  k3 := private.create_auth_user('pu-k3@teste.invalid', 'senha-k3-0001', 'Entregador 3');
  kx := private.create_auth_user('pu-kx@teste.invalid', 'senha-kx-0001', 'Entregador outra cidade');
  koff := private.create_auth_user('pu-off@teste.invalid', 'senha-off-001', 'Entregador offline');
  update private.test_data_runs set user_ids = user_ids || array[k3, kx, koff] where id = run;
  foreach u in array array[k3, kx, koff] loop
    insert into public.user_roles(user_id, role) values (u, 'courier_partner') on conflict do nothing;
    insert into public.couriers(user_id, full_name, phone, city_id, vehicle, status, is_online, terms_version, terms_accepted_at)
    values (u, 'Entregador Teste', '35999990000', case when u = kx then other else city end, 'bicicleta', 'approved', u <> koff, 'v1', now());
  end loop;

  -- ativar avisos: só o próprio usuário, só endereços de serviços de push conhecidos
  perform tspu.login(k1); perform public.set_courier_online(true);
  perform public.push_subscribe(tspu.ep('k1'));
  perform tspu.denied($q$select public.push_subscribe('https://exemplo.invalid/qualquer')$q$, 'endereço fora dos serviços de push');
  perform tspu.denied($q$select public.push_subscribe('http://fcm.googleapis.com/x')$q$, 'endereço sem https');
  perform tspu.login(k3); perform public.push_subscribe(tspu.ep('k3'));
  perform tspu.login(kx); perform public.push_subscribe(tspu.ep('kx'));
  perform tspu.login(koff); perform public.push_subscribe(tspu.ep('off'));
  perform tspu.login(k1);
  perform tspu.ok((select count(*) from public.push_subscriptions) = 1, 'cada um vê só o próprio aparelho');
  perform tspu.denied(format('insert into public.push_subscriptions(user_id, endpoint) values (%L, %L)', k1, tspu.ep('direto')), 'gravar direto na tabela');
  perform tspu.anon();
  perform tspu.denied(format('select public.push_subscribe(%L)', tspu.ep('anon')), 'visitante ativa aviso');
  perform tspu.denied('select * from public.push_subscriptions', 'visitante lê aparelhos');

  -- chave do Worker obrigatória
  perform tspu.denied($q$select * from public.worker_offer_pushes('chave-errada-chave-errada-chave-errada')$q$, 'Worker sem chave válida');

  -- pedido novo: avisa todos os online da cidade (uma vez por rodada), nunca offline nem outra cidade
  perform tspu.login(c1);
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'pu-0000001');
  perform tspu.anon();
  select array_agg(endpoint order by endpoint) into eps from public.worker_offer_pushes(key);
  perform tspu.ok(eps = array[tspu.ep('k1'), tspu.ep('k3')], 'avisa Entregador 1 e 3 (online, mesma cidade): ' || coalesce(eps::text, 'nenhum'));
  perform tspu.ok(not exists (select 1 from public.worker_offer_pushes(key)), 'não repete o aviso da mesma rodada');

  -- recusou: não é avisado de novo; em entrega: não é avisado
  perform tspu.login(k3); perform public.courier_decline_delivery(o1);
  perform tspu.login(k1); perform public.courier_accept_delivery(o1);
  perform tspu.login(c2);
  o2 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 2', '(35) 99999-0002', 'Rua B, 2, Centro', null, null, null, 'pu-0000002');
  perform tspu.anon();
  select array_agg(endpoint order by endpoint) into eps from public.worker_offer_pushes(key);
  perform tspu.ok(eps = array[tspu.ep('k3')], 'pedido do Cliente 2: avisa só o Entregador 3 (o 1 está em entrega): ' || coalesce(eps::text, 'nenhum'));

  -- aparelho removido pelo serviço de push
  perform public.worker_push_gone(key, tspu.ep('k3'));
  perform tspu.su();
  perform tspu.ok(not exists (select 1 from public.push_subscriptions where endpoint = tspu.ep('k3')), 'aparelho inexistente removido');
  perform tspu.login(k1); perform public.push_unsubscribe(tspu.ep('k1'));
  perform tspu.su();
  perform tspu.ok(not exists (select 1 from public.push_subscriptions where user_id = k1), 'desativar avisos remove o aparelho');
  raise notice 'RLS_PUSH_OK';
end $$;
rollback;
