-- 0042: endereço em campos separados. Tudo é revertido. Sucesso: 'RLS_ENDERECO_OK'.
begin;
create schema tsen;
grant usage on schema tsen to public;
create function tsen.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true); set role authenticated; end $$;
create function tsen.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsen.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsen.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsen.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege or raise_exception or check_violation then return; end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', msg;
end $$;
create function tsen.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsen to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000044';
  m uuid; e1 uuid; e2 uuid; k1 uuid; c1 uuid; c2 uuid; lan uuid; sup uuid; n int;
  good constant jsonb := '{"cep":"37975000","street":"Rua das Flores","number":"120","complement":"Apto 2","district":"Centro","city":"Itaú de Minas","uf":"MG"}';
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Endereço', 'MG', 'tsen-cidade');
  m := private.create_auth_user('en-master@teste.invalid', 'senha-master-1', 'Master EN');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsen.login(m);
  perform public.admin_create_test_data(city);
  perform tsen.su();
  e1 := tsen.uid('empresario1'); e2 := tsen.uid('empresario2'); k1 := tsen.uid('entregador'); c1 := tsen.uid('cliente1'); c2 := tsen.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id into sup from public.businesses where owner_id = e2;

  -- validação e formato
  perform tsen.ok(public.address_parts_ok(good), 'endereço completo é válido');
  perform tsen.ok(public.format_address_parts(good) = 'Rua das Flores, 120, Apto 2 - Centro - Itaú de Minas/MG, CEP 37975-000', 'texto montado: ' || public.format_address_parts(good));
  perform tsen.ok(not public.address_parts_ok(good || '{"cep":"3797"}'), 'CEP curto');
  perform tsen.ok(not public.address_parts_ok(good || '{"uf":"XX"}'), 'UF inexistente');
  perform tsen.ok(not public.address_parts_ok(good || '{"number":""}'), 'sem número');
  perform tsen.ok(not public.address_parts_ok(good || '{"street":"<script>"}'), 'HTML na rua');
  perform tsen.ok(not public.address_parts_ok(good || '{"extra":"x"}'), 'campo desconhecido');
  perform tsen.ok(not public.address_parts_ok(good || '{"number":120}'), 'número precisa ser texto');
  perform tsen.ok(public.address_parts_ok(good || '{"number":"S/N","complement":""}'), 'sem número marcado');

  -- loja: dono grava as partes e o texto é montado pelo banco
  perform tsen.login(e1);
  update public.businesses set address_parts = good where id = lan;
  perform tsen.ok((select address_line from public.businesses where id = lan) = public.format_address_parts(good), 'loja: texto montado a partir das partes');
  perform tsen.denied(format('update public.businesses set address_parts = %L where id = %L', good || '{"cep":"1"}', lan), 'loja: partes inválidas');
  update public.businesses set address_parts = good where id = sup;
  get diagnostics n = row_count;
  perform tsen.ok(n = 0, 'loja: não altera endereço de outra loja');
  perform tsen.su();
  perform tsen.ok((select address_parts is null from public.businesses where id = sup), 'outra loja continua sem partes');

  -- cliente: salva o próprio endereço no perfil; não altera o de outro
  perform tsen.login(c1);
  update public.profiles set address_parts = good where id = c1;
  update public.profiles set address_parts = good where id = c2;
  get diagnostics n = row_count;
  perform tsen.ok(n = 0, 'cliente não altera o perfil de outro');
  perform tsen.ok((select address_parts->>'cep' from public.profiles where id = c1) = '37975000', 'cliente salvou o endereço');
  perform tsen.denied(format('update public.profiles set address_parts = %L where id = %L', '{"cep":"x"}', c1), 'cliente: partes inválidas');

  -- entregador: só pela função e só o próprio
  perform tsen.login(k1);
  perform public.courier_set_address(good);
  perform tsen.ok((select address_parts->>'street' from public.couriers where user_id = k1) = 'Rua das Flores', 'entregador salvou o endereço');
  perform tsen.denied(format('select public.courier_set_address(%L)', good || '{"uf":"ZZ"}'), 'entregador: partes inválidas');
  perform tsen.denied(format('update public.couriers set address_parts = %L where user_id = %L', good, k1), 'entregador: update direto');
  perform tsen.denied(format('select public.admin_courier_address(%L)', k1), 'entregador lê pelo Master');
  perform tsen.login(c1);
  perform tsen.denied(format('select public.courier_set_address(%L)', good), 'cliente sem cadastro de entregador');
  perform tsen.denied(format('select public.admin_courier_address(%L)', k1), 'cliente lê endereço do entregador');
  perform tsen.anon();
  perform tsen.denied(format('select public.courier_set_address(%L)', good), 'anônimo');
  perform tsen.login(m);
  perform tsen.ok((public.admin_courier_address(k1)->>'text') like 'Rua das Flores, 120%', 'Master vê o endereço do entregador');
  raise notice 'RLS_ENDERECO_OK';
end $$;
rollback;
