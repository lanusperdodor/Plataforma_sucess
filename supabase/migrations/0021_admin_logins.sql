-- 0021_admin_logins: aba "Logins" do Painel Master (suporte às contas).
--  * Listar contas reais e de teste (busca por nome, usuário ou e-mail): permissão users.view.
--  * Suporte (support.manage ou Master): alterar nome, usuário e senha, bloquear/desbloquear.
--  * Contas da equipe (Master/operador) só podem ser alteradas por um Master; ninguém bloqueia a si mesmo.
--  * Toda alteração vai para a auditoria (sem registrar a senha).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.accounts', 120, 600);

create or replace function private.require_account_support(_user uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_platform_permission('support.manage') or private.is_master_ok()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_roles where user_id = _user and role in ('platform_master', 'platform_operator'))
     and _user <> auth.uid() and not private.is_master_ok() then
    raise exception 'Contas da equipe só podem ser alteradas por um Master.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = _user) then raise exception 'Conta não encontrada.' using errcode = 'P0001'; end if;
end $$;
revoke all on function private.require_account_support(uuid) from public, anon, authenticated;

create or replace function public.admin_list_accounts(_search text default null, _kind text default 'todos', _limit integer default 50, _offset integer default 0)
returns table (id uuid, email text, full_name text, username text, phone text, roles text[], is_test boolean, blocked boolean,
               created_at timestamptz, last_sign_in_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(lower(btrim(coalesce(_search, ''))), '');
begin
  perform private.require_permission('users.view');
  return query
    with base as (
      select u.id, u.email::text as email, p.full_name, p.username, p.phone,
             coalesce((select array_agg(r.role::text order by r.role::text) from public.user_roles r where r.user_id = u.id), '{}') as roles,
             exists (select 1 from private.test_data_runs t where t.removed_at is null and u.id = any(t.user_ids)) as is_test,
             coalesce(u.banned_until > now(), false) as blocked, u.created_at, u.last_sign_in_at
        from auth.users u left join public.profiles p on p.id = u.id
    ), filtered as (
      select * from base b
       where (q is null or lower(coalesce(b.email, '')) like '%' || q || '%' or lower(coalesce(b.full_name, '')) like '%' || q || '%'
              or lower(coalesce(b.username, '')) like '%' || q || '%')
         and (coalesce(_kind, 'todos') = 'todos' or (_kind = 'teste' and b.is_test) or (_kind = 'reais' and not b.is_test))
    )
    select f.*, count(*) over () from filtered f
     order by f.created_at desc nulls last
     limit least(greatest(coalesce(_limit, 50), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

create or replace function public.admin_set_account_name(_user uuid, _name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if char_length(btrim(coalesce(_name, ''))) not between 2 and 120 then raise exception 'Nome de 2 a 120 caracteres.' using errcode = 'P0001'; end if;
  update public.profiles set full_name = btrim(_name) where id = _user;
  perform private.audit('accounts.name', 'profiles', _user::text, '{}'::jsonb);
end $$;

create or replace function public.admin_set_account_username(_user uuid, _username text) returns text
language plpgsql security definer set search_path = '' as $$
declare u text := nullif(lower(btrim(coalesce(_username, ''))), '');
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if u is not null and u !~ '^[a-z0-9._]{3,30}$' then raise exception 'Use de 3 a 30 letras minúsculas, números, ponto ou sublinhado.' using errcode = 'P0001'; end if;
  if u is not null and private.username_reserved(u) and not private.is_master_ok() then raise exception 'Nome de usuário reservado.' using errcode = 'P0001'; end if;
  update public.profiles set username = u where id = _user;
  perform private.audit('accounts.username', 'profiles', _user::text, jsonb_build_object('username', u));
  return u;
exception when unique_violation then
  raise exception 'Este nome de usuário já está em uso.' using errcode = 'P0001';
end $$;

create or replace function public.admin_set_account_password(_user uuid, _password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if char_length(coalesce(_password, '')) < 8 or _password !~ '[A-Za-z]' or _password !~ '[0-9]' then
    raise exception 'A senha precisa ter pelo menos 8 caracteres, com letras e números.' using errcode = 'P0001';
  end if;
  update auth.users set encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf')), updated_at = now() where id = _user;
  perform private.audit('accounts.password', 'auth.users', _user::text, '{}'::jsonb); -- a senha nunca é registrada
end $$;

create or replace function public.admin_set_account_blocked(_user uuid, _blocked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if _user = auth.uid() then raise exception 'Você não pode bloquear a própria conta.' using errcode = 'P0001'; end if;
  update auth.users set banned_until = case when _blocked then 'infinity'::timestamptz else null end, updated_at = now() where id = _user;
  perform private.audit(case when _blocked then 'accounts.block' else 'accounts.unblock' end, 'auth.users', _user::text, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_list_accounts(text, text, integer, integer)', 'public.admin_set_account_name(uuid, text)',
                           'public.admin_set_account_username(uuid, text)', 'public.admin_set_account_password(uuid, text)',
                           'public.admin_set_account_blocked(uuid, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
