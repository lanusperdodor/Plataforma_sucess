-- Testes da 0006 (MFA obrigatório, rate limiting, URLs https, injeção SQL, direitos do titular).
-- Tudo é revertido. Sucesso termina com NOTICE 'RLS_SECURITY_OK'.
begin;

create schema tsts;
grant usage on schema tsts to public;
create function tsts.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  set role authenticated;
end $$;
create function tsts.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsts.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsts.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsts.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsts.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;

insert into auth.users(id, email) values
  ('55550000-0000-0000-0000-0000000000a1', 'sec-master@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000a2', 'sec-privacidade@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000a3', 'sec-operador@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000c1', 'sec-cliente-c@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000d1', 'sec-cliente-d@teste.invalid');
insert into public.user_roles(user_id, role) values
  ('55550000-0000-0000-0000-0000000000a1', 'platform_master'),
  ('55550000-0000-0000-0000-0000000000a2', 'platform_operator'),
  ('55550000-0000-0000-0000-0000000000a3', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values
  ('55550000-0000-0000-0000-0000000000a2', 'privacy.manage'),
  ('55550000-0000-0000-0000-0000000000a3', 'businesses.review');
update public.profiles set full_name = 'Cliente C Nome Real', phone = '(35) 90000-0000'
 where id = '55550000-0000-0000-0000-0000000000c1';
insert into public.cities(id, name, state, slug, is_active)
values ('55559000-0000-0000-0000-000000000001', 'Cidade Sec', 'SE', 'sec-cidade', true);

do $$
declare
  m constant uuid := '55550000-0000-0000-0000-0000000000a1';
  p constant uuid := '55550000-0000-0000-0000-0000000000a2';
  o constant uuid := '55550000-0000-0000-0000-0000000000a3';
  c constant uuid := '55550000-0000-0000-0000-0000000000c1';
  d constant uuid := '55550000-0000-0000-0000-0000000000d1';
  city constant uuid := '55559000-0000-0000-0000-000000000001';
  b uuid; req uuid; req_del uuid; export jsonb; i int; bad text;
begin
  -- 1. MFA obrigatório por padrão para a equipe administrativa
  perform tsts.ok((select value from public.platform_settings where key = 'require_admin_mfa') = 'true'::jsonb, 'MFA obrigatório por padrão');
  perform tsts.login(m);
  perform tsts.denied('select public.admin_dashboard()', 'master sem segundo fator (aal1)');
  perform tsts.denied(format($q$select public.grant_role(%L, 'platform_operator')$q$, d), 'grant_role em aal1');
  perform tsts.login(o);
  perform tsts.denied('select * from public.admin_list_businesses()', 'operador em aal1');
  perform tsts.login(m, 'aal2');
  perform tsts.ok((public.admin_dashboard()->>'users_total')::int >= 5, 'master em aal2 opera');

  -- 2. rate limiting no servidor
  perform tsts.su();
  update public.platform_settings set value = '20' where key = 'max_pending_business_applications';
  perform tsts.login(c);
  for i in 1..5 loop
    perform public.submit_business_application('Loja Limite ' || i, 'loja', city);
  end loop;
  perform tsts.denied(format($q$select public.submit_business_application('Loja Limite 6', 'loja', %L)$q$, city),
                      '6º envio na mesma hora', array['PT429']);
  perform tsts.login(d);
  perform public.submit_business_application('Loja do D', 'loja', city);   -- limite é por usuário
  perform tsts.su();
  update private.rate_limits set window_start = now() - interval '2 hours' where bucket = 'business.submit';
  perform tsts.login(c);
  perform public.submit_business_application('Loja Limite 6', 'loja', city);  -- janela expirou
  for i in 1..10 loop perform public.my_data_export(); end loop;
  perform tsts.denied('select public.my_data_export()', '11ª exportação na hora', array['PT429']);
  perform tsts.denied('select * from private.rate_limits', 'cliente lê rate_limits');

  -- 3. URLs de imagem só https (bloqueia javascript:, data:, http:)
  perform tsts.su();
  select id into b from public.businesses where name = 'Loja do D';
  begin
    update public.businesses set cover_url = 'javascript:alert(1)' where id = b;
    raise exception 'FALHOU: javascript: aceito em cover_url';
  exception when check_violation then null; end;
  begin
    update public.businesses set logo_url = 'http://inseguro.example/x.png' where id = b;
    raise exception 'FALHOU: http: aceito em logo_url';
  exception when check_violation then null; end;
  begin
    update public.businesses set logo_url = 'https://ok.example/x.png" onerror="alert(1)' where id = b;
    raise exception 'FALHOU: aspas aceitas em logo_url';
  exception when check_violation then null; end;
  update public.businesses set cover_url = 'https://cdn.example.com/capa.jpg' where id = b;

  -- 4. injeção SQL: entradas são dados, nunca código
  perform tsts.login(d);
  b := public.submit_business_application($x$Robert'); drop table public.businesses; --$x$, 'loja', city);
  perform tsts.su();
  perform tsts.ok(to_regclass('public.businesses') is not null, 'tabela businesses intacta');
  perform tsts.ok((select name from public.businesses where id = b) = $x$Robert'); drop table public.businesses; --$x$, 'nome gravado literalmente');
  perform tsts.ok((select slug from public.businesses where id = b) ~ '^[a-z0-9]+(-[a-z0-9]+)*$', 'slug saneado');
  perform tsts.login(o, 'aal2');
  perform tsts.ok(tsts.count($q$select 1 from public.admin_list_businesses(null, $y$' or 1=1 --$y$)$q$) = 0, 'busca com injeção não amplia resultado');
  perform tsts.login(m, 'aal2');
  perform tsts.ok(tsts.count($q$select 1 from public.admin_find_user($y$' or ''='$y$)$q$) = 0, 'busca de usuário com injeção');
  perform tsts.su();
  -- nenhuma função SECURITY DEFINER usa SQL dinâmico (EXECUTE)
  select string_agg(pr.oid::regprocedure::text, ', ') into bad
    from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname in ('public', 'private') and pr.prosecdef and pr.prosrc ~* '\mexecute\M';
  perform tsts.ok(bad is null, 'SECURITY DEFINER com SQL dinâmico: ' || coalesce(bad, ''));

  -- 5. direitos do titular
  perform tsts.anon();
  perform tsts.denied($q$select public.submit_privacy_request('access')$q$, 'anon envia solicitação');
  perform tsts.denied('select public.my_data_export()', 'anon exporta dados');
  perform tsts.login(c);
  req := public.submit_privacy_request('access', 'Quero saber quais dados vocês têm.');
  perform tsts.denied($q$select public.submit_privacy_request('access')$q$, 'pedido duplicado em andamento', array['P0001']);
  perform tsts.denied(format($q$select public.submit_privacy_request('correction', %L)$q$, repeat('x', 2001)), 'texto acima de 2000', array['P0001']);
  perform tsts.denied($q$insert into public.privacy_requests(user_id, kind) values (auth.uid(), 'access')$q$, 'INSERT direto');
  req_del := public.submit_privacy_request('deletion');
  perform tsts.su();
  update private.rate_limits set window_start = now() - interval '2 hours' where bucket = 'privacy.export';
  perform tsts.login(c);
  export := public.my_data_export();
  perform tsts.ok(export->'account'->>'email' = 'sec-cliente-c@teste.invalid', 'exportação traz o e-mail');
  perform tsts.ok(export->'profile'->>'full_name' = 'Cliente C Nome Real', 'exportação traz o perfil');
  perform tsts.ok(jsonb_array_length(export->'privacy_requests') = 2, 'exportação traz as solicitações');
  perform tsts.ok(jsonb_array_length(export->'businesses_owned') = 6, 'exportação traz negócios próprios');
  perform tsts.ok(export::text !~* 'password|encrypted|sec-cliente-d', 'exportação sem senha e sem dados de terceiros');
  perform tsts.login(d);
  perform tsts.ok(tsts.count(format($q$select 1 from public.privacy_requests where id = %L$q$, req)) = 0, 'outro usuário vê solicitação alheia');

  perform tsts.login(o, 'aal2');
  perform tsts.denied('select * from public.admin_list_privacy_requests()', 'operador sem privacy.manage lista');
  perform tsts.login(p);
  perform tsts.denied('select * from public.admin_list_privacy_requests()', 'privacy.manage em aal1');
  perform tsts.login(p, 'aal2');
  perform tsts.ok(tsts.count($q$select 1 from public.admin_list_privacy_requests('open') where user_email = 'sec-cliente-c@teste.invalid'$q$) = 2, 'atendente lista pedidos abertos');
  perform tsts.denied(format($q$select public.admin_resolve_privacy_request(%L, 'completed', null)$q$, req), 'concluir sem registrar resultado', array['P0001']);
  perform tsts.denied(format($q$select public.admin_resolve_privacy_request(%L, 'completed', 'ok', true)$q$, req), 'anonimizar fora de pedido de exclusão', array['P0001']);
  perform public.admin_resolve_privacy_request(req, 'in_progress', null);
  perform public.admin_resolve_privacy_request(req, 'completed', 'Dados enviados por e-mail ao titular.');
  perform tsts.denied(format($q$select public.admin_resolve_privacy_request(%L, 'rejected', 'x')$q$, req), 'reabrir pedido encerrado', array['P0001']);
  perform public.admin_resolve_privacy_request(req_del, 'completed', 'Perfil anonimizado; registros fiscais mantidos.', true);
  perform tsts.su();
  perform tsts.ok((select full_name is null and phone is null from public.profiles where id = c), 'perfil anonimizado');
  perform tsts.ok(exists (select 1 from public.businesses where owner_id = c), 'registros comerciais preservados');
  perform tsts.ok(not exists (select 1 from public.audit_logs where entity = 'privacy_requests' and details::text ~ 'Quero saber'),
                  'auditoria sem o texto livre do titular');
  perform tsts.ok(tsts.count($q$select 1 from public.audit_logs where action like 'privacy.%'$q$) >= 5, 'atendimento auditado');

  -- 6. funções internas fora da API
  perform tsts.login(m, 'aal2');
  perform tsts.denied(format($q$select private.anonymize_user(%L)$q$, d), 'chamar private.anonymize_user');
  perform tsts.denied($q$select private.rate_limit('x', 1, 1)$q$, 'chamar private.rate_limit');
  perform tsts.denied(format($q$select private.grant_role_impl(%L, 'platform_master')$q$, d), 'chamar implementação interna de grant_role');

  perform tsts.su();
  raise notice 'RLS_SECURITY_OK';
end $$;

rollback;
