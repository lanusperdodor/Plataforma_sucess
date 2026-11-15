-- 0051: equipe da loja — funções personalizadas e convite pelo NOME DE USUÁRIO.
--  * Função = nome escolhido pelo empresário (ex.: "Caixa", "Balconista", "Motoboy") + cargo base + permissões extras.
--    Atribuir a função a alguém aplica o cargo e as permissões; mudar a função atualiza todos que a usam.
--  * Permissões extras possíveis (nunca as de dono: equipe, configurações e dados da loja): ver e atualizar pedidos,
--    cardápio, comandas, caixa, relatórios, vagas e entregas próprias.
--  * Convite pelo nome de usuário (único em toda a Tucaí): a pessoa entra na equipe na hora; nome inexistente avisa.

-- permissões extras liberadas para funções (antes: só comandas, caixa e relatórios)
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'business_member_permissions_permission_check') then
    alter table public.business_member_permissions drop constraint business_member_permissions_permission_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_member_permissions_permission_ok') then
    alter table public.business_member_permissions add constraint business_member_permissions_permission_ok check (permission in
      ('orders.view', 'orders.update_status', 'menu.manage', 'tabs.manage', 'cash.manage', 'reports.view', 'jobs.manage', 'delivery.manage_own'));
  end if;
end $$;

create or replace function private.function_extra_ok(_p text) returns boolean
language sql immutable set search_path = '' as $$
  select _p in ('orders.view', 'orders.update_status', 'menu.manage', 'tabs.manage', 'cash.manage', 'reports.view', 'jobs.manage', 'delivery.manage_own')
$$;

create table if not exists public.business_functions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 40),
  base_role public.member_role not null check (base_role in ('manager', 'attendant', 'kitchen', 'courier_own')),
  extras text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists business_functions_name_idx on public.business_functions(business_id, lower(btrim(name)));
create index if not exists business_functions_created_by_idx on public.business_functions(created_by);
alter table public.business_functions enable row level security;
drop policy if exists business_functions_select on public.business_functions;
create policy business_functions_select on public.business_functions for select to authenticated
  using (public.has_business_permission(business_id, 'staff.manage'));
revoke all on public.business_functions from public, anon, authenticated;
grant select on public.business_functions to authenticated;

alter table public.business_members add column if not exists function_id uuid references public.business_functions(id) on delete set null;
create index if not exists business_members_function_idx on public.business_members(function_id);

-- aplica cargo + extras da função a um integrante (uso interno)
create or replace function private.apply_function(_business uuid, _user uuid, _fn uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.business_functions%rowtype; p text;
begin
  select * into f from public.business_functions where id = _fn and business_id = _business;
  if not found then raise exception 'Função não encontrada.' using errcode = 'P0001'; end if;
  update public.business_members set member_role = f.base_role, function_id = f.id where business_id = _business and user_id = _user and member_role <> 'owner';
  if not found then raise exception 'Integrante não encontrado (o proprietário não muda de função).' using errcode = 'P0001'; end if;
  delete from public.business_member_permissions where business_id = _business and user_id = _user;
  foreach p in array f.extras loop
    insert into public.business_member_permissions(business_id, user_id, permission, granted_by) values (_business, _user, p, auth.uid()) on conflict do nothing;
  end loop;
end $$;

-- cria ou altera uma função (e reaplica a quem já usa)
create or replace function public.merchant_save_function(_business uuid, _id uuid, _name text, _base_role public.member_role, _extras text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare fid uuid; p text; u uuid; ex text[] := coalesce(_extras, '{}');
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _base_role not in ('manager', 'attendant', 'kitchen', 'courier_own') then raise exception 'Cargo base inválido.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(_name, ''))) not between 2 and 40 then raise exception 'Dê um nome de 2 a 40 letras para a função.' using errcode = 'P0001'; end if;
  foreach p in array ex loop
    if not private.function_extra_ok(p) then raise exception 'Permissão não permitida para funções: %', p using errcode = 'P0001'; end if;
  end loop;
  ex := array(select distinct unnest(ex) order by 1);
  if _id is null then
    insert into public.business_functions(business_id, name, base_role, extras, created_by) values (_business, btrim(_name), _base_role, ex, auth.uid()) returning id into fid;
  else
    update public.business_functions set name = btrim(_name), base_role = _base_role, extras = ex where id = _id and business_id = _business returning id into fid;
    if fid is null then raise exception 'Função não encontrada.' using errcode = 'P0001'; end if;
    for u in select user_id from public.business_members where business_id = _business and function_id = fid loop
      perform private.apply_function(_business, u, fid);
    end loop;
  end if;
  perform private.audit('business.function_save', 'business_functions', fid::text, jsonb_build_object('nome', btrim(_name), 'cargo', _base_role, 'extras', ex));
  return fid;
exception when unique_violation then
  raise exception 'Já existe uma função com esse nome.' using errcode = 'P0001';
end $$;

create or replace function public.merchant_delete_function(_business uuid, _id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  delete from public.business_functions where id = _id and business_id = _business;
  if not found then raise exception 'Função não encontrada.' using errcode = 'P0001'; end if;
  perform private.audit('business.function_delete', 'business_functions', _id::text, '{}'::jsonb);
end $$;

create or replace function public.merchant_apply_function(_business uuid, _user uuid, _fn uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  perform private.apply_function(_business, _user, _fn);
  perform private.audit('business.member_function', 'business_members', _business::text, jsonb_build_object('user', _user, 'funcao', _fn));
end $$;

-- convite pelo nome de usuário: entra na equipe na hora (com a função ou o cargo escolhido)
create or replace function public.merchant_invite_by_username(_business uuid, _username text, _role public.member_role, _fn uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare un text := lower(btrim(coalesce(_username, ''))); u uuid; f public.business_functions%rowtype;
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  un := regexp_replace(un, '^@', '');
  if un !~ '^[a-z0-9._]{3,30}$' then raise exception 'Nome de usuário inválido.' using errcode = 'P0001'; end if;
  select id into u from public.profiles where username = un;
  if u is null then raise exception 'Nome de usuário não encontrado. Confira com a pessoa e tente novamente.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.business_members where business_id = _business and user_id = u) then
    raise exception 'Esta pessoa já faz parte da equipe.' using errcode = 'P0001';
  end if;
  if _fn is not null then
    select * into f from public.business_functions where id = _fn and business_id = _business;
    if not found then raise exception 'Função não encontrada.' using errcode = 'P0001'; end if;
    insert into public.business_members(business_id, user_id, member_role) values (_business, u, f.base_role);
    perform private.apply_function(_business, u, f.id);
  else
    if _role is null or _role = 'owner' then raise exception 'Escolha uma função ou um cargo.' using errcode = 'P0001'; end if;
    insert into public.business_members(business_id, user_id, member_role) values (_business, u, _role);
  end if;
  perform private.audit('business.member_add', 'business_members', _business::text, jsonb_build_object('user', u, 'via', 'usuario', 'funcao', _fn, 'role', _role));
  return 'vinculado';
end $$;

-- equipe: + nome de usuário e função
drop function if exists public.merchant_team(uuid);
create function public.merchant_team(_business uuid)
returns table (user_id uuid, name text, email text, member_role public.member_role, pending boolean, invite_id uuid, created_at timestamptz,
               username text, function_id uuid, function_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.user_id, p.full_name, u.email::text, m.member_role, false, null::uuid, m.created_at, p.username, m.function_id, f.name
      from public.business_members m left join public.profiles p on p.id = m.user_id left join auth.users u on u.id = m.user_id
      left join public.business_functions f on f.id = m.function_id
     where m.business_id = _business
    union all
    select null, null, i.email, i.member_role, true, i.id, i.created_at, null, null, null
      from private.business_invites i where i.business_id = _business and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     order by 7;
end $$;

-- extras avulsos continuam pela mesma função, agora com a lista ampliada
create or replace function public.merchant_set_member_permission(_business uuid, _user uuid, _permission text, _granted boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if not private.function_extra_ok(_permission) then raise exception 'Permissão inválida.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.business_members where business_id = _business and user_id = _user and member_role <> 'owner') then
    raise exception 'Integrante não encontrado.' using errcode = 'P0001';
  end if;
  if _granted then
    insert into public.business_member_permissions(business_id, user_id, permission, granted_by) values (_business, _user, _permission, auth.uid()) on conflict do nothing;
  else
    delete from public.business_member_permissions where business_id = _business and user_id = _user and permission = _permission;
  end if;
  perform private.audit(case when _granted then 'business.member_permission_grant' else 'business.member_permission_revoke' end,
                        'business_member_permissions', _business::text, jsonb_build_object('user', _user, 'permission', _permission));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.merchant_save_function(uuid, uuid, text, public.member_role, text[])', 'public.merchant_delete_function(uuid, uuid)',
                           'public.merchant_apply_function(uuid, uuid, uuid)', 'public.merchant_invite_by_username(uuid, text, public.member_role, uuid)',
                           'public.merchant_team(uuid)', 'public.merchant_set_member_permission(uuid, uuid, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function private.apply_function(uuid, uuid, uuid) from public, anon, authenticated;
  revoke all on function private.function_extra_ok(text) from public, anon, authenticated;
end $$;
