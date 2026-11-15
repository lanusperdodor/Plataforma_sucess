-- 0051: funções da equipe e convite pelo nome de usuário. Tudo é revertido. Sucesso: 'RLS_EQUIPE_FUNCOES_OK'.
begin;
create schema tsef;
grant usage on schema tsef to public;
create function tsef.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true); set role authenticated; end $$;
create function tsef.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsef.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsef.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege or raise_exception then return; end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', msg;
end $$;
create function tsef.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsef to public;
update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

do $$
declare
  city constant uuid := '12129000-0000-0000-0000-000000000051';
  m uuid; e1 uuid; e2 uuid; c1 uuid; c2 uuid; func uuid; lan uuid; sup uuid; caixa uuid; n int;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Equipe', 'MG', 'tsef-cidade');
  m := private.create_auth_user('ef-master@teste.invalid', 'senha-master-1', 'Master EF');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsef.login(m);
  perform public.admin_create_test_data(city);
  perform tsef.su();
  e1 := tsef.uid('empresario1'); e2 := tsef.uid('empresario2'); c1 := tsef.uid('cliente1'); c2 := tsef.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id into sup from public.businesses where owner_id = e2;
  update public.profiles set username = 'joao.caixa' where id = c1;

  -- empresário cria a função "Caixa" (atendimento + caixa + relatórios)
  perform tsef.login(e1);
  caixa := public.merchant_save_function(lan, null, 'Caixa', 'attendant', array['cash.manage', 'reports.view']);
  perform tsef.denied(format('select public.merchant_save_function(%L, null, %L, %L, %L)', lan, 'caixa ', 'attendant', '{}'), 'nome de função repetido');
  perform tsef.denied(format('select public.merchant_save_function(%L, null, %L, %L, %L)', lan, 'Sócio', 'attendant', '{staff.manage}'), 'função não pode dar permissão de dono');
  perform tsef.denied(format('select public.merchant_save_function(%L, null, %L, %L, %L)', lan, 'Dono 2', 'owner', '{}'), 'cargo base de dono');

  -- convite pelo nome de usuário (com @ ou sem), com a função
  perform tsef.denied(format('select public.merchant_invite_by_username(%L, %L, null, %L)', lan, 'nao.existe', caixa), 'nome de usuário inexistente avisa');
  perform tsef.ok(public.merchant_invite_by_username(lan, '@Joao.Caixa', null, caixa) = 'vinculado', 'convidado pelo nome de usuário');
  perform tsef.denied(format('select public.merchant_invite_by_username(%L, %L, null, %L)', lan, 'joao.caixa', caixa), 'mesma pessoa duas vezes');
  perform tsef.su();
  perform tsef.ok((select member_role = 'attendant' and function_id = caixa from public.business_members where business_id = lan and user_id = c1), 'cargo base e função aplicados');
  select count(*) into n from public.business_member_permissions where business_id = lan and user_id = c1;
  perform tsef.ok(n = 2, 'permissões extras da função aplicadas');
  perform tsef.login(c1);
  perform tsef.ok(public.has_business_permission(lan, 'cash.manage') and public.has_business_permission(lan, 'reports.view') and not public.has_business_permission(lan, 'staff.manage'),
                  'integrante tem caixa e relatórios, sem gerir equipe');

  -- mudar a função atualiza quem usa
  perform tsef.login(e1);
  perform public.merchant_save_function(lan, caixa, 'Caixa', 'attendant', array['cash.manage']);
  perform tsef.login(c1);
  perform tsef.ok(not public.has_business_permission(lan, 'reports.view'), 'ao tirar relatórios da função, o integrante perde o acesso');
  perform tsef.login(e1);
  perform tsef.ok((select function_name from public.merchant_team(lan) where user_id = c1) = 'Caixa' and (select username from public.merchant_team(lan) where user_id = c1) = 'joao.caixa', 'equipe mostra função e usuário');

  -- outra loja não mexe
  perform tsef.login(e2);
  perform tsef.denied(format('select public.merchant_apply_function(%L, %L, %L)', lan, c1, caixa), 'outra loja aplica função');
  perform tsef.denied(format('select public.merchant_invite_by_username(%L, %L, %L, null)', lan, 'joao.caixa', 'attendant'), 'outra loja convida');
  perform tsef.ok(not exists (select 1 from public.business_functions where business_id = lan), 'outra loja não vê as funções');
  perform tsef.login(c2);
  perform tsef.denied(format('select public.merchant_save_function(%L, null, %L, %L, %L)', lan, 'X', 'attendant', '{}'), 'cliente cria função');
  -- apagar a função mantém a pessoa na equipe (sem função)
  perform tsef.login(e1);
  perform public.merchant_delete_function(lan, caixa);
  perform tsef.su();
  perform tsef.ok((select function_id is null from public.business_members where business_id = lan and user_id = c1), 'função apagada: integrante continua, sem função');
  raise notice 'RLS_EQUIPE_FUNCOES_OK';
end $$;
rollback;
