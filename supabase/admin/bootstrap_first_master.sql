-- =====================================================================================
-- PRIMEIRO MASTER DA TUCAÍ — executar UMA única vez, manualmente, no SQL Editor do Supabase.
--
-- Pré-requisitos:
--   1. Banco criado (supabase/admin/apply_all_migrations.sql).
--   2. A conta já existe: cadastro pelo site (/cadastro) OU, no painel do Supabase,
--      Authentication -> Users -> Add user -> Create new user (marque "Auto Confirm User").
--
-- Uso: troque SEU-EMAIL@exemplo.com (linha "target_email" abaixo) pelo e-mail da conta e execute. Não é migration e não roda pelo app: o app nunca
-- consegue conceder platform_master a si mesmo (sem política de escrita em user_roles e
-- grant_role exige um Master autenticado).
--
-- Proteções: falha se já existir um Master (depois do primeiro, novos Masters só por
-- grant_role feito por um Master autenticado, com auditoria) e registra o bootstrap.
--
-- Depois: entre em /admin/entrar, abra Segurança, cadastre o autenticador (TOTP) e ative
-- "Exigir MFA de toda a equipe administrativa" antes de operar em produção.
-- =====================================================================================
do $$
declare
  target_email constant text := 'SEU-EMAIL@exemplo.com';
  uid uuid;
begin
  if target_email = 'SEU-EMAIL@exemplo.com' then
    raise exception 'Troque SEU-EMAIL@exemplo.com, na linha target_email, pelo e-mail da sua conta e rode de novo.';
  end if;
  if exists (select 1 from public.user_roles where role = 'platform_master') then
    raise exception 'Já existe um platform_master. Use grant_role a partir de um Master autenticado.';
  end if;
  select id into uid from auth.users where lower(email) = lower(target_email);
  if uid is null then
    raise exception 'Conta % não encontrada. Crie em Authentication -> Users -> Add user (Auto Confirm) ou pelo site em /cadastro.', target_email;
  end if;
  insert into public.user_roles(user_id, role) values (uid, 'platform_master');
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'bootstrap_master', 'user_roles', uid::text, jsonb_build_object('method', 'sql_editor'));
  raise notice 'platform_master concedido a % (%).', target_email, uid;
end $$;
