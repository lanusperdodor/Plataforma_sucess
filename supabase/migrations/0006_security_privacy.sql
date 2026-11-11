-- 0006_security_privacy: controles fundamentais de segurança e LGPD.
--  * MFA obrigatório para a equipe administrativa por padrão (o Master cadastra o TOTP em
--    /admin/seguranca antes de qualquer outra ação; o cadastro do fator não depende do painel).
--  * Rate limiting no servidor (janela fixa, atômico) aplicado às RPCs sensíveis.
--    Excesso responde SQLSTATE PT429 -> HTTP 429 no PostgREST.
--  * URLs de imagem só https (bloqueia javascript:, data:, http:).
--  * Direitos do titular: solicitações registradas, exportação dos próprios dados,
--    anonimização controlada pelo Master/operador com permissão privacy.manage.

-- ---------- MFA obrigatório por padrão ----------
update public.platform_settings set value = 'true'::jsonb, updated_at = now() where key = 'require_admin_mfa';

-- ---------- rate limiting ----------
create table private.rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (bucket, subject)
);
revoke all on private.rate_limits from public, anon, authenticated;

-- Conta uma ocorrência e recusa acima do limite. O sujeito é o usuário autenticado.
create or replace function private.rate_limit(_bucket text, _max integer, _window_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  who text := coalesce(auth.uid()::text, 'anon');
  n integer;
begin
  insert into private.rate_limits as r (bucket, subject, window_start, hits)
  values (_bucket, who, now(), 1)
  on conflict (bucket, subject) do update
    set hits = case when r.window_start < now() - make_interval(secs => _window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => _window_seconds) then now() else r.window_start end
  returning hits into n;
  if n > _max then
    raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
      using errcode = 'PT429';
  end if;
end $$;
revoke all on function private.rate_limit(text, integer, integer) from public, anon, authenticated;

-- Limpeza de janelas antigas (pode ser agendada com pg_cron quando disponível).
create or replace function private.purge_rate_limits() returns integer
language sql security definer set search_path = '' as $$
  with d as (delete from private.rate_limits where window_start < now() - interval '1 day' returning 1)
  select count(*)::int from d
$$;
revoke all on function private.purge_rate_limits() from public, anon, authenticated;

-- Os limites ficam em um único lugar (proporcionais ao uso legítimo).
create or replace function private.limit_for(_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  case _action
    when 'business.submit'      then perform private.rate_limit(_action, 5, 3600);
    when 'admin.review'         then perform private.rate_limit(_action, 120, 600);
    when 'admin.city'           then perform private.rate_limit(_action, 60, 600);
    when 'admin.staff'          then perform private.rate_limit(_action, 60, 600);
    when 'admin.role'           then perform private.rate_limit(_action, 30, 600);
    when 'admin.setting'        then perform private.rate_limit(_action, 30, 600);
    when 'admin.privacy'        then perform private.rate_limit(_action, 60, 600);
    when 'privacy.request'      then perform private.rate_limit(_action, 5, 86400);
    when 'privacy.export'       then perform private.rate_limit(_action, 10, 3600);
    else raise exception 'rate limit não configurado: %', _action;
  end case;
end $$;
revoke all on function private.limit_for(text) from public, anon, authenticated;

-- submit_business_application é recriada com o limite (e sem o nome do negócio na auditoria).

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
  perform private.limit_for('business.submit');
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
                        jsonb_build_object('type', _business_type));
  return new_id;
end $$;

-- Os wrappers abaixo preservam a lógica da 0005 renomeando-a para private.*_impl e
-- expondo a versão pública com autorização + limite. Assim a regra de negócio não é duplicada.
alter function public.admin_review_business(uuid, text, text) set schema private;
alter function private.admin_review_business(uuid, text, text) rename to admin_review_business_impl;
create function public.admin_review_business(_business uuid, _decision text, _note text default null)
returns public.business_status language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('businesses.review');
  perform private.limit_for('admin.review');
  return private.admin_review_business_impl(_business, _decision, _note);
end $$;

alter function public.admin_save_city(uuid, text, text, numeric, numeric, boolean) set schema private;
alter function private.admin_save_city(uuid, text, text, numeric, numeric, boolean) rename to admin_save_city_impl;
create function public.admin_save_city(
  _id uuid, _name text, _state text, _center_lat numeric default null, _center_lng numeric default null,
  _is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('cities.manage');
  perform private.limit_for('admin.city');
  return private.admin_save_city_impl(_id, _name, _state, _center_lat, _center_lng, _is_active);
end $$;

alter function public.admin_set_staff_permission(uuid, text, boolean) set schema private;
alter function private.admin_set_staff_permission(uuid, text, boolean) rename to admin_set_staff_permission_impl;
create function public.admin_set_staff_permission(_user uuid, _permission text, _granted boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.staff');
  perform private.admin_set_staff_permission_impl(_user, _permission, _granted);
end $$;

alter function public.grant_role(uuid, public.app_role) set schema private;
alter function private.grant_role(uuid, public.app_role) rename to grant_role_impl;
create function public.grant_role(_user uuid, _role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.role');
  perform private.grant_role_impl(_user, _role);
end $$;

alter function public.revoke_role(uuid, public.app_role) set schema private;
alter function private.revoke_role(uuid, public.app_role) rename to revoke_role_impl;
create function public.revoke_role(_user uuid, _role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.role');
  perform private.revoke_role_impl(_user, _role);
end $$;

alter function public.admin_set_setting(text, jsonb) set schema private;
alter function private.admin_set_setting(text, jsonb) rename to admin_set_setting_impl;
create function public.admin_set_setting(_key text, _value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.setting');
  perform private.admin_set_setting_impl(_key, _value);
end $$;

-- ---------- URLs de imagem: somente https ----------
-- NOT VALID: vale para gravações novas sem falhar por linhas antigas; validar depois com
-- "alter table ... validate constraint ..." após conferir os dados remotos.
alter table public.businesses
  add constraint businesses_cover_url_https check (cover_url is null or cover_url ~ '^https://[^\s<>"'']+$') not valid,
  add constraint businesses_logo_url_https check (logo_url is null or logo_url ~ '^https://[^\s<>"'']+$') not valid;
alter table public.products
  add constraint products_image_url_https check (image_url is null or image_url ~ '^https://[^\s<>"'']+$') not valid;

-- ---------- LGPD: solicitações do titular ----------
insert into public.platform_permissions(code, description, sort_order) values
  ('privacy.manage', 'Atender solicitações de privacidade (LGPD)', 55);

create type public.privacy_request_kind as enum
  ('access', 'correction', 'portability', 'deletion', 'sharing_info', 'consent_revocation', 'objection');
create type public.privacy_request_status as enum ('open', 'in_progress', 'completed', 'rejected');

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  -- set null: o registro do atendimento é preservado mesmo após a exclusão da conta
  user_id uuid references auth.users(id) on delete set null,
  kind public.privacy_request_kind not null,
  details text check (details is null or char_length(details) <= 2000),
  status public.privacy_request_status not null default 'open',
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index privacy_requests_user_idx on public.privacy_requests(user_id, created_at desc);
create index privacy_requests_status_idx on public.privacy_requests(status, created_at);
create index privacy_requests_resolved_by_idx on public.privacy_requests(resolved_by);

alter table public.privacy_requests enable row level security;
create policy privacy_requests_select on public.privacy_requests for select to authenticated
  using (user_id = auth.uid() or public.has_platform_permission('privacy.manage'));
revoke all on public.privacy_requests from public, anon, authenticated;
grant select on public.privacy_requests to authenticated;

create or replace function public.submit_privacy_request(_kind public.privacy_request_kind, _details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('privacy.request');
  if char_length(coalesce(_details, '')) > 2000 then
    raise exception 'Texto muito longo (máximo 2000 caracteres).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.privacy_requests where user_id = uid and kind = _kind and status in ('open', 'in_progress')) then
    raise exception 'Você já tem uma solicitação deste tipo em andamento.' using errcode = 'P0001';
  end if;
  insert into public.privacy_requests(user_id, kind, details)
  values (uid, _kind, nullif(btrim(coalesce(_details, '')), ''))
  returning id into new_id;
  -- auditoria sem o texto livre (pode conter dados pessoais)
  perform private.audit('privacy.request', 'privacy_requests', new_id::text, jsonb_build_object('kind', _kind));
  return new_id;
end $$;

-- Portabilidade/acesso: tudo o que a plataforma guarda sobre o próprio usuário.
create or replace function public.my_data_export() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('privacy.export');
  return jsonb_build_object(
    'generated_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email) from auth.users u where u.id = uid),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.role, 'since', r.created_at)) from public.user_roles r where r.user_id = uid), '[]'::jsonb),
    'business_memberships', coalesce((select jsonb_agg(jsonb_build_object('business', b.name, 'role', m.member_role, 'since', m.created_at))
                                       from public.business_members m join public.businesses b on b.id = m.business_id
                                      where m.user_id = uid), '[]'::jsonb),
    'businesses_owned', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'status', b.status, 'phone', b.phone,
                                                                      'address_line', b.address_line, 'submitted_at', b.submitted_at))
                                   from public.businesses b where b.owner_id = uid), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('rating', v.rating, 'comment', v.comment, 'created_at', v.created_at))
                          from public.reviews v where v.user_id = uid), '[]'::jsonb),
    'privacy_requests', coalesce((select jsonb_agg(jsonb_build_object('kind', q.kind, 'status', q.status, 'created_at', q.created_at,
                                                                      'resolved_at', q.resolved_at, 'resolution_note', q.resolution_note))
                                   from public.privacy_requests q where q.user_id = uid), '[]'::jsonb),
    'notes', jsonb_build_array(
      'Senha: guardada apenas como hash pelo Supabase Auth; nunca é exportada.',
      'Registros de auditoria e dados fiscais/financeiros podem ser mantidos pelo prazo legal.'));
end $$;

-- Anonimização: remove dados pessoais do perfil sem apagar registros comerciais/fiscais.
-- A exclusão definitiva da conta de login (auth.users) é feita pelo painel do Supabase
-- (Authentication -> Users), seguindo o procedimento documentado em docs/LGPD.md.
create or replace function private.anonymize_user(_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set full_name = null, phone = null, preferred_city_id = null where id = _user;
  update public.reviews set author_name = null where user_id = _user;
end $$;
revoke all on function private.anonymize_user(uuid) from public, anon, authenticated;

create or replace function public.admin_list_privacy_requests(_status public.privacy_request_status default null)
returns table (id uuid, user_id uuid, user_email text, kind public.privacy_request_kind, details text,
               status public.privacy_request_status, resolution_note text, resolved_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('privacy.manage');
  return query
    select q.id, q.user_id, u.email::text, q.kind, q.details, q.status, q.resolution_note, q.resolved_at, q.created_at
      from public.privacy_requests q left join auth.users u on u.id = q.user_id
     where _status is null or q.status = _status
     order by q.created_at
     limit 200;
end $$;

create or replace function public.admin_resolve_privacy_request(
  _request uuid, _status public.privacy_request_status, _note text, _anonymize boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare q public.privacy_requests%rowtype; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('privacy.manage');
  perform private.limit_for('admin.privacy');
  select * into q from public.privacy_requests where id = _request for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  if q.status in ('completed', 'rejected') then
    raise exception 'Solicitação já encerrada.' using errcode = 'P0001';
  end if;
  if _status = 'open' then raise exception 'Status inválido.' using errcode = 'P0001'; end if;
  if _status in ('completed', 'rejected') and note is null then
    raise exception 'Registre o resultado do atendimento.' using errcode = 'P0001';
  end if;
  if _anonymize then
    -- confirmação explícita e restrita a pedidos de exclusão concluídos
    if q.kind <> 'deletion' or _status <> 'completed' or q.user_id is null then
      raise exception 'Anonimização só ao concluir um pedido de exclusão.' using errcode = 'P0001';
    end if;
    if q.user_id = auth.uid() then
      raise exception 'Você não pode atender a própria solicitação.' using errcode = '42501';
    end if;
    perform private.anonymize_user(q.user_id);
  end if;
  update public.privacy_requests
     set status = _status, resolution_note = note,
         resolved_by = case when _status in ('completed', 'rejected') then auth.uid() end,
         resolved_at = case when _status in ('completed', 'rejected') then now() end
   where id = q.id;
  perform private.audit('privacy.' || _status::text, 'privacy_requests', q.id::text,
                        jsonb_build_object('kind', q.kind, 'anonymized', coalesce(_anonymize, false)));
end $$;

-- ---------- privilégios ----------
do $$
declare f text;
begin
  foreach f in array array[
    'private.admin_review_business_impl(uuid, text, text)',
    'private.admin_save_city_impl(uuid, text, text, numeric, numeric, boolean)',
    'private.admin_set_staff_permission_impl(uuid, text, boolean)',
    'private.grant_role_impl(uuid, public.app_role)',
    'private.revoke_role_impl(uuid, public.app_role)',
    'private.admin_set_setting_impl(text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.submit_business_application(text, public.business_type, uuid, uuid, text, text, text)',
    'public.admin_review_business(uuid, text, text)',
    'public.admin_save_city(uuid, text, text, numeric, numeric, boolean)',
    'public.admin_set_staff_permission(uuid, text, boolean)',
    'public.grant_role(uuid, public.app_role)',
    'public.revoke_role(uuid, public.app_role)',
    'public.admin_set_setting(text, jsonb)',
    'public.submit_privacy_request(public.privacy_request_kind, text)',
    'public.my_data_export()',
    'public.admin_list_privacy_requests(public.privacy_request_status)',
    'public.admin_resolve_privacy_request(uuid, public.privacy_request_status, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
