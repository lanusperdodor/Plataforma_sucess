-- Testes de segurança da 0005 (Painel Master, permissões da equipe, MFA, solicitação e análise
-- de estabelecimentos, cidades, auditoria). Tudo é revertido no final.
-- Sucesso termina com NOTICE 'RLS_ADMIN_OK'; qualquer falha levanta exceção.
begin;

create schema tsta;
grant usage on schema tsta to public;

create function tsta.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  set role authenticated;
end $$;
create function tsta.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set role anon;
end $$;
create function tsta.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsta.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsta.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsta.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsta.val(q text) returns text language plpgsql as $$
declare v text; begin execute q into v; return v; end $$;

-- ---------- fixtures ----------
-- M master; O operador sem permissões; R operador revisor (businesses.review + cities.manage);
-- C e D clientes; o gatilho cria perfil e papel customer.
insert into auth.users(id, email) values
  ('88880000-0000-0000-0000-0000000000a1', 'master@teste.invalid'),
  ('88880000-0000-0000-0000-0000000000a2', 'operador@teste.invalid'),
  ('88880000-0000-0000-0000-0000000000a3', 'revisor@teste.invalid'),
  ('88880000-0000-0000-0000-0000000000c1', 'cliente-c@teste.invalid'),
  ('88880000-0000-0000-0000-0000000000d1', 'cliente-d@teste.invalid');
insert into public.user_roles(user_id, role) values
  ('88880000-0000-0000-0000-0000000000a1', 'platform_master'),
  ('88880000-0000-0000-0000-0000000000a2', 'platform_operator'),
  ('88880000-0000-0000-0000-0000000000a3', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values
  ('88880000-0000-0000-0000-0000000000a3', 'businesses.review'),
  ('88880000-0000-0000-0000-0000000000a3', 'cities.manage');
insert into public.cities(id, name, state, slug, is_active) values
  ('88889000-0000-0000-0000-000000000001', 'Cidade Tsta', 'TA', 'tsta-cidade', true),
  ('88889000-0000-0000-0000-000000000002', 'Cidade Tsta Off', 'TA', 'tsta-off', false);

do $$
declare
  m constant uuid := '88880000-0000-0000-0000-0000000000a1';
  o constant uuid := '88880000-0000-0000-0000-0000000000a2';
  r constant uuid := '88880000-0000-0000-0000-0000000000a3';
  c constant uuid := '88880000-0000-0000-0000-0000000000c1';
  d constant uuid := '88880000-0000-0000-0000-0000000000d1';
  city constant uuid := '88889000-0000-0000-0000-000000000001';
  cat_pizza uuid;
  cat_roupa uuid;
  b1 uuid; b2 uuid; b_r uuid;
  new_city uuid;
  st text;
  access jsonb;
begin
  select id into cat_pizza from public.categories where slug = 'pizzas';
  select id into cat_roupa from public.categories where slug = 'roupas';
  perform tsta.ok(cat_pizza is not null and cat_roupa is not null, 'taxonomia oficial cadastrada pela 0003');

  -- 1. anon não chama nada administrativo nem envia solicitação
  perform tsta.anon();
  perform tsta.denied('select public.admin_dashboard()', 'anon chama admin_dashboard');
  perform tsta.denied('select public.admin_my_access()', 'anon chama admin_my_access');
  perform tsta.denied(format($q$select public.submit_business_application('X Y', 'restaurante', %L)$q$, city), 'anon envia solicitação');
  perform tsta.denied('select * from public.platform_settings', 'anon lê platform_settings');

  -- 2. cliente envia solicitação: pendente, dono vinculado, slug sem acento, auditoria
  perform tsta.login(c);
  b1 := public.submit_business_application('Pizzaria São João', 'restaurante', city, cat_pizza, '(35) 99999-0000', 'Forno a lenha', 'Rua A, 10');
  perform tsta.su();
  perform tsta.ok((select status::text from public.businesses where id = b1) = 'pending', 'solicitação nasce pendente');
  perform tsta.ok((select slug from public.businesses where id = b1) = 'pizzaria-sao-joao', 'slug sem acento');
  perform tsta.ok((select owner_id from public.businesses where id = b1) = c, 'dono é quem enviou');
  perform tsta.ok(exists (select 1 from public.business_members where business_id = b1 and user_id = c and member_role = 'owner'), 'dono vinculado como owner');
  perform tsta.ok(exists (select 1 from public.audit_logs where action = 'business.submit' and entity_id = b1::text and actor_id = c), 'envio auditado');
  perform tsta.ok(not exists (select 1 from public.user_roles where user_id = c and role = 'business_owner'), 'papel business_owner só após aprovação');

  perform tsta.login(c);
  b2 := public.submit_business_application('Pizzaria São João', 'restaurante', city);
  perform tsta.ok((select slug from public.businesses where id = b2) = 'pizzaria-sao-joao-2', 'slug repetido ganha sufixo');
  perform public.submit_business_application('Loja da C', 'loja', city, cat_roupa);
  perform tsta.denied(format($q$select public.submit_business_application('Quarta', 'loja', %L)$q$, city), 'limite de solicitações pendentes', array['P0001']);
  perform tsta.login(d);
  perform tsta.denied(format($q$select public.submit_business_application('X', 'loja', %L)$q$, city), 'nome curto', array['P0001']);
  perform tsta.denied($q$select public.submit_business_application('Loja D', 'loja', '88889000-0000-0000-0000-000000000002')$q$, 'cidade inativa', array['P0001']);
  perform tsta.denied(format($q$select public.submit_business_application('Loja D', 'loja', %L, %L)$q$, city, cat_pizza), 'categoria de outro tipo', array['P0001']);
  perform tsta.denied(format($q$select public.submit_business_application('Loja D', 'loja', %L, null, 'abc')$q$, city), 'telefone inválido', array['P0001']);

  -- 3. visibilidade: dono vê a própria solicitação; outros clientes e anon não
  perform tsta.ok(tsta.count(format($q$select 1 from public.businesses where id = %L$q$, b1)) = 0, 'outro cliente vê solicitação alheia');
  perform tsta.login(c);
  perform tsta.ok(tsta.count(format($q$select 1 from public.businesses where id = %L$q$, b1)) = 1, 'dono vê a própria solicitação');
  perform tsta.denied(format($q$update public.businesses set status = 'active' where id = %L$q$, b1), 'dono se autoaprova');
  perform tsta.anon();
  perform tsta.ok(tsta.count(format($q$select 1 from public.public_businesses where id = %L$q$, b1)) = 0, 'pendente invisível ao público');

  -- 4. sem permissão: cliente e operador sem businesses.review
  perform tsta.login(c);
  perform tsta.denied(format($q$select public.admin_review_business(%L, 'approve')$q$, b1), 'cliente aprova');
  perform tsta.denied('select * from public.admin_list_businesses()', 'cliente lista estabelecimentos');
  perform tsta.login(o);
  perform tsta.denied(format($q$select public.admin_review_business(%L, 'approve')$q$, b1), 'operador sem permissão aprova');
  perform tsta.denied('select * from public.admin_list_businesses()', 'operador sem permissão lista');
  perform tsta.denied('select public.admin_dashboard()', 'operador sem permissão vê painel');
  perform tsta.ok(tsta.count(format($q$select 1 from public.businesses where id = %L$q$, b1)) = 0, 'operador sem permissão lê businesses');
  access := public.admin_my_access();
  perform tsta.ok((access->>'is_operator')::boolean and jsonb_array_length(access->'permissions') = 0, 'operador começa sem permissões');

  -- 5. revisor: listar, recusar (motivo obrigatório), aprovar, suspender, reativar
  perform tsta.login(r);
  perform tsta.ok(tsta.count($q$select 1 from public.admin_list_businesses('pending') where owner_email = 'cliente-c@teste.invalid'$q$) = 3, 'revisor lista pendentes com e-mail do dono');
  perform tsta.denied(format($q$select public.admin_review_business(%L, 'reject')$q$, b1), 'recusa sem motivo', array['P0001']);
  st := public.admin_review_business(b1, 'reject', 'Documentação incompleta');
  perform tsta.ok(st = 'rejected', 'recusa');
  perform tsta.denied(format($q$select public.admin_review_business(%L, 'suspend', 'x')$q$, b1), 'suspender recusado', array['P0001']);
  st := public.admin_review_business(b1, 'approve');
  perform tsta.ok(st = 'active', 'aprova após recusa');
  perform tsta.denied(format($q$select public.admin_review_business(%L, 'approve')$q$, b1), 'aprovar duas vezes', array['P0001']);
  perform tsta.denied(format($q$select public.admin_review_business(%L, 'publish')$q$, b2), 'decisão desconhecida', array['P0001']);
  perform tsta.su();
  perform tsta.ok(exists (select 1 from public.user_roles where user_id = c and role = 'business_owner'), 'aprovação concede business_owner');
  perform tsta.ok((select reviewed_by from public.businesses where id = b1) = r, 'revisor registrado');
  perform tsta.anon();
  perform tsta.ok(tsta.count(format($q$select 1 from public.public_businesses where id = %L$q$, b1)) = 1, 'aprovado aparece ao público');
  perform tsta.login(r);
  perform tsta.denied(format($q$select public.admin_review_business(%L, 'suspend')$q$, b1), 'suspensão sem motivo', array['P0001']);
  perform tsta.ok(public.admin_review_business(b1, 'suspend', 'Reclamações') = 'suspended', 'suspende');
  perform tsta.anon();
  perform tsta.ok(tsta.count(format($q$select 1 from public.public_businesses where id = %L$q$, b1)) = 0, 'suspenso some do público');
  perform tsta.login(r);
  perform tsta.ok(public.admin_review_business(b1, 'reactivate') = 'active', 'reativa');
  perform tsta.su();
  perform tsta.ok(tsta.count(format($q$select 1 from public.audit_logs where entity_id = %L and action like 'business.%%'$q$, b1)) = 5,
                  'cada decisão auditada (envio + 4 decisões)');

  -- 6. ninguém analisa o próprio negócio
  perform tsta.login(r);
  b_r := public.submit_business_application('Negócio do Revisor', 'loja', city);
  perform tsta.denied(format($q$select public.admin_review_business(%L, 'approve')$q$, b_r), 'revisor aprova o próprio negócio');

  -- 7. cidades
  perform tsta.login(o);
  perform tsta.denied($q$select public.admin_save_city(null, 'Nova', 'MG')$q$, 'operador sem permissão cria cidade');
  perform tsta.denied('select * from public.admin_list_cities()', 'operador sem permissão lista cidades');
  perform tsta.login(r);
  new_city := public.admin_save_city(null, 'Cássia', 'mg', -20.6, -46.9, false);
  perform tsta.ok(tsta.count(format($q$select 1 from public.admin_list_cities() where id = %L and slug = 'cassia-mg' and state = 'MG'$q$, new_city)) = 1,
                  'cidade criada com slug e UF normalizada');
  perform tsta.ok(tsta.count(format($q$select 1 from public.admin_list_cities() where id = %L and not is_active$q$, new_city)) = 1, 'admin vê cidade inativa');
  perform tsta.denied($q$select public.admin_save_city(null, 'Outra', 'MGX')$q$, 'UF inválida', array['P0001']);
  perform tsta.denied($q$select public.admin_save_city(null, 'Outra', 'MG', -20.1, null)$q$, 'latitude sem longitude', array['P0001']);
  perform tsta.denied($q$select public.admin_save_city(null, 'Cássia', 'MG')$q$, 'cidade duplicada', array['23505']);
  perform public.admin_save_city(new_city, 'Cássia', 'MG', null, null, true);
  perform tsta.anon();
  perform tsta.ok(tsta.count(format($q$select 1 from public.cities where id = %L$q$, new_city)) = 1, 'cidade ativada visível ao público');
  perform tsta.login(c);
  perform tsta.denied(format($q$update public.cities set is_active = false where id = %L$q$, new_city), 'cliente altera cidade');

  -- 8. equipe: só o Master concede permissões; sem autoelevação
  perform tsta.login(r);
  perform tsta.denied(format($q$select public.admin_set_staff_permission(%L, 'audit.view', true)$q$, o), 'operador concede permissão');
  perform tsta.denied(format($q$insert into public.platform_staff_permissions(user_id, permission) values (%L, 'audit.view')$q$, r), 'operador se autoconcede por INSERT');
  perform tsta.denied(format($q$select public.grant_role(%L, 'platform_master')$q$, r), 'operador se promove a master');
  perform tsta.denied('select * from public.admin_list_staff()', 'operador lista equipe');
  perform tsta.denied('select * from public.admin_list_audit()', 'revisor sem audit.view lê auditoria');
  perform tsta.login(m);
  perform tsta.ok(tsta.count('select 1 from public.admin_list_staff()') = 3, 'master lista a equipe');
  perform public.admin_set_staff_permission(o, 'audit.view', true);
  perform tsta.denied(format($q$select public.admin_set_staff_permission(%L, 'audit.view', true)$q$, m), 'master altera as próprias permissões');
  perform tsta.denied(format($q$select public.admin_set_staff_permission(%L, 'audit.view', true)$q$, c), 'permissão para não operador', array['P0001']);
  perform tsta.denied(format($q$select public.admin_set_staff_permission(%L, 'tudo.liberado', true)$q$, o), 'permissão desconhecida', array['P0001']);
  perform tsta.login(o);
  perform tsta.ok(tsta.count('select 1 from public.admin_list_audit(200)') > 0, 'operador com audit.view lê auditoria');
  perform tsta.ok(tsta.count('select 1 from public.audit_logs') > 0, 'audit.view libera a tabela de auditoria');
  perform tsta.login(m);
  perform public.admin_set_staff_permission(o, 'audit.view', false);
  perform tsta.login(o);
  perform tsta.denied('select * from public.admin_list_audit()', 'permissão revogada');
  perform tsta.login(m);
  perform tsta.ok(tsta.count($q$select 1 from public.admin_list_audit(200) where action in ('staff_permission.grant', 'staff_permission.revoke')$q$) = 2, 'concessões auditadas');
  perform tsta.ok(tsta.count($q$select 1 from public.admin_find_user('CLIENTE-C@teste.invalid')$q$) = 1, 'busca de usuário por e-mail sem diferenciar caixa');
  -- revogar operador remove as permissões administrativas
  perform public.grant_role(d, 'platform_operator');
  perform public.admin_set_staff_permission(d, 'users.view', true);
  perform public.revoke_role(d, 'platform_operator');
  perform tsta.su();
  perform tsta.ok(not exists (select 1 from public.platform_staff_permissions where user_id = d), 'revogar operador limpa permissões');

  -- 9. painel geral
  perform tsta.login(m);
  access := public.admin_dashboard();
  perform tsta.ok((access->'businesses'->>'active')::int >= 1 and (access->>'cities_active')::int >= 2, 'painel com contagens reais');

  -- 10. configurações e MFA
  perform tsta.login(r);
  perform tsta.denied($q$select public.admin_set_setting('require_admin_mfa', 'false')$q$, 'operador altera configuração');
  perform tsta.denied('select * from public.admin_list_settings()', 'operador lista configurações');
  perform tsta.denied('select * from public.platform_settings', 'authenticated lê platform_settings direto');
  perform tsta.login(m);
  perform tsta.denied($q$select public.admin_set_setting('require_admin_mfa', '"sim"')$q$, 'valor não booleano', array['P0001']);
  perform tsta.denied($q$select public.admin_set_setting('require_admin_mfa', 'true')$q$, 'exigir MFA sem estar em aal2', array['P0001']);
  perform tsta.denied($q$select public.admin_set_setting('chave_nova', '1')$q$, 'configuração desconhecida', array['P0001']);
  perform tsta.login(m, 'aal2');
  perform public.admin_set_setting('require_admin_mfa', 'true');
  -- com MFA exigido, sessão aal1 perde todo acesso administrativo
  perform tsta.login(m);
  perform tsta.denied('select public.admin_dashboard()', 'master em aal1 com MFA exigido');
  perform tsta.denied(format($q$select public.grant_role(%L, 'platform_operator')$q$, d), 'grant_role em aal1 com MFA exigido');
  access := public.admin_my_access();
  perform tsta.ok(not (access->>'mfa_ok')::boolean and jsonb_array_length(access->'permissions') = 0, 'admin_my_access sinaliza MFA pendente');
  perform tsta.ok(tsta.count('select 1 from public.profiles') = 1, 'RLS administrativa também exige MFA');
  perform tsta.login(r);
  perform tsta.denied('select * from public.admin_list_businesses()', 'operador em aal1 com MFA exigido');
  perform tsta.login(r, 'aal2');
  perform tsta.ok(tsta.count('select 1 from public.admin_list_businesses()') >= 1, 'operador em aal2 volta a operar');
  perform tsta.login(m, 'aal2');
  perform tsta.ok((public.admin_dashboard()->>'users_total')::int >= 5, 'master em aal2 volta a operar');
  perform public.admin_set_setting('max_pending_business_applications', '5');
  perform tsta.denied($q$select public.admin_set_setting('max_pending_business_applications', '0')$q$, 'limite fora da faixa', array['P0001']);
  perform tsta.su();
  perform tsta.ok(tsta.count($q$select 1 from public.audit_logs where action = 'setting.update'$q$) = 2, 'configurações auditadas');

  -- 11. funções internas fora da API
  perform tsta.login(m, 'aal2');
  perform tsta.denied($q$select private.audit('x', 'y', 'z')$q$, 'authenticated chama private.audit');
  perform tsta.denied($q$select private.slugify('x')$q$, 'authenticated chama private.slugify');

  perform tsta.su();
  raise notice 'RLS_ADMIN_OK';
end $$;

rollback;
