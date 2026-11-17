-- 0057 — Excluir login (de teste ou real) pelo Master, e login excluído some da lista de Logins.
--  * admin_delete_account: só Master (com a verificação em duas etapas, se exigida), digitando EXCLUIR.
--    Não exclui a própria conta, nem outra conta da equipe Master/Operação, nem dono de estabelecimento real ativo
--    (para não apagar pedidos e financeiro de uma loja; remova ou transfira a loja antes).
--    Estabelecimentos de TESTE do login são removidos junto.
--  * Login de TESTE: apagado de vez (ou anonimizado, se citado em registros guardados).
--  * Login REAL: nunca é apagado de vez, porque pedidos, carteira e repasses dependem dele. A conta é anonimizada,
--    bloqueada para sempre, perde usuário, e-mail e papéis, e fica marcada como excluída (não entra mais).
--  * admin_list_accounts deixa de mostrar contas excluídas (inclusive as removidas antes desta versão).

create table if not exists private.deleted_accounts (
  user_id uuid primary key,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  was_test boolean not null default false
);
revoke all on private.deleted_accounts from public, anon, authenticated;

-- contas de teste removidas antes desta versão (anonimizadas com o e-mail removido-…)
insert into private.deleted_accounts(user_id, was_test)
select u.id, true from auth.users u where u.email like 'removido-%@teste.example.com'
on conflict (user_id) do nothing;

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.delete_account', 60, 3600)
on conflict (action) do nothing;

create or replace function private.is_deleted_account(_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.deleted_accounts where user_id = _user)
      or exists (select 1 from auth.users where id = _user and email like 'removido-%@teste.example.com')
$$;
revoke all on function private.is_deleted_account(uuid) from public, anon, authenticated;

create or replace function public.admin_delete_account(_user uuid, _confirm text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean;
  biz uuid;
  how text := 'apagada';
begin
  perform private.require_master();
  perform private.limit_for('admin.delete_account');
  if coalesce(btrim(_confirm), '') <> 'EXCLUIR' then raise exception 'Digite EXCLUIR para confirmar.' using errcode = 'P0001'; end if;
  if _user = auth.uid() then raise exception 'Você não pode excluir a própria conta.' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = _user) or private.is_deleted_account(_user) then
    raise exception 'Conta não encontrada ou já excluída.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.user_roles where user_id = _user and role in ('platform_master', 'platform_operator')) then
    raise exception 'Contas da equipe Master/Operação não podem ser excluídas aqui. Retire o papel na aba Equipe antes.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.businesses where owner_id = _user and not is_test) then
    raise exception 'Este login é dono de um estabelecimento real. Remova ou transfira o estabelecimento antes de excluir o login.' using errcode = 'P0001';
  end if;
  v_test := exists (select 1 from private.test_data_runs t where _user = any(t.user_ids))
            or exists (select 1 from auth.users where id = _user and email like '%@teste.example.com');

  perform set_config('tucai.internal', 'on', true);
  -- lojas de TESTE do login saem junto (com seus pedidos)
  for biz in select id from public.businesses where owner_id = _user and is_test loop
    delete from public.orders where business_id = biz;
    delete from public.businesses where id = biz;
  end loop;
  delete from public.couriers where user_id = _user;
  delete from public.business_members where user_id = _user;
  update public.profiles set username = null where id = _user;
  if v_test then
    -- login de TESTE: apaga de vez (se estiver citado em registros guardados, cai na anonimização)
    begin
      delete from auth.users where id = _user;
    exception when foreign_key_violation then
      how := 'anonimizada';
    end;
  else
    -- login REAL: nunca apaga de vez (pedidos, carteira e repasses ficam íntegros); anonimiza e tranca
    how := 'anonimizada';
  end if;
  if how = 'anonimizada' then
    perform private.anonymize_user(_user);
    delete from public.user_roles where user_id = _user;
    update auth.users set banned_until = 'infinity', email = 'excluido-' || _user::text || '@contas.invalid',
           raw_user_meta_data = '{}'::jsonb, updated_at = now()
     where id = _user;
    -- desliga o login com Google/e-mail desta conta (o e-mail fica livre para um cadastro novo)
    delete from auth.identities where user_id = _user;
  end if;
  perform set_config('tucai.internal', 'off', true);
  insert into private.deleted_accounts(user_id, deleted_by, was_test) values (_user, auth.uid(), v_test)
  on conflict (user_id) do nothing;
  perform private.audit('accounts.delete', 'auth.users', _user::text, jsonb_build_object('teste', v_test, 'resultado', how));
  return how;
end $$;

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
       -- 0057: contas excluídas não aparecem
       where not exists (select 1 from private.deleted_accounts d where d.user_id = u.id)
         and coalesce(u.email, '') not like 'removido-%@teste.example.com'
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

do $$ begin
  revoke all on function public.admin_delete_account(uuid, text) from public, anon;
  grant execute on function public.admin_delete_account(uuid, text) to authenticated;
end $$;
