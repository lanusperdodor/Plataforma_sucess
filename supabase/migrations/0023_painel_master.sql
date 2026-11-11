-- 0023_painel_master: Painel Master operacional.
--  * Auditoria paginada no banco (20 por página) com filtros por data, ação e usuário.
--  * Entregadores: lista com "Todos" (antes abria só em "Pendentes" e escondia os aprovados), busca,
--    entregas reais, contas de teste e histórico por entregador.
--  * Estabelecimentos: página com filtros (cidade, status, categoria, tipo) e imagem para os cards.
--  * Contas: detalhe (papéis, vínculos, entregador, pedidos, auditoria da conta); recuperação de senha
--    por e-mail registrada na auditoria; senha temporária só com regras fortes e troca obrigatória.
--  * Equipe: convite por e-mail (sem senha), vínculo de conta existente sem duplicar, Master com MFA e
--    confirmação reforçada.
--  * Financeiro: relatório por período/cidade/estabelecimento separando previsto, confirmado, recebido e
--    repassado; histórico de transações para exportação. Pagamentos: cobranças com provedor e eventos.
--  * Cidades: busca sem acento/maiúsculas no banco, com limite (escala para milhares de municípios).
--  * Nomes dos estabelecimentos de teste passam a trazer o código do lote (evita confundir lotes).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('admin.read', 1200, 600), ('admin.invite', 30, 3600), ('admin.password_email', 20, 3600)
on conflict (action) do nothing;

-- ---------- lotes de teste com nomes distintos ----------
-- manutenção interna pode renomear (a trava continua valendo para chamadas da API)
create or replace function private.businesses_name_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name and current_setting('role', true) in ('authenticated', 'anon')
     and coalesce(current_setting('tucai.internal', true), '') <> 'on'
     and not public.has_business_permission(new.id, 'settings.manage') then
    raise exception 'Somente o responsável pode alterar o nome do negócio.' using errcode = '42501';
  end if;
  return new;
end $$;

-- "[Teste] Mercadinho Teste · lote 6e9b5d": o código vem do e-mail do dono (lojista-6e9b5d@...)
create or replace function private.label_test_businesses(_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('tucai.internal', 'on', true);
  update public.businesses b set name = left(b.name || ' · lote ' || substring(u.email from '-([0-9a-f]{6})@'), 120)
    from auth.users u
   where u.id = b.owner_id and b.id = any(_ids) and b.name like '[Teste]%' and b.name not like '%· lote%'
     and substring(u.email from '-([0-9a-f]{6})@') is not null;
  perform set_config('tucai.internal', 'off', true);
end $$;
revoke all on function private.label_test_businesses(uuid[]) from public, anon, authenticated;

select private.label_test_businesses(coalesce((select array_agg(x) from private.test_data_runs r, unnest(r.business_ids) x where r.removed_at is null), '{}'));

alter function public.admin_create_test_data(uuid) set schema private;
alter function private.admin_create_test_data(uuid) rename to admin_create_test_data_impl;
revoke all on function private.admin_create_test_data_impl(uuid) from public, anon, authenticated;
create function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  res := private.admin_create_test_data_impl(_city);
  perform private.label_test_businesses((select business_ids from private.test_data_runs where id = (res->>'run_id')::uuid));
  return res;
end $$;

-- ---------- auditoria: 20 por página ----------
create or replace function public.admin_audit_page(_page integer default 1, _action text default null, _actor text default null,
                                                   _from date default null, _to date default null)
returns table (id bigint, actor_id uuid, actor_email text, actor_name text, action text, entity text, entity_id text,
               details jsonb, created_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare a text := nullif(btrim(coalesce(_action, '')), ''); who text := nullif(lower(btrim(coalesce(_actor, ''))), '');
begin
  perform private.require_permission('audit.view');
  return query
    select l.id, l.actor_id, u.email::text, p.full_name, l.action, l.entity, l.entity_id, l.details, l.created_at, count(*) over ()
      from public.audit_logs l
      left join auth.users u on u.id = l.actor_id
      left join public.profiles p on p.id = l.actor_id
     where (a is null or l.action = a)
       and (who is null or lower(u.email) like '%' || who || '%' or lower(coalesce(p.full_name, '')) like '%' || who || '%')
       and (_from is null or l.created_at >= (_from::timestamp at time zone 'America/Sao_Paulo'))
       and (_to is null or l.created_at < ((_to + 1)::timestamp at time zone 'America/Sao_Paulo'))
     order by l.created_at desc, l.id desc
     limit 20 offset (greatest(coalesce(_page, 1), 1) - 1) * 20;
end $$;

create or replace function public.admin_audit_actions() returns setof text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('audit.view');
  return query select distinct l.action from public.audit_logs l order by 1;
end $$;

-- ---------- entregadores ----------
create or replace function public.admin_couriers_page(_status text default 'todos', _search text default null, _page integer default 1)
returns table (user_id uuid, email text, full_name text, phone text, city_name text, vehicle public.courier_vehicle,
               vehicle_plate text, cnh_category text, status public.courier_status, is_online boolean, review_note text,
               submitted_at timestamptz, reviewed_at timestamptz, deliveries_done bigint, deliveries_active bigint,
               last_delivery_at timestamptz, is_test boolean, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare s text := nullif(lower(btrim(coalesce(_search, ''))), '');
begin
  perform private.require_permission('couriers.review');
  if coalesce(_status, 'todos') not in ('todos', 'pending', 'approved', 'rejected', 'suspended') then
    raise exception 'Filtro inválido.' using errcode = 'P0001';
  end if;
  return query
    select c.user_id, u.email::text, c.full_name, c.phone, ci.name || ' - ' || ci.state, c.vehicle, c.vehicle_plate, c.cnh_category,
           c.status, c.is_online, c.review_note, c.submitted_at, c.reviewed_at,
           (select count(*) from public.deliveries d where d.courier_id = c.user_id and d.status = 'delivered'),
           (select count(*) from public.deliveries d where d.courier_id = c.user_id and d.status in ('accepted', 'picked_up')),
           (select max(d.delivered_at) from public.deliveries d where d.courier_id = c.user_id),
           private.is_test_user(c.user_id), count(*) over ()
      from public.couriers c
      left join auth.users u on u.id = c.user_id
      left join public.cities ci on ci.id = c.city_id
     where (coalesce(_status, 'todos') = 'todos' or c.status::text = _status)
       and (s is null or lower(c.full_name) like '%' || s || '%' or lower(u.email) like '%' || s || '%')
     order by (c.status = 'pending') desc, c.submitted_at desc
     limit 30 offset (greatest(coalesce(_page, 1), 1) - 1) * 30;
end $$;

create or replace function public.admin_courier_history(_user uuid)
returns table (order_id uuid, order_code text, business_name text, status public.delivery_status, courier_pay_cents integer,
               accepted_at timestamptz, delivered_at timestamptz, is_test boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('couriers.review');
  return query
    select d.order_id, o.code, b.name, d.status, d.courier_pay_cents, d.accepted_at, d.delivered_at, d.is_test
      from public.deliveries d join public.orders o on o.id = d.order_id join public.businesses b on b.id = d.business_id
     where d.courier_id = _user
     order by coalesce(d.delivered_at, d.accepted_at, d.offered_at) desc
     limit 30;
end $$;

-- ---------- estabelecimentos (cards) ----------
create or replace function public.admin_businesses_page(_status public.business_status default null, _search text default null,
                                                        _city uuid default null, _category uuid default null,
                                                        _type public.business_type default null, _page integer default 1)
returns table (id uuid, name text, slug text, status public.business_status, business_type public.business_type,
               city_id uuid, city_name text, city_state text, category_id uuid, category_label text, owner_id uuid,
               owner_email text, owner_name text, phone text, description text, address_line text, logo_url text, cover_url text,
               submitted_at timestamptz, reviewed_at timestamptz, review_note text, created_at timestamptz, is_test boolean, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare s text := nullif(lower(btrim(coalesce(_search, ''))), '');
begin
  perform private.require_permission('businesses.review');
  return query
    select b.id, b.name, b.slug, b.status, b.business_type, b.city_id, c.name, c.state, b.category_id, k.label, b.owner_id,
           u.email::text, p.full_name, b.phone, b.description, b.address_line, b.logo_url, b.cover_url,
           b.submitted_at, b.reviewed_at, b.review_note, b.created_at, b.is_test, count(*) over ()
      from public.businesses b
      left join public.cities c on c.id = b.city_id
      left join public.categories k on k.id = b.category_id
      left join auth.users u on u.id = b.owner_id
      left join public.profiles p on p.id = b.owner_id
     where not b.is_demo
       and (_status is null or b.status = _status)
       and (_city is null or b.city_id = _city)
       and (_category is null or b.category_id = _category)
       and (_type is null or b.business_type = _type)
       and (s is null or lower(b.name) like '%' || s || '%' or lower(coalesce(u.email, '')) like '%' || s || '%')
     order by (b.status = 'pending') desc, coalesce(b.submitted_at, b.created_at) desc, b.id
     limit 12 offset (greatest(coalesce(_page, 1), 1) - 1) * 12;
end $$;

-- ---------- contas: detalhe ----------
create or replace function public.admin_account_detail(_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u record;
begin
  perform private.require_permission('users.view');
  select au.id, au.email::text as email, au.created_at, au.last_sign_in_at, au.banned_until, au.email_confirmed_at,
         p.full_name, p.username, p.phone
    into u from auth.users au left join public.profiles p on p.id = au.id where au.id = _user;
  if u.id is null then raise exception 'Conta não encontrada.' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'id', u.id, 'email', u.email, 'full_name', u.full_name, 'username', u.username, 'phone', u.phone,
    'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'email_confirmed', u.email_confirmed_at is not null,
    'blocked', u.banned_until is not null and u.banned_until > now(), 'is_test', private.is_test_user(u.id),
    'must_change_password', exists (select 1 from private.forced_password_changes f where f.user_id = u.id),
    'roles', coalesce((select jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id = u.id), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(sp.permission order by sp.permission) from public.platform_staff_permissions sp where sp.user_id = u.id), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('business_id', b.id, 'business', b.name, 'role', m.member_role, 'status', b.status))
                               from public.business_members m join public.businesses b on b.id = m.business_id where m.user_id = u.id), '[]'::jsonb),
    'courier', (select jsonb_build_object('status', c.status, 'city', ci.name, 'vehicle', c.vehicle, 'is_online', c.is_online)
                  from public.couriers c left join public.cities ci on ci.id = c.city_id where c.user_id = u.id),
    'orders', (select count(*) from public.orders o where o.customer_id = u.id),
    'audit', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select l.action, l.created_at, l.details, coalesce(ap.full_name, au2.email::text) as actor
          from public.audit_logs l left join auth.users au2 on au2.id = l.actor_id left join public.profiles ap on ap.id = l.actor_id
         where l.entity_id = u.id::text order by l.created_at desc limit 20) x), '[]'::jsonb));
end $$;

-- ---------- senha: recuperação por e-mail (registrada) e senha temporária controlada ----------
create table if not exists private.forced_password_changes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  forced_by uuid references auth.users(id) on delete set null,
  forced_at timestamptz not null default now()
);
revoke all on private.forced_password_changes from public, anon, authenticated;

-- quando a própria pessoa troca a senha (Minha conta ou link de recuperação), a obrigação some
create or replace function private.auth_password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(current_setting('tucai.admin_password', true), '') <> 'on' then
    delete from private.forced_password_changes where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists auth_password_changed on auth.users;
create trigger auth_password_changed after update of encrypted_password on auth.users
  for each row execute function private.auth_password_changed();

create or replace function public.must_change_password() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.forced_password_changes where user_id = auth.uid())
$$;

-- registra o envio do link de recuperação (o envio é do Supabase Auth, pela tela) e devolve o e-mail
create or replace function public.admin_password_recovery(_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.password_email');
  select email::text into e from auth.users where id = _user;
  if e is null or e like '%@tucai.example.com' then
    raise exception 'Esta conta não tem e-mail real (entra por usuário). Use a senha temporária.' using errcode = 'P0001';
  end if;
  perform private.audit('accounts.password_recovery_email', 'auth.users', _user::text, '{}'::jsonb);
  return e;
end $$;

-- senha temporária: conta de teste → suporte ou Master; conta real → só Master com MFA (aal2). Troca obrigatória.
create or replace function public.admin_set_account_password(_user uuid, _password text) returns void
language plpgsql security definer set search_path = '' as $$
declare test boolean := private.is_test_user(_user);
begin
  perform private.require_account_support(_user);
  perform private.limit_for('admin.accounts');
  if not test and not (private.is_master_ok() and private.current_aal() = 'aal2') then
    raise exception 'Senha temporária para conta real só pelo Master com verificação em duas etapas ativa. Envie o link de recuperação.' using errcode = '42501';
  end if;
  if char_length(coalesce(_password, '')) < 8 or _password !~ '[A-Za-z]' or _password !~ '[0-9]' then
    raise exception 'A senha precisa ter pelo menos 8 caracteres, com letras e números.' using errcode = 'P0001';
  end if;
  perform set_config('tucai.admin_password', 'on', true);
  update auth.users set encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf')), updated_at = now() where id = _user;
  perform set_config('tucai.admin_password', 'off', true);
  insert into private.forced_password_changes(user_id, forced_by) values (_user, auth.uid())
    on conflict (user_id) do update set forced_by = excluded.forced_by, forced_at = now();
  perform private.audit('accounts.password', 'auth.users', _user::text, jsonb_build_object('temporary', true, 'test_account', test)); -- nunca a senha
end $$;

-- ---------- equipe: convites e papéis ----------
create table if not exists private.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.app_role not null check (role in ('platform_operator', 'platform_master')),
  permissions text[] not null default '{}',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_user uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
create unique index if not exists staff_invites_open_idx on private.staff_invites(email) where accepted_at is null and revoked_at is null;
revoke all on private.staff_invites from public, anon, authenticated;

create or replace function private.require_master_mfa() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  if private.current_aal() <> 'aal2' then
    raise exception 'Esta ação exige a verificação em duas etapas (MFA) ativa na sua sessão.' using errcode = '42501';
  end if;
end $$;

create or replace function private.apply_staff_access(_user uuid, _role public.app_role, _permissions text[], _by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  insert into public.user_roles(user_id, role, granted_by) values (_user, _role, _by) on conflict do nothing;
  if _role = 'platform_operator' then
    foreach p in array coalesce(_permissions, '{}') loop
      insert into public.platform_staff_permissions(user_id, permission, granted_by)
      select _user, p, _by where exists (select 1 from public.platform_permissions where code = p)
      on conflict do nothing;
    end loop;
  end if;
end $$;

-- convite: conta existente é vinculada na hora (sem duplicar); e-mail novo fica pendente até a pessoa ativar
create or replace function public.admin_invite_staff(_email text, _role public.app_role, _permissions text[] default '{}', _confirm text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare e text := lower(btrim(coalesce(_email, ''))); existing uuid; bad text;
begin
  perform private.require_master();
  perform private.limit_for('admin.invite');
  if _role not in ('platform_operator', 'platform_master') then raise exception 'Papel inválido para a equipe.' using errcode = 'P0001'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.' using errcode = 'P0001'; end if;
  if _role = 'platform_master' then
    perform private.require_master_mfa();
    if coalesce(_confirm, '') <> 'CONCEDER MASTER' then
      raise exception 'Para conceder acesso Master, digite CONCEDER MASTER na confirmação.' using errcode = 'P0001';
    end if;
  end if;
  select x into bad from unnest(coalesce(_permissions, '{}')) x where not exists (select 1 from public.platform_permissions where code = x) limit 1;
  if bad is not null then raise exception 'Permissão desconhecida: %.', bad using errcode = 'P0001'; end if;
  select id into existing from auth.users where lower(email) = e;
  if existing is not null then
    perform private.apply_staff_access(existing, _role, _permissions, auth.uid());
    perform private.audit('staff.invite_existing', 'user_roles', existing::text, jsonb_build_object('role', _role, 'permissions', _permissions));
    return 'vinculado';
  end if;
  update private.staff_invites set revoked_at = now() where email = e and accepted_at is null and revoked_at is null;
  insert into private.staff_invites(email, role, permissions, invited_by) values (e, _role, coalesce(_permissions, '{}'), auth.uid());
  perform private.audit('staff.invite', 'staff_invites', e, jsonb_build_object('role', _role, 'permissions', _permissions));
  return 'convidado';
end $$;

create or replace function public.admin_list_invites()
returns table (id uuid, email text, role public.app_role, permissions text[], created_at timestamptz, expires_at timestamptz, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select i.id, i.email, i.role, i.permissions, i.created_at, i.expires_at,
           case when i.accepted_at is not null then 'aceito' when i.revoked_at is not null then 'cancelado'
                when i.expires_at < now() then 'expirado' else 'pendente' end
      from private.staff_invites i order by i.created_at desc limit 50;
end $$;

create or replace function public.admin_revoke_invite(_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  update private.staff_invites set revoked_at = now() where id = _id and accepted_at is null and revoked_at is null;
  if not found then raise exception 'Convite não está pendente.' using errcode = 'P0001'; end if;
  perform private.audit('staff.invite_revoke', 'staff_invites', _id::text, '{}'::jsonb);
end $$;

-- ao confirmar o e-mail pelo link (conta criada pelo convite), o acesso convidado é aplicado
create or replace function private.claim_staff_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i private.staff_invites%rowtype;
begin
  if new.email_confirmed_at is null or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then return new; end if;
  for i in select * from private.staff_invites
            where email = lower(new.email) and accepted_at is null and revoked_at is null and expires_at > now() loop
    perform private.apply_staff_access(new.id, i.role, i.permissions, i.invited_by);
    update private.staff_invites set accepted_at = now(), accepted_user = new.id where id = i.id;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (new.id, 'staff.invite_accept', 'user_roles', new.id::text, jsonb_build_object('role', i.role));
  end loop;
  return new;
end $$;
drop trigger if exists claim_staff_invites on auth.users;
create trigger claim_staff_invites after insert or update of email_confirmed_at on auth.users
  for each row execute function private.claim_staff_invites();

-- conceder Master exige MFA; revogar continua protegendo o último Master (0005)
create or replace function public.grant_role(_user uuid, _role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.role');
  if _role = 'platform_master' then perform private.require_master_mfa(); end if;
  if _role in ('courier_partner', 'courier_own', 'business_owner', 'business_staff', 'service_provider') then
    raise exception 'Este papel vem do cadastro e aprovação (entregador ou estabelecimento), não da Equipe.' using errcode = 'P0001';
  end if;
  perform private.grant_role_impl(_user, _role);
end $$;

-- ---------- financeiro ----------
create or replace function public.admin_finance_report(_from date, _to date, _city uuid default null, _business uuid default null,
                                                       _include_test boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  perform private.require_permission('finance.view');
  if _from is null or _to is null or _to < _from or _to - _from > 366 then
    raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001';
  end if;
  return (
    with o as (
      select o.* from public.orders o join public.businesses b on b.id = o.business_id
       where o.created_at >= f and o.created_at < t
         and (_include_test or not o.is_test)
         and (_city is null or b.city_id = _city) and (_business is null or o.business_id = _business)),
    ch as (
      select c.* from public.platform_charges c join public.businesses b on b.id = c.business_id
       where (_city is null or b.city_id = _city) and (_business is null or c.business_id = _business)
         and (_include_test or not b.is_test)),
    done as (select * from o where status in ('delivered', 'picked_up')),
    open as (select * from o where status not in ('delivered', 'picked_up', 'rejected', 'cancelled'))
    select jsonb_build_object(
      'confirmado', jsonb_build_object(
        'pedidos', (select count(*) from done),
        'volume_bruto_cents', coalesce((select sum(total_cents) from done), 0),
        'produtos_cents', coalesce((select sum(subtotal_cents) from done), 0),
        'comissao_cents', coalesce((select sum(commission_cents) from done), 0),
        'taxas_plataforma_cents', coalesce((select sum(platform_delivery_fee_cents) from done), 0),
        'devido_entregadores_cents', coalesce((select sum(courier_pay_cents) from done where fulfillment = 'delivery_partner'), 0),
        'logistica_estabelecimentos_cents', coalesce((select sum(merchant_delivery_contribution_cents) from done), 0)),
      'previsto', jsonb_build_object(
        'pedidos', (select count(*) from open),
        'volume_bruto_cents', coalesce((select sum(total_cents) from open), 0),
        'comissao_cents', coalesce((select sum(commission_cents) from open), 0),
        'taxas_plataforma_cents', coalesce((select sum(platform_delivery_fee_cents) from open), 0)),
      'cancelados', jsonb_build_object('pedidos', (select count(*) from o where status in ('rejected', 'cancelled')),
                                       'volume_cents', coalesce((select sum(total_cents) from o where status in ('rejected', 'cancelled')), 0)),
      'mensalidades', jsonb_build_object(
        'recebido_cents', coalesce((select sum(amount_cents) from ch where status = 'paga' and paid_at >= f and paid_at < t), 0),
        'recebido_online_cents', coalesce((select sum(amount_cents) from ch where status = 'paga' and provider is not null and paid_at >= f and paid_at < t), 0),
        'a_receber_cents', coalesce((select sum(amount_cents) from ch where status = 'aberta'), 0),
        'vencido_cents', coalesce((select sum(amount_cents) from ch where status = 'aberta' and due_on < current_date), 0)),
      'repassado', jsonb_build_object('entregadores_cents', 0, 'registrado', false),
      'reembolsos', jsonb_build_object('cents', 0, 'registrado', false),
      'por_estabelecimento', coalesce((select jsonb_agg(x order by x.volume_cents desc) from (
          select b.name as estabelecimento, count(*) as pedidos, sum(d.total_cents) as volume_cents,
                 sum(d.commission_cents + d.platform_delivery_fee_cents) as plataforma_cents
            from done d join public.businesses b on b.id = d.business_id group by b.name limit 50) x), '[]'::jsonb),
      'por_cidade', coalesce((select jsonb_agg(x order by x.volume_cents desc) from (
          select coalesce(c.name || ' - ' || c.state, 'Sem cidade') as cidade, count(*) as pedidos, sum(d.total_cents) as volume_cents
            from done d join public.businesses b on b.id = d.business_id left join public.cities c on c.id = b.city_id
           group by 1) x), '[]'::jsonb)));
end $$;

-- histórico de transações (pedidos concluídos/cancelados e cobranças), paginado; a exportação pede página a página
create or replace function public.admin_finance_transactions(_from date, _to date, _city uuid default null, _business uuid default null,
                                                             _kind text default 'todos', _include_test boolean default false, _page integer default 1)
returns table (kind text, ref text, occurred_at timestamptz, business_name text, city_name text, description text, status text,
               amount_cents integer, platform_cents integer, courier_cents integer, method text, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  perform private.require_permission('finance.view');
  if _from is null or _to is null or _to < _from or _to - _from > 366 then
    raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001';
  end if;
  if coalesce(_kind, 'todos') not in ('todos', 'pedido', 'cobranca') then raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  return query
    with x as (
      select 'pedido'::text as kind, o.code as ref, o.created_at as occurred_at, b.name as business_name,
             c.name || ' - ' || c.state as city_name,
             case o.fulfillment when 'pickup' then 'Pedido (retirada)' when 'delivery_own' then 'Pedido (entrega própria)' else 'Pedido (entregador parceiro)' end
               || case when o.is_test then ' · teste' else '' end as description,
             o.status::text as status, o.total_cents as amount_cents, o.commission_cents + o.platform_delivery_fee_cents as platform_cents,
             case when o.fulfillment = 'delivery_partner' then o.courier_pay_cents else 0 end as courier_cents,
             o.payment_method::text as method
        from public.orders o join public.businesses b on b.id = o.business_id left join public.cities c on c.id = b.city_id
       where coalesce(_kind, 'todos') in ('todos', 'pedido') and o.created_at >= f and o.created_at < t
         and (_include_test or not o.is_test) and (_city is null or b.city_id = _city) and (_business is null or o.business_id = _business)
      union all
      select 'cobranca', left(ch.id::text, 8), coalesce(ch.paid_at, ch.created_at), b.name, c.name || ' - ' || c.state,
             ch.description, ch.status::text, ch.amount_cents, case when ch.status = 'paga' then ch.amount_cents else 0 end, 0,
             coalesce(ch.provider, ch.paid_method)
        from public.platform_charges ch join public.businesses b on b.id = ch.business_id left join public.cities c on c.id = b.city_id
       where coalesce(_kind, 'todos') in ('todos', 'cobranca') and coalesce(ch.paid_at, ch.created_at) >= f and coalesce(ch.paid_at, ch.created_at) < t
         and (_include_test or not b.is_test) and (_city is null or b.city_id = _city) and (_business is null or ch.business_id = _business))
    select x.*, count(*) over () from x order by x.occurred_at desc
     limit 100 offset (greatest(coalesce(_page, 1), 1) - 1) * 100;
end $$;

-- ---------- pagamentos (cobranças da plataforma) ----------
create or replace function public.admin_payments_page(_status public.charge_status default null, _search text default null,
                                                      _origin text default 'todos', _page integer default 1)
returns table (id uuid, business_name text, kind public.charge_kind, description text, amount_cents integer, due_on date,
               status public.charge_status, paid_at timestamptz, paid_method text, provider text, provider_payment_id text,
               created_at timestamptz, events jsonb, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare s text := nullif(lower(btrim(coalesce(_search, ''))), '');
begin
  perform private.require_permission('finance.view');
  if coalesce(_origin, 'todos') not in ('todos', 'online', 'manual') then raise exception 'Origem inválida.' using errcode = 'P0001'; end if;
  return query
    select ch.id, b.name, ch.kind, ch.description, ch.amount_cents, ch.due_on, ch.status, ch.paid_at, ch.paid_method, ch.provider,
           ch.provider_payment_id, ch.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at) order by l.created_at)
                       from public.audit_logs l where l.entity = 'platform_charges' and l.entity_id = ch.id::text), '[]'::jsonb),
           count(*) over ()
      from public.platform_charges ch join public.businesses b on b.id = ch.business_id
     where (_status is null or ch.status = _status)
       and (s is null or lower(b.name) like '%' || s || '%' or lower(ch.description) like '%' || s || '%' or ch.provider_payment_id = s)
       and (coalesce(_origin, 'todos') = 'todos' or (_origin = 'online') = (ch.provider is not null and ch.status = 'paga'))
     order by ch.created_at desc
     limit 30 offset (greatest(coalesce(_page, 1), 1) - 1) * 30;
end $$;

-- ---------- cidades: busca escalável ----------
create or replace function private.search_norm(_t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(coalesce(_t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;
alter table public.cities add column if not exists search_name text generated always as (private.search_norm(name)) stored;
alter table public.cities add column if not exists ibge_code integer check (ibge_code is null or ibge_code between 1000000 and 9999999);
create unique index if not exists cities_ibge_code_idx on public.cities(ibge_code) where ibge_code is not null;
create index if not exists cities_search_name_idx on public.cities(search_name text_pattern_ops);

create or replace function public.search_cities(_q text default null, _state text default null, _limit integer default 30)
returns table (id uuid, name text, state text, slug text, center_lat numeric, center_lng numeric)
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(private.search_norm(_q)); st text := nullif(upper(btrim(coalesce(_state, ''))), '');
begin
  -- leitura barata e limitada (índice + LIMIT); sem contador, que seria compartilhado por todos os visitantes
  return query
    select c.id, c.name, c.state, c.slug, c.center_lat, c.center_lng
      from public.cities c
     where c.is_active and not c.is_demo
       and (st is null or c.state = st)
       and (q = '' or c.search_name like '%' || q || '%')
     order by (q <> '' and c.search_name like q || '%') desc, c.name
     limit least(greatest(coalesce(_limit, 30), 1), 100);
end $$;

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array['private.auth_password_changed()', 'private.require_master_mfa()', 'private.apply_staff_access(uuid, public.app_role, text[], uuid)',
                           'private.claim_staff_invites()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_audit_page(integer, text, text, date, date)', 'public.admin_audit_actions()',
    'public.admin_couriers_page(text, text, integer)', 'public.admin_courier_history(uuid)',
    'public.admin_businesses_page(public.business_status, text, uuid, uuid, public.business_type, integer)',
    'public.admin_account_detail(uuid)', 'public.must_change_password()', 'public.admin_password_recovery(uuid)',
    'public.admin_set_account_password(uuid, text)', 'public.admin_invite_staff(text, public.app_role, text[], text)',
    'public.admin_list_invites()', 'public.admin_revoke_invite(uuid)', 'public.grant_role(uuid, public.app_role)',
    'public.admin_finance_report(date, date, uuid, uuid, boolean)',
    'public.admin_finance_transactions(date, date, uuid, uuid, text, boolean, integer)',
    'public.admin_payments_page(public.charge_status, text, text, integer)', 'public.admin_create_test_data(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function public.search_cities(text, text, integer) from public;
  grant execute on function public.search_cities(text, text, integer) to anon, authenticated;
end $$;
