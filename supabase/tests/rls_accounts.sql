-- Testes da 0021 (aba Logins). Tudo é revertido. Sucesso: NOTICE 'RLS_ACCOUNTS_OK'.
begin;
create schema tsta2;
grant usage on schema tsta2 to public;
create function tsta2.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); set role authenticated; end $$;
create function tsta2.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsta2.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsta2.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsta2.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
grant execute on all functions in schema tsta2 to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare m uuid; sup uuid; viewer uuid; op2 uuid; cli uuid; res jsonb; tst uuid;
begin
  m := private.create_auth_user('a-master@teste.example.com', 'senha-master-1', 'Master');
  sup := private.create_auth_user('a-suporte@teste.example.com', 'senha-suporte-1', 'Suporte');
  viewer := private.create_auth_user('a-viewer@teste.example.com', 'senha-viewer-1', 'Leitura');
  op2 := private.create_auth_user('a-op2@teste.example.com', 'senha-op2-1', 'Operador 2');
  cli := private.create_auth_user('a-cliente@teste.example.com', 'senha-cliente-1', 'Cliente Real');
  insert into public.user_roles(user_id, role) values (m, 'platform_master'), (sup, 'platform_operator'), (viewer, 'platform_operator'), (op2, 'platform_operator');
  insert into public.platform_staff_permissions(user_id, permission) values (sup, 'support.manage'), (sup, 'users.view'), (viewer, 'users.view');
  insert into public.cities(id, name, state, slug) values ('15159000-0000-0000-0000-000000000001', 'Cidade A2', 'TA', 'tsta2-cidade');
  perform tsta2.login(m);
  res := public.admin_create_test_data('15159000-0000-0000-0000-000000000001');

  -- leitura
  perform tsta2.login(cli);
  perform tsta2.denied('select * from public.admin_list_accounts()', 'cliente lista contas');
  perform tsta2.login(viewer);
  perform tsta2.ok(tsta2.count($q$select 1 from public.admin_list_accounts(null, 'teste') where is_test$q$) = 10, 'lista as 10 contas de teste');
  perform tsta2.ok(tsta2.count($q$select 1 from public.admin_list_accounts('cliente real', 'reais')$q$) = 1, 'busca por nome entre as reais');
  perform tsta2.ok((select total >= 15 from public.admin_list_accounts(null, 'todos', 1) limit 1), 'total para paginação');
  perform tsta2.denied(format($q$select public.admin_set_account_name(%L, 'X Y')$q$, cli), 'só leitura altera nome');

  -- suporte
  perform tsta2.login(sup);
  perform public.admin_set_account_name(cli, 'Cliente Renomeado');
  perform tsta2.ok(public.admin_set_account_username(cli, 'Cliente.Real') = 'cliente.real', 'suporte define usuário');
  perform tsta2.denied(format($q$select public.admin_set_account_username(%L, 'admin')$q$, cli), 'suporte usa nome reservado', array['P0001']);
  -- senha temporária: conta real só Master com MFA (0023); conta de teste pelo suporte
  perform tsta2.denied(format($q$select public.admin_set_account_password(%L, 'nova-senha-123')$q$, cli), 'suporte define senha de conta real');
  perform tsta2.su();
  select id into tst from auth.users where email like 'cliente1-%@teste.example.com';
  perform tsta2.login(sup);
  perform tsta2.denied(format($q$select public.admin_set_account_password(%L, 'curta')$q$, tst), 'senha fraca', array['P0001']);
  perform public.admin_set_account_password(tst, 'nova-senha-123');
  perform public.admin_set_account_blocked(cli, true);
  perform tsta2.denied(format($q$select public.admin_set_account_password(%L, 'senha-nova-999')$q$, m), 'suporte troca senha do Master');
  perform tsta2.denied(format($q$select public.admin_set_account_blocked(%L, true)$q$, op2), 'suporte bloqueia operador');
  perform tsta2.denied(format($q$select public.admin_set_account_blocked(%L, true)$q$, sup), 'bloqueia a si mesmo', array['P0001']);
  perform tsta2.su();
  perform tsta2.ok((select full_name = 'Cliente Renomeado' and username = 'cliente.real' from public.profiles where id = cli), 'nome e usuário salvos');
  perform tsta2.ok((select encrypted_password = extensions.crypt('nova-senha-123', encrypted_password) from auth.users where id = tst), 'senha temporária gravada');
  perform tsta2.ok((select banned_until > now() from auth.users where id = cli), 'bloqueio');
  perform tsta2.ok(not exists (select 1 from public.audit_logs where details::text like '%nova-senha-123%'), 'senha fora da auditoria');
  perform tsta2.ok(tsta2.count($q$select 1 from public.audit_logs where action like 'accounts.%'$q$) = 4, 'auditoria: nome, usuário, senha e bloqueio');
  -- Master altera equipe
  perform tsta2.login(m);
  perform public.admin_set_account_blocked(op2, true);
  perform public.admin_set_account_blocked(cli, false);
  perform tsta2.su();
  perform tsta2.ok((select banned_until is null from auth.users where id = cli), 'desbloqueado');
end $$;

do $$ begin raise notice 'RLS_ACCOUNTS_OK'; end $$;
rollback;
