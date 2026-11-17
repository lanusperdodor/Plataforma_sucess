-- Testes da 0057 (excluir login). Tudo é revertido. Sucesso: NOTICE 'RLS_EXCLUIR_LOGIN_OK'.
begin;
create schema tsel;
grant usage on schema tsel to public;
create function tsel.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true); set role authenticated; end $$;
create function tsel.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsel.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsel.denied(stmt text, msg text, codes text[] default array['42501', 'P0001']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsel.listed(_u uuid) returns boolean language sql as $$ select exists (select 1 from public.admin_list_accounts(null, 'todos', 200) where id = _u) $$;
create function tsel.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsel to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000057';
  m uuid; op uuid; real1 uuid; real2 uuid; dono uuid; c1 uuid; e1 uuid; k1 uuid; lan uuid; cheese text; o uuid; r text; antigo uuid;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Excluir', 'MG', 'tsel-cidade');
  m := private.create_auth_user('el-master@exemplo.invalid', 'senha-master-1', 'Master EL');
  op := private.create_auth_user('el-op@exemplo.invalid', 'senha-op-0001', 'Operador EL');
  real1 := private.create_auth_user('real1@exemplo.invalid', 'senha-real-001', 'Cliente Real Um');
  real2 := private.create_auth_user('real2@exemplo.invalid', 'senha-real-002', 'Cliente Real Dois');
  dono := private.create_auth_user('dono@exemplo.invalid', 'senha-dono-001', 'Dono Real');
  insert into public.user_roles(user_id, role) values (m, 'platform_master'), (op, 'platform_operator');
  insert into public.platform_staff_permissions(user_id, permission) values (op, 'users.view'), (op, 'support.manage');
  insert into public.businesses(owner_id, name, slug, city_id, status) values (dono, 'Loja Real', 'tsel-loja-real', city, 'active');
  perform tsel.login(m);
  perform public.admin_create_test_data(city);
  perform tsel.su();
  c1 := tsel.uid('cliente1'); e1 := tsel.uid('empresario1'); k1 := tsel.uid('entregador');
  select id into lan from public.businesses where owner_id = e1;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';
  -- conta de teste removida antes da 0057 (já some da lista)
  antigo := private.create_auth_user('removido-x@teste.example.com', 'senha-antiga-1', 'Antigo');
  update auth.users set email = 'removido-' || antigo::text || '@teste.example.com', banned_until = 'infinity' where id = antigo;

  -- pedido real do Cliente Real Dois (fica preservado)
  perform set_config('tucai.internal', 'on', true);
  update public.businesses set is_test = false where id = lan;
  perform set_config('tucai.internal', 'off', true);
  perform tsel.login(real2);
  o := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'pickup', 'cash',
                          'Cliente Real Dois', '(35) 99999-0002', null, null, null, null, 'el-0000001');
  perform tsel.su();
  perform set_config('tucai.internal', 'on', true);
  update public.businesses set is_test = true where id = lan;
  update public.orders set is_test = false where id = o;
  perform set_config('tucai.internal', 'off', true);

  -- permissões
  perform tsel.login(op);
  perform tsel.ok(tsel.listed(real1) and not tsel.listed(antigo), 'lista: conta removida antes some');
  perform tsel.denied(format('select public.admin_delete_account(%L, %L)', real1, 'EXCLUIR'), 'operador exclui login');
  perform tsel.login(real1);
  perform tsel.denied(format('select public.admin_delete_account(%L, %L)', real2, 'EXCLUIR'), 'cliente exclui login');
  perform tsel.login(m);
  perform tsel.denied(format('select public.admin_delete_account(%L, %L)', real1, 'sim'), 'sem digitar EXCLUIR');
  perform tsel.denied(format('select public.admin_delete_account(%L, %L)', m, 'EXCLUIR'), 'exclui a si mesmo');
  perform tsel.denied(format('select public.admin_delete_account(%L, %L)', op, 'EXCLUIR'), 'exclui conta da equipe');
  perform tsel.denied(format('select public.admin_delete_account(%L, %L)', dono, 'EXCLUIR'), 'exclui dono de loja real');

  -- login real: anonimizado e trancado, some da lista, pedidos preservados
  r := public.admin_delete_account(real2, 'EXCLUIR');
  perform tsel.ok(r = 'anonimizada', 'login real é anonimizado (não apagado): ' || r);
  perform tsel.ok(not tsel.listed(real2), 'login real excluído some da lista');
  perform tsel.denied(format('select public.admin_delete_account(%L, %L)', real2, 'EXCLUIR'), 'excluir de novo');
  perform tsel.su();
  perform tsel.ok((select banned_until = 'infinity' and email like 'excluido-%@contas.invalid' from auth.users where id = real2), 'conta trancada e sem o e-mail');
  perform tsel.ok(exists (select 1 from public.orders where id = o and customer_id = real2), 'pedido real preservado');
  perform tsel.ok((select full_name is null and username is null from public.profiles where id = real2), 'perfil anonimizado');
  perform tsel.ok(exists (select 1 from public.audit_logs where action = 'accounts.delete' and entity_id = real2::text), 'exclusão auditada');

  -- login de teste: apagado de vez (cliente de teste) e entregador de teste
  perform tsel.login(m);
  perform public.admin_delete_account(k1, 'EXCLUIR');
  perform public.admin_delete_account(c1, 'EXCLUIR');
  perform tsel.ok(not tsel.listed(k1) and not tsel.listed(c1), 'logins de teste somem da lista');
  perform tsel.su();
  perform tsel.ok(not exists (select 1 from public.couriers where user_id = k1), 'cadastro de entregador de teste removido');
  -- empresário de teste: loja de teste sai junto
  perform tsel.login(m);
  perform public.admin_delete_account(e1, 'EXCLUIR');
  perform tsel.su();
  perform tsel.ok(not exists (select 1 from public.businesses where id = lan), 'loja de teste removida junto');
  perform tsel.login(m);
  perform tsel.ok(not tsel.listed(e1) and tsel.listed(real1), 'empresário de teste some; os outros continuam');
  raise notice 'RLS_EXCLUIR_LOGIN_OK';
end $$;
rollback;
