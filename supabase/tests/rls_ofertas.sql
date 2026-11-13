-- Ofertas de entrega: todo pedido com entregador parceiro aparece para TODOS os entregadores independentes online da cidade;
-- o primeiro que aceita fica com a entrega. Entregador próprio não recebe ofertas da rede. Tudo é revertido. Sucesso: 'RLS_OFERTAS_OK'.
begin;
create schema tsof;
grant usage on schema tsof to public;
create function tsof.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true); set role authenticated; end $$;
create function tsof.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsof.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsof.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tsof.sees(o uuid) returns boolean language sql as $$ select exists (select 1 from public.courier_list_offers() x where x.order_id = o) $$;
grant execute on all functions in schema tsof to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000040'; other constant uuid := '12129000-0000-0000-0000-000000000041';
  m uuid; e1 uuid; k1 uuid; kp uuid; c1 uuid; c2 uuid; k3 uuid; k4 uuid; k5 uuid; kx uuid; kreal uuid; lan uuid; cheese text; o1 uuid; o2 uuid; run uuid; u uuid;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Ofertas', 'MG', 'tsof-cidade'), (other, 'Outra Cidade', 'MG', 'tsof-outra');
  m := private.create_auth_user('of-master@teste.invalid', 'senha-master-1', 'Master OF');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsof.login(m);
  perform public.admin_create_test_data(city);
  perform tsof.su();
  e1 := tsof.uid('empresario1'); k1 := tsof.uid('entregador'); kp := tsof.uid('entregador2'); c1 := tsof.uid('cliente1'); c2 := tsof.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';
  select id into run from private.test_data_runs where removed_at is null order by created_at desc limit 1;

  -- mais três entregadores independentes de teste na mesma cidade, um em outra cidade, e um entregador REAL
  k3 := private.create_auth_user('of-k3@teste.invalid', 'senha-k3-0001', 'Entregador 3');
  k4 := private.create_auth_user('of-k4@teste.invalid', 'senha-k4-0001', 'Entregador 4');
  k5 := private.create_auth_user('of-k5@teste.invalid', 'senha-k5-0001', 'Entregador 5');
  kx := private.create_auth_user('of-kx@teste.invalid', 'senha-kx-0001', 'Entregador outra cidade');
  kreal := private.create_auth_user('of-real@exemplo.invalid', 'senha-real-001', 'Entregador real');
  update private.test_data_runs set user_ids = user_ids || array[k3, k4, k5, kx] where id = run;
  foreach u in array array[k3, k4, k5, kx, kreal] loop
    insert into public.user_roles(user_id, role) values (u, 'courier_partner') on conflict do nothing;
    insert into public.couriers(user_id, full_name, phone, city_id, vehicle, status, is_online, terms_version, terms_accepted_at)
    values (u, 'Entregador Teste', '35999990000', case when u = kx then other else city end, 'bicicleta', 'approved', true, 'v1', now());
  end loop;

  -- pedidos de dois clientes diferentes, com entregador parceiro
  perform tsof.login(c1);
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'of-0000001');
  perform tsof.login(c2);
  o2 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 2)), 'delivery_partner', 'cash',
                           'Cliente 2', '(35) 99999-0002', 'Rua B, 2, Centro', null, null, null, 'of-0000002');

  -- todos os independentes online da cidade veem os dois pedidos
  perform tsof.login(k1); perform public.set_courier_online(true);
  perform tsof.ok(tsof.sees(o1) and tsof.sees(o2), 'Entregador 1 vê os pedidos do Cliente 1 e do Cliente 2');
  foreach u in array array[k3, k4, k5] loop
    perform tsof.login(u);
    perform tsof.ok(tsof.sees(o1) and tsof.sees(o2), 'entregador independente da cidade vê os dois pedidos');
  end loop;
  -- quem não deve ver
  perform tsof.login(kx);
  perform tsof.ok(not tsof.sees(o1) and not tsof.sees(o2), 'entregador de outra cidade não vê');
  perform tsof.login(kreal);
  perform tsof.ok(not tsof.sees(o1), 'entregador real não recebe pedido de teste (isolamento da homologação)');
  perform tsof.login(kp);
  begin
    perform public.courier_list_offers();
    raise exception 'FALHOU: entregador próprio não deveria listar ofertas da rede';
  exception when insufficient_privilege then null;
  end;
  -- offline não vê
  perform tsof.login(k5); perform public.set_courier_online(false);
  perform tsof.ok(not tsof.sees(o1), 'entregador offline não vê ofertas');

  -- o primeiro que aceita fica com a entrega; para os outros ela some
  perform tsof.login(k3); perform public.courier_accept_delivery(o1);
  perform tsof.login(k4);
  perform tsof.ok(not tsof.sees(o1) and tsof.sees(o2), 'pedido aceito some para os outros; o outro continua disponível');
  begin
    perform public.courier_accept_delivery(o1);
    raise exception 'FALHOU: dois entregadores não podem aceitar o mesmo pedido';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  perform tsof.su();
  perform tsof.ok((select courier_id from public.deliveries where order_id = o1) = k3, 'entrega ficou com quem aceitou primeiro');
  raise notice 'RLS_OFERTAS_OK';
end $$;
rollback;
