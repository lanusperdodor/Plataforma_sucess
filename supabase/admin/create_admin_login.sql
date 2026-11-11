-- =====================================================================================
-- LOGIN DE ADMINISTRADOR (usuário "admin") — executar manualmente no SQL Editor do Supabase.
--
-- Cria (ou atualiza a senha de) a conta admin@tucai.example.com e concede platform_master.
-- Na tela de login (/entrar ou /admin/entrar) basta digitar o usuário admin (maiúsculas ou minúsculas) e a senha.
-- example.com é um domínio reservado: nenhum e-mail é enviado para ele.
--
-- Uso: troque TROQUE-PELA-SENHA (linha admin_password) pela senha desejada e execute.
-- NUNCA salve a senha neste arquivo no GitHub.
--
-- Depois: no primeiro acesso o painel pede para cadastrar o autenticador (MFA) em Segurança.
-- Pré-requisito: banco atualizado (supabase/admin/apply_all_migrations.sql, até a 0016).
-- =====================================================================================
do $$
declare
  admin_email constant text := 'admin@tucai.example.com';
  admin_password constant text := 'TROQUE-PELA-SENHA';
  uid uuid;
begin
  if admin_password = 'TROQUE-PELA-SENHA' then
    raise exception 'Troque TROQUE-PELA-SENHA, na linha admin_password, pela senha do administrador e rode de novo.';
  end if;
  if char_length(admin_password) < 8 then
    raise exception 'Use uma senha com pelo menos 8 caracteres.';
  end if;
  select id into uid from auth.users where lower(email) = admin_email;
  if uid is null then
    uid := private.create_auth_user(admin_email, admin_password, 'Administrador Tucaí');
    raise notice 'Conta % criada.', admin_email;
  else
    update auth.users set encrypted_password = extensions.crypt(admin_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()), banned_until = null, updated_at = now()
     where id = uid;
    raise notice 'Senha da conta % atualizada.', admin_email;
  end if;
  update public.profiles set username = 'admin' where id = uid;  -- entra digitando admin, ADMIN ou Admin
  insert into public.user_roles(user_id, role) values (uid, 'platform_master') on conflict do nothing;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'bootstrap_master', 'user_roles', uid::text, jsonb_build_object('method', 'create_admin_login.sql'));
  raise notice 'Pronto: entre em /admin/entrar com o usuário admin.';
end $$;
