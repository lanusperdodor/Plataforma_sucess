-- 0005_platform_admin: base do Painel Master.
--  * Configurações operacionais (platform_settings) alteráveis só pelo Master, com auditoria.
--  * Permissões administrativas configuráveis por integrante (operadores não recebem nada por padrão).
--  * MFA: com require_admin_mfa = true, toda permissão administrativa exige sessão aal2.
--  * Solicitação de cadastro de estabelecimento pelo próprio usuário e análise pelo Master.
--  * Gestão de cidades, equipe e consulta de auditoria por funções SECURITY DEFINER.
-- Nenhuma autoelevação: só o Master concede papéis/permissões; ninguém aprova o próprio negócio.

-- ---------- auditoria (helper interno) ----------
create or replace function private.audit(_action text, _entity text, _entity_id text, _details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (auth.uid(), _action, _entity, _entity_id, coalesce(_details, '{}'::jsonb))
$$;

-- ---------- configurações operacionais ----------
create table public.platform_settings (
  key text primary key check (key in ('require_admin_mfa', 'max_pending_business_applications')),
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(key, value) values
  -- Ativar (true) assim que o primeiro Master cadastrar o fator TOTP; obrigatório antes de produção.
  ('require_admin_mfa', 'false'::jsonb),
  ('max_pending_business_applications', '3'::jsonb);
create index platform_settings_updated_by_idx on public.platform_settings(updated_by);

create or replace function private.setting(_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.platform_settings where key = _key
$$;

-- ---------- MFA ----------
-- aal2 = sessão verificada com segundo fator (Supabase Auth MFA/TOTP).
create or replace function private.current_aal() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1')
$$;

create or replace function private.admin_mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((private.setting('require_admin_mfa'))::text::boolean, false) = false
      or private.current_aal() = 'aal2'
$$;

-- ---------- permissões administrativas ----------
create table public.platform_permissions (
  code text primary key check (code ~ '^[a-z]+(\.[a-z_]+)+$'),
  description text not null check (char_length(description) between 3 and 160),
  sort_order integer not null default 0
);
insert into public.platform_permissions(code, description, sort_order) values
  ('admin.dashboard',    'Ver o painel geral', 10),
  ('users.view',         'Consultar usuários e perfis', 20),
  ('businesses.review',  'Analisar, aprovar, recusar e suspender estabelecimentos', 30),
  ('cities.manage',      'Gerenciar cidades', 40),
  ('audit.view',         'Consultar logs de auditoria', 50),
  ('couriers.review',    'Analisar entregadores (Sprint 5)', 60),
  ('orders.view',        'Consultar pedidos e entregas (Sprint 4)', 70),
  ('finance.view',       'Consultar financeiro e repasses (Sprint 6)', 80),
  ('moderation.manage',  'Moderar o Conecta e tratar denúncias (Sprint 9)', 90),
  ('support.manage',     'Atender chamados (Sprint 11)', 100),
  ('campaigns.manage',   'Gerenciar campanhas e conteúdo patrocinado (Sprint 11)', 110),
  ('jobs.manage',        'Gerenciar vagas (Sprint 11)', 120);
-- Reservado ao Master (não concedível): papéis, equipe, configurações, planos e regras comerciais.

create table public.platform_staff_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null references public.platform_permissions(code) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, permission)
);
create index platform_staff_permissions_permission_idx on public.platform_staff_permissions(permission);
create index platform_staff_permissions_granted_by_idx on public.platform_staff_permissions(granted_by);

create or replace function public.has_platform_permission(_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.admin_mfa_ok() and (
    public.has_role('platform_master')
    or (public.has_role('platform_operator') and exists (
          select 1 from public.platform_staff_permissions
           where user_id = auth.uid() and permission = _permission)))
$$;

create or replace function private.is_master_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('platform_master') and private.admin_mfa_ok()
$$;

create or replace function private.require_permission(_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_platform_permission(_permission) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function private.require_master() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_master_ok() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ---------- papéis: Master + MFA (substitui as versões da 0001) ----------
create or replace function public.grant_role(_user uuid, _role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  if not exists (select 1 from auth.users where id = _user) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0001';
  end if;
  insert into public.user_roles(user_id, role, granted_by) values (_user, _role, auth.uid())
    on conflict do nothing;
  perform private.audit('grant_role', 'user_roles', _user::text, jsonb_build_object('role', _role));
end $$;

create or replace function public.revoke_role(_user uuid, _role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  if _role = 'customer' then raise exception 'customer role is permanent' using errcode = 'P0001'; end if;
  if _role = 'platform_master' and (select count(*) from public.user_roles where role = 'platform_master') <= 1 then
    raise exception 'cannot revoke the last platform_master' using errcode = 'P0001';
  end if;
  delete from public.user_roles where user_id = _user and role = _role;
  if _role = 'platform_operator' then
    delete from public.platform_staff_permissions where user_id = _user;
  end if;
  perform private.audit('revoke_role', 'user_roles', _user::text, jsonb_build_object('role', _role));
end $$;

-- ---------- políticas da 0001: leitura administrativa por permissão (não por papel genérico) ----------
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_platform_permission('users.view'));

drop policy user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_platform_permission('users.view'));

drop policy businesses_member_select on public.businesses;
create policy businesses_member_select on public.businesses for select to authenticated
  using (public.is_business_member(id) or public.has_platform_permission('businesses.review'));

drop policy audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (public.has_platform_permission('audit.view'));

-- ---------- estabelecimentos: dados da análise ----------
alter table public.businesses
  add column submitted_at timestamptz,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id),
  add column review_note text check (review_note is null or char_length(review_note) <= 500);
create index businesses_reviewed_by_idx on public.businesses(reviewed_by);
create index businesses_status_submitted_idx on public.businesses(status, submitted_at desc);

-- slug estável a partir do nome (sem depender da extensão unaccent)
create or replace function private.slugify(_text text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(
           translate(lower(_text), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]+', '-', 'g')), 60), ''), 'negocio')
$$;

create or replace function private.unique_business_slug(_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare base text := trim(both '-' from private.slugify(_name)); candidate text; n int := 1;
begin
  if base = '' then base := 'negocio'; end if;
  candidate := base;
  while exists (select 1 from public.businesses where slug = candidate) loop
    n := n + 1;
    candidate := left(base, 55) || '-' || n;
  end loop;
  return candidate;
end $$;

-- Solicitação de cadastro feita pelo próprio usuário (fica "pending" até a análise).
create or replace function public.submit_business_application(
  _name text,
  _business_type public.business_type,
  _city_id uuid,
  _category_id uuid default null,
  _phone text default null,
  _description text default null,
  _address_line text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  max_pending int := coalesce((private.setting('max_pending_business_applications'))::text::int, 3);
  new_id uuid;
  clean_name text := btrim(coalesce(_name, ''));
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Informe o nome do negócio (2 a 120 caracteres).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cities where id = _city_id and is_active and not is_demo) then
    raise exception 'Cidade indisponível.' using errcode = 'P0001';
  end if;
  if _category_id is not null and not exists (
       select 1 from public.categories where id = _category_id and not is_demo and kind = _business_type::text) then
    raise exception 'Categoria incompatível com o tipo de negócio.' using errcode = 'P0001';
  end if;
  if _phone is not null and _phone !~ '^[0-9+() -]{8,20}$' then
    raise exception 'Telefone inválido.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(_description, '')) > 1000 or char_length(coalesce(_address_line, '')) > 200 then
    raise exception 'Texto muito longo.' using errcode = 'P0001';
  end if;
  -- proteção contra spam: limite de solicitações em análise por usuário
  perform pg_advisory_xact_lock(hashtext('business_application:' || uid::text));
  if (select count(*) from public.businesses where owner_id = uid and status = 'pending') >= max_pending then
    raise exception 'Você já tem solicitações em análise. Aguarde a resposta da equipe Tucaí.' using errcode = 'P0001';
  end if;

  insert into public.businesses (name, slug, owner_id, status, business_type, category_id, city_id,
                                 phone, description, address_line, submitted_at, is_demo)
  values (clean_name, private.unique_business_slug(clean_name), uid, 'pending', _business_type, _category_id, _city_id,
          nullif(btrim(_phone), ''), nullif(btrim(_description), ''), nullif(btrim(_address_line), ''), now(), false)
  returning id into new_id;

  insert into public.business_members(business_id, user_id, member_role) values (new_id, uid, 'owner');
  perform private.audit('business.submit', 'businesses', new_id::text,
                        jsonb_build_object('name', clean_name, 'type', _business_type));
  return new_id;
end $$;

-- Análise pelo Master/operador com permissão. Transições válidas:
--   approve:    pending | rejected -> active
--   reject:     pending            -> rejected   (motivo obrigatório)
--   suspend:    active             -> suspended  (motivo obrigatório)
--   reactivate: suspended          -> active
create or replace function public.admin_review_business(_business uuid, _decision text, _note text default null)
returns public.business_status
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses%rowtype;
  next_status public.business_status;
  note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('businesses.review');
  select * into b from public.businesses where id = _business for update;
  if not found or b.is_demo then raise exception 'Estabelecimento não encontrado.' using errcode = 'P0001'; end if;
  if b.owner_id = auth.uid() or exists (select 1 from public.business_members where business_id = b.id and user_id = auth.uid()) then
    raise exception 'Você não pode analisar um estabelecimento do qual faz parte.' using errcode = '42501';
  end if;
  if char_length(coalesce(note, '')) > 500 then
    raise exception 'Motivo muito longo (máximo 500 caracteres).' using errcode = 'P0001';
  end if;

  next_status := case
    when _decision = 'approve' and b.status::text in ('pending', 'rejected') then 'active'
    when _decision = 'reject' and b.status = 'pending' then 'rejected'
    when _decision = 'suspend' and b.status = 'active' then 'suspended'
    when _decision = 'reactivate' and b.status = 'suspended' then 'active'
  end;
  if next_status is null then
    raise exception 'Transição inválida: % a partir de %.', _decision, b.status using errcode = 'P0001';
  end if;
  if _decision in ('reject', 'suspend') and note is null then
    raise exception 'Informe o motivo.' using errcode = 'P0001';
  end if;

  update public.businesses
     set status = next_status, reviewed_at = now(), reviewed_by = auth.uid(), review_note = note
   where id = b.id;
  if next_status = 'active' then
    insert into public.user_roles(user_id, role, granted_by) values (b.owner_id, 'business_owner', auth.uid())
      on conflict do nothing;
  end if;
  perform private.audit('business.' || _decision, 'businesses', b.id::text,
                        jsonb_build_object('from', b.status, 'to', next_status, 'note', note));
  return next_status;
end $$;

create or replace function public.admin_list_businesses(
  _status public.business_status default null,
  _search text default null,
  _limit int default 50,
  _offset int default 0
) returns table (
  id uuid, name text, slug text, status public.business_status, business_type public.business_type,
  city_name text, city_state text, category_label text, owner_id uuid, owner_email text, owner_name text,
  phone text, description text, address_line text, submitted_at timestamptz, reviewed_at timestamptz,
  review_note text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('businesses.review');
  return query
    select b.id, b.name, b.slug, b.status, b.business_type, c.name, c.state, k.label, b.owner_id,
           u.email::text, p.full_name, b.phone, b.description, b.address_line, b.submitted_at,
           b.reviewed_at, b.review_note, b.created_at
      from public.businesses b
      left join public.cities c on c.id = b.city_id
      left join public.categories k on k.id = b.category_id
      left join auth.users u on u.id = b.owner_id
      left join public.profiles p on p.id = b.owner_id
     where not b.is_demo
       and (_status is null or b.status = _status)
       and (_search is null or b.name ilike '%' || replace(replace(_search, '%', ''), '_', '') || '%')
     order by coalesce(b.submitted_at, b.created_at) desc, b.id
     limit least(greatest(coalesce(_limit, 50), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

-- ---------- cidades ----------
create or replace function public.admin_list_cities()
returns table (id uuid, name text, state text, slug text, center_lat numeric, center_lng numeric,
               is_active boolean, businesses_active bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('cities.manage');
  return query
    select c.id, c.name, c.state, c.slug, c.center_lat, c.center_lng, c.is_active,
           (select count(*) from public.businesses b where b.city_id = c.id and b.status = 'active' and not b.is_demo),
           c.created_at
      from public.cities c where not c.is_demo order by c.state, c.name;
end $$;

create or replace function public.admin_save_city(
  _id uuid, _name text, _state text, _center_lat numeric default null, _center_lng numeric default null,
  _is_active boolean default true
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(coalesce(_name, ''));
  uf text := upper(btrim(coalesce(_state, '')));
  result uuid;
  before jsonb;
begin
  perform private.require_permission('cities.manage');
  if char_length(clean_name) not between 2 and 120 then raise exception 'Nome da cidade inválido.' using errcode = 'P0001'; end if;
  if uf !~ '^[A-Z]{2}$' then raise exception 'UF inválida.' using errcode = 'P0001'; end if;
  if (_center_lat is null) <> (_center_lng is null) then
    raise exception 'Informe latitude e longitude juntas.' using errcode = 'P0001';
  end if;
  if _center_lat is not null and (_center_lat not between -90 and 90 or _center_lng not between -180 and 180) then
    raise exception 'Coordenadas inválidas.' using errcode = 'P0001';
  end if;
  if _id is null then
    insert into public.cities(name, state, slug, center_lat, center_lng, is_active)
    values (clean_name, uf, private.slugify(clean_name || '-' || uf), _center_lat, _center_lng, coalesce(_is_active, true))
    returning id into result;
    perform private.audit('city.create', 'cities', result::text, jsonb_build_object('name', clean_name, 'state', uf));
  else
    select to_jsonb(c) into before from public.cities c where c.id = _id and not c.is_demo for update;
    if before is null then raise exception 'Cidade não encontrada.' using errcode = 'P0001'; end if;
    update public.cities
       set name = clean_name, state = uf, center_lat = _center_lat, center_lng = _center_lng,
           is_active = coalesce(_is_active, is_active)
     where id = _id returning id into result;
    perform private.audit('city.update', 'cities', result::text,
      jsonb_build_object('before', before - 'created_at' - 'updated_at',
                         'after', jsonb_build_object('name', clean_name, 'state', uf, 'center_lat', _center_lat,
                                                     'center_lng', _center_lng, 'is_active', _is_active)));
  end if;
  return result;
exception when unique_violation then
  raise exception 'Já existe uma cidade com este nome nesta UF.' using errcode = '23505';
end $$;

-- ---------- painel geral ----------
create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('admin.dashboard');
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'businesses', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                     from (select status, count(*) n from public.businesses where not is_demo group by status) s),
    'cities_active', (select count(*) from public.cities where is_active and not is_demo),
    'staff_total', (select count(distinct user_id) from public.user_roles where role in ('platform_master', 'platform_operator')),
    'audit_last_24h', (select count(*) from public.audit_logs where created_at > now() - interval '24 hours'),
    'generated_at', now());
end $$;

-- ---------- usuários e equipe ----------
create or replace function public.admin_find_user(_email text)
returns table (user_id uuid, email text, full_name text, roles public.app_role[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('users.view');
  return query
    select u.id, u.email::text, p.full_name,
           coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = u.id), '{}')
      from auth.users u left join public.profiles p on p.id = u.id
     where lower(u.email) = lower(btrim(coalesce(_email, '')));
end $$;

create or replace function public.admin_list_staff()
returns table (user_id uuid, email text, full_name text, roles public.app_role[], permissions text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select u.id, u.email::text, p.full_name,
           (select array_agg(r.role order by r.role) from public.user_roles r
             where r.user_id = u.id and r.role in ('platform_master', 'platform_operator')),
           coalesce((select array_agg(s.permission order by s.permission) from public.platform_staff_permissions s
                      where s.user_id = u.id), '{}')
      from auth.users u left join public.profiles p on p.id = u.id
     where exists (select 1 from public.user_roles r where r.user_id = u.id
                     and r.role in ('platform_master', 'platform_operator'))
     order by u.email;
end $$;

create or replace function public.admin_set_staff_permission(_user uuid, _permission text, _granted boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  if _user = auth.uid() then
    raise exception 'Não é possível alterar as próprias permissões.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _user and role = 'platform_operator') then
    raise exception 'O usuário precisa ter o papel de operador da plataforma.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.platform_permissions where code = _permission) then
    raise exception 'Permissão desconhecida.' using errcode = 'P0001';
  end if;
  if _granted then
    insert into public.platform_staff_permissions(user_id, permission, granted_by)
    values (_user, _permission, auth.uid()) on conflict do nothing;
  else
    delete from public.platform_staff_permissions where user_id = _user and permission = _permission;
  end if;
  perform private.audit(case when _granted then 'staff_permission.grant' else 'staff_permission.revoke' end,
                        'platform_staff_permissions', _user::text, jsonb_build_object('permission', _permission));
end $$;

-- ---------- auditoria e configurações ----------
create or replace function public.admin_list_audit(_limit int default 50, _before_id bigint default null)
returns table (id bigint, actor_id uuid, actor_email text, action text, entity text, entity_id text,
               details jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('audit.view');
  return query
    select a.id, a.actor_id, u.email::text, a.action, a.entity, a.entity_id, a.details, a.created_at
      from public.audit_logs a left join auth.users u on u.id = a.actor_id
     where _before_id is null or a.id < _before_id
     order by a.id desc
     limit least(greatest(coalesce(_limit, 50), 1), 200);
end $$;

create or replace function public.admin_list_settings()
returns table (key text, value jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query select s.key, s.value, s.updated_at from public.platform_settings s order by s.key;
end $$;

create or replace function public.admin_set_setting(_key text, _value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare before jsonb;
begin
  perform private.require_master();
  if _key = 'require_admin_mfa' and jsonb_typeof(_value) <> 'boolean' then
    raise exception 'Valor deve ser verdadeiro ou falso.' using errcode = 'P0001';
  end if;
  if _key = 'require_admin_mfa' and _value = 'true'::jsonb and private.current_aal() <> 'aal2' then
    -- evita trancar a própria equipe: só quem já está com MFA ativo pode exigir MFA
    raise exception 'Ative e verifique seu próprio MFA antes de exigi-lo da equipe.' using errcode = 'P0001';
  end if;
  if _key = 'max_pending_business_applications'
     and (jsonb_typeof(_value) <> 'number' or (_value::text)::numeric not between 1 and 20) then
    raise exception 'Valor deve ser um número entre 1 e 20.' using errcode = 'P0001';
  end if;
  select value into before from public.platform_settings where key = _key for update;
  if not found then raise exception 'Configuração desconhecida.' using errcode = 'P0001'; end if;
  update public.platform_settings set value = _value, updated_by = auth.uid(), updated_at = now() where key = _key;
  perform private.audit('setting.update', 'platform_settings', _key, jsonb_build_object('before', before, 'after', _value));
end $$;

-- Contexto de acesso para a interface (somente UX; cada função valida de novo no servidor).
create or replace function public.admin_my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_master', public.has_role('platform_master'),
    'is_operator', public.has_role('platform_operator'),
    'mfa_required', coalesce((private.setting('require_admin_mfa'))::text::boolean, false),
    'aal', private.current_aal(),
    'mfa_ok', private.admin_mfa_ok(),
    'permissions', case
      when not private.admin_mfa_ok() then '[]'::jsonb
      when public.has_role('platform_master') then (select coalesce(jsonb_agg(code order by sort_order), '[]'::jsonb) from public.platform_permissions)
      when public.has_role('platform_operator') then (select coalesce(jsonb_agg(permission order by permission), '[]'::jsonb)
                                                       from public.platform_staff_permissions where user_id = auth.uid())
      else '[]'::jsonb end)
$$;

-- ---------- RLS e privilégios ----------
alter table public.platform_settings enable row level security;
alter table public.platform_permissions enable row level security;
alter table public.platform_staff_permissions enable row level security;
-- catálogo de permissões: leitura para quem administra
create policy platform_permissions_select on public.platform_permissions for select to authenticated
  using (public.has_role('platform_master') or public.has_role('platform_operator'));
-- permissões da equipe: o próprio integrante e o Master leem; escrita só por função
create policy platform_staff_permissions_select on public.platform_staff_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_role('platform_master'));
-- platform_settings: sem política (leitura/escrita apenas pelas funções do Master)

revoke all on public.platform_settings, public.platform_permissions, public.platform_staff_permissions
  from public, anon, authenticated;
grant select on public.platform_permissions, public.platform_staff_permissions to authenticated;

-- funções internas: nenhum acesso pela API
revoke all on function private.audit(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.setting(text) from public, anon, authenticated;
revoke all on function private.current_aal() from public, anon, authenticated;
revoke all on function private.admin_mfa_ok() from public, anon, authenticated;
revoke all on function private.is_master_ok() from public, anon, authenticated;
revoke all on function private.require_permission(text) from public, anon, authenticated;
revoke all on function private.require_master() from public, anon, authenticated;
revoke all on function private.slugify(text) from public, anon, authenticated;
revoke all on function private.unique_business_slug(text) from public, anon, authenticated;

-- funções públicas: apenas usuários autenticados (cada uma valida permissão no servidor)
do $$
declare f text;
begin
  foreach f in array array[
    'public.has_platform_permission(text)',
    'public.grant_role(uuid, public.app_role)',
    'public.revoke_role(uuid, public.app_role)',
    'public.submit_business_application(text, public.business_type, uuid, uuid, text, text, text)',
    'public.admin_review_business(uuid, text, text)',
    'public.admin_list_businesses(public.business_status, text, int, int)',
    'public.admin_list_cities()',
    'public.admin_save_city(uuid, text, text, numeric, numeric, boolean)',
    'public.admin_dashboard()',
    'public.admin_find_user(text)',
    'public.admin_list_staff()',
    'public.admin_set_staff_permission(uuid, text, boolean)',
    'public.admin_list_audit(int, bigint)',
    'public.admin_list_settings()',
    'public.admin_set_setting(text, jsonb)',
    'public.admin_my_access()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
