-- Testes da 0015 (dados de teste do Master). Tudo é revertido. Sucesso: NOTICE 'RLS_TEST_DATA_OK'.
begin;

create schema tstd;
grant usage on schema tstd to public;
create function tstd.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tstd.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstd.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstd.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstd.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstd.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
grant execute on all functions in schema tstd to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
insert into auth.users(id, email) values
  ('99990000-0000-0000-0000-0000000000f1', 'd-master@teste.invalid'),
  ('99990000-0000-0000-0000-0000000000f2', 'd-operador@teste.invalid');
insert into public.user_roles(user_id, role) values
  ('99990000-0000-0000-0000-0000000000f1', 'platform_master'), ('99990000-0000-0000-0000-0000000000f2', 'platform_operator');
insert into public.cities(id, name, state, slug) values ('99999000-0000-0000-0000-000000000001', 'Cidade D', 'TD', 'tstd-cidade');

do $$
declare
  m constant uuid := '99990000-0000-0000-0000-0000000000f1';
  op constant uuid := '99990000-0000-0000-0000-0000000000f2';
  city constant uuid := '99999000-0000-0000-0000-000000000001';
  res jsonb; run uuid; uids uuid[]; bizs uuid[]; c1 uuid; burger uuid; ponto uuid; oid uuid;
begin
  perform tstd.anon();
  perform tstd.denied(format('select public.admin_create_test_data(%L)', city), 'anon cria dados de teste');
  perform tstd.login(op);
  perform tstd.denied(format('select public.admin_create_test_data(%L)', city), 'operador cria dados de teste');
  perform tstd.denied('select * from public.admin_list_test_data()', 'operador lista dados de teste');

  perform tstd.login(m);
  res := public.admin_create_test_data(city);
  run := (res->>'run_id')::uuid;
  perform tstd.ok(jsonb_array_length(res->'logins') = 10 and res->>'password' ~ '^Teste-[0-9A-F]{8}!$', 'devolve 10 logins (9 perfis) e a senha gerada');
  perform tstd.ok(tstd.count('select * from public.admin_list_test_data()') = 1, 'lote listado');
  perform tstd.su();
  select user_ids, business_ids into uids, bizs from private.test_data_runs where id = run;
  perform tstd.ok((select count(*) from auth.users where id = any(uids) and email_confirmed_at is not null and encrypted_password like '$2%') = 10, 'contas confirmadas com senha em hash');
  perform tstd.ok((select count(*) from auth.identities where user_id = any(uids)) = 10, 'identidades de e-mail criadas');
  perform tstd.ok(not exists (select 1 from private.test_data_runs where logins::text like '%Teste-%'), 'senha não é guardada');
  perform tstd.ok((select count(*) from public.user_roles where user_id = any(uids) and role = 'customer') = 10, 'todos ganham papel de cliente');
  perform tstd.ok(exists (select 1 from public.couriers where user_id = any(uids) and status = 'approved' and city_id = city), 'entregador aprovado na cidade');

  -- fora do público; visível e pronto para pedir só para contas de teste
  perform tstd.anon();
  perform tstd.ok(tstd.count(format('select 1 from public.public_businesses where city_id = %L', city)) = 0, 'público não vê estabelecimentos de teste');
  perform tstd.ok(tstd.count(format('select 1 from public.jobs where city_id = %L', city)) = 0, 'público não vê vaga de teste');
  perform tstd.su();
  select id into c1 from auth.users where id = any(uids) and email like 'cliente1-%';
  perform tstd.login(c1);
  perform tstd.ok(tstd.count(format('select 1 from public.public_businesses where city_id = %L and is_open', city)) = 2, 'conta de teste vê os dois estabelecimentos abertos');
  perform tstd.ok(tstd.count(format('select 1 from public.jobs where city_id = %L', city)) = 1, 'conta de teste vê a vaga');
  perform tstd.su();
  select p.id into burger from public.products p where p.business_id = bizs[1] and p.name = 'X-Burger';
  select o.id into ponto from public.options o join public.option_groups g on g.id = o.group_id where g.product_id = burger and o.name = 'Ao ponto';
  perform tstd.login(c1);
  oid := public.place_order(bizs[1], jsonb_build_array(jsonb_build_object('product_id', burger, 'quantity', 1, 'option_ids', jsonb_build_array(ponto))),
                            'delivery_partner', 'cash', 'Cliente Teste', '35999990000', 'Rua A, 1, Centro', null, null, null, 'chave-teste-0001');
  perform tstd.ok(oid is not null, 'cliente de teste faz pedido no estabelecimento de teste');

  -- remoção completa
  perform tstd.login(op);
  perform tstd.denied(format('select public.admin_remove_test_data(%L)', run), 'operador remove');
  perform tstd.login(m);
  perform public.admin_remove_test_data(run);
  perform tstd.su();
  perform tstd.ok(not exists (select 1 from public.businesses where id = any(bizs)), 'estabelecimentos removidos');
  perform tstd.ok(not exists (select 1 from public.orders where id = oid), 'pedidos removidos');
  perform tstd.ok(not exists (select 1 from public.couriers where user_id = any(uids)), 'entregador removido');
  perform tstd.ok(not exists (select 1 from auth.users where id = any(uids) and banned_until is null), 'contas de teste removidas ou bloqueadas');
  perform tstd.login(m);
  perform tstd.ok(tstd.count('select * from public.admin_list_test_data()') = 0, 'lote removido da lista');
  perform tstd.denied(format('select public.admin_remove_test_data(%L)', run), 'remove duas vezes', array['P0001']);
  perform tstd.su();
end $$;

do $$
begin
  perform tstd.ok(not has_function_privilege('authenticated', 'private.create_auth_user(text, text, text)', 'execute'), 'authenticated cria conta direto');
  perform tstd.ok(not has_function_privilege('anon', 'public.admin_create_test_data(uuid)', 'execute'), 'anon executa gerador');
end $$;

do $$ begin raise notice 'RLS_TEST_DATA_OK'; end $$;
rollback;
