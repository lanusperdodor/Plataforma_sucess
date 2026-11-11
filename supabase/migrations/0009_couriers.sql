-- 0009_couriers: cadastro de entregadores parceiros (independentes) e análise pela equipe.
--  * Minimização (LGPD): só o necessário para analisar e contatar; documentos ficam para o
--    envio por Storage com política própria (ainda não disponível).
--  * Aprovação concede o papel courier_partner; suspensão o remove.
--  * Limites de uso passam a ser uma tabela (cada módulo inclui os seus sem reescrever a função).

-- ---------- limites de uso: regras em tabela ----------
create table private.rate_limit_rules (
  action text primary key,
  max_hits integer not null check (max_hits > 0),
  window_seconds integer not null check (window_seconds > 0)
);
revoke all on private.rate_limit_rules from public, anon, authenticated;
insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('business.submit', 5, 3600), ('admin.review', 120, 600), ('admin.city', 60, 600), ('admin.staff', 60, 600),
  ('admin.role', 30, 600), ('admin.setting', 30, 600), ('admin.privacy', 60, 600), ('privacy.request', 5, 86400),
  ('privacy.export', 10, 3600), ('conecta.post', 10, 600), ('conecta.comment', 30, 600), ('conecta.like', 200, 600),
  ('conecta.follow', 60, 600), ('conecta.report', 20, 86400), ('conecta.appeal', 5, 86400), ('admin.moderation', 300, 600),
  ('courier.submit', 5, 86400), ('courier.online', 60, 600), ('admin.courier', 120, 600);

create or replace function private.limit_for(_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare r private.rate_limit_rules%rowtype;
begin
  select * into r from private.rate_limit_rules where action = _action;
  if not found then raise exception 'rate limit não configurado: %', _action; end if;
  perform private.rate_limit(_action, r.max_hits, r.window_seconds);
end $$;
revoke all on function private.limit_for(text) from public, anon, authenticated;

-- ---------- entregadores ----------
create type public.courier_vehicle as enum ('moto', 'bicicleta', 'carro', 'a_pe');
create type public.courier_status as enum ('pending', 'approved', 'rejected', 'suspended');

create table public.couriers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 3 and 120),
  phone text not null check (phone ~ '^[0-9+() -]{8,20}$'),
  city_id uuid not null references public.cities(id),
  vehicle public.courier_vehicle not null,
  -- placa e CNH só para veículos motorizados
  vehicle_plate text check (vehicle_plate is null or vehicle_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  cnh_category text check (cnh_category is null or cnh_category in ('A', 'B', 'AB', 'AC', 'AD', 'AE')),
  status public.courier_status not null default 'pending',
  is_online boolean not null default false,
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((vehicle in ('moto', 'carro')) = (vehicle_plate is not null and cnh_category is not null)),
  check (not is_online or status = 'approved')
);
create index couriers_city_status_idx on public.couriers(city_id, status, is_online);
create index couriers_reviewed_by_idx on public.couriers(reviewed_by);
create trigger couriers_updated before update on public.couriers
  for each row execute function public.set_updated_at();

alter table public.couriers enable row level security;
create policy couriers_select_own on public.couriers for select to authenticated
  using (user_id = (select auth.uid()));
-- escrita só por funções
revoke all on public.couriers from public, anon, authenticated;
grant select on public.couriers to authenticated;

-- Versão vigente dos termos de parceria (texto em /termos, sujeito a revisão jurídica).
create or replace function private.courier_terms_version() returns text
language sql immutable set search_path = '' as $$ select '2026-11-11' $$;
revoke all on function private.courier_terms_version() from public, anon, authenticated;

create or replace function public.submit_courier_application(
  _full_name text, _phone text, _city_id uuid, _vehicle public.courier_vehicle,
  _vehicle_plate text default null, _cnh_category text default null, _accept_terms boolean default false
) returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  plate text := nullif(upper(regexp_replace(coalesce(_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g')), '');
  cnh text := nullif(upper(btrim(coalesce(_cnh_category, ''))), '');
  current_status public.courier_status;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.submit');
  if not coalesce(_accept_terms, false) then
    raise exception 'É preciso aceitar os termos de parceria.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cities where id = _city_id and is_active and not is_demo) then
    raise exception 'Cidade indisponível.' using errcode = 'P0001';
  end if;
  if _vehicle in ('bicicleta', 'a_pe') then plate := null; cnh := null; end if;
  if _vehicle in ('moto', 'carro') and (plate is null or cnh is null) then
    raise exception 'Informe a placa e a categoria da CNH.' using errcode = 'P0001';
  end if;
  select status into current_status from public.couriers where user_id = uid for update;
  if current_status in ('approved', 'suspended') then
    raise exception 'Seu cadastro já foi analisado. Fale com o suporte para alterar dados.' using errcode = 'P0001';
  end if;
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category,
                              status, terms_version, terms_accepted_at, submitted_at, review_note, reviewed_by, reviewed_at)
  values (uid, btrim(_full_name), btrim(_phone), _city_id, _vehicle, plate, cnh, 'pending',
          private.courier_terms_version(), now(), now(), null, null, null)
  on conflict (user_id) do update set
    full_name = excluded.full_name, phone = excluded.phone, city_id = excluded.city_id, vehicle = excluded.vehicle,
    vehicle_plate = excluded.vehicle_plate, cnh_category = excluded.cnh_category, status = 'pending',
    terms_version = excluded.terms_version, terms_accepted_at = excluded.terms_accepted_at,
    submitted_at = now(), review_note = null, reviewed_by = null, reviewed_at = null;
  perform private.audit('courier.submit', 'couriers', uid::text, jsonb_build_object('vehicle', _vehicle));
  return 'pending';
end $$;

create or replace function public.set_courier_online(_online boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.online');
  update public.couriers set is_online = coalesce(_online, false) where user_id = uid and status = 'approved';
  if not found then raise exception 'Seu cadastro de entregador ainda não está aprovado.' using errcode = 'P0001'; end if;
  return coalesce(_online, false);
end $$;

-- ---------- análise pela equipe (couriers.review + MFA) ----------
create or replace function public.admin_list_couriers(_status public.courier_status default 'pending')
returns table (user_id uuid, email text, full_name text, phone text, city_name text, vehicle public.courier_vehicle,
               vehicle_plate text, cnh_category text, status public.courier_status, is_online boolean,
               review_note text, submitted_at timestamptz, reviewed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('couriers.review');
  return query
    select c.user_id, u.email::text, c.full_name, c.phone, ci.name, c.vehicle, c.vehicle_plate, c.cnh_category,
           c.status, c.is_online, c.review_note, c.submitted_at, c.reviewed_at
      from public.couriers c
      left join auth.users u on u.id = c.user_id
      left join public.cities ci on ci.id = c.city_id
     where _status is null or c.status = _status
     order by c.submitted_at
     limit 200;
end $$;

-- approve: pending|rejected -> approved · reject: pending -> rejected (motivo)
-- suspend: approved -> suspended (motivo) · reactivate: suspended -> approved
create or replace function public.admin_review_courier(_user uuid, _decision text, _note text default null)
returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype; next_status public.courier_status; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('couriers.review');
  perform private.limit_for('admin.courier');
  if _user = auth.uid() then raise exception 'Você não pode analisar o próprio cadastro.' using errcode = '42501'; end if;
  select * into c from public.couriers where user_id = _user for update;
  if not found then raise exception 'Cadastro não encontrado.' using errcode = 'P0001'; end if;
  next_status := case
    when _decision = 'approve' and c.status::text in ('pending', 'rejected') then 'approved'
    when _decision = 'reject' and c.status = 'pending' then 'rejected'
    when _decision = 'suspend' and c.status = 'approved' then 'suspended'
    when _decision = 'reactivate' and c.status = 'suspended' then 'approved'
  end;
  if next_status is null then
    raise exception 'Transição inválida: % a partir de %.', _decision, c.status using errcode = 'P0001';
  end if;
  if _decision in ('reject', 'suspend') and note is null then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  update public.couriers
     set status = next_status, review_note = note, reviewed_by = auth.uid(), reviewed_at = now(),
         is_online = case when next_status = 'approved' then is_online else false end
   where user_id = _user;
  if next_status = 'approved' then
    insert into public.user_roles(user_id, role, granted_by) values (_user, 'courier_partner', auth.uid()) on conflict do nothing;
  else
    delete from public.user_roles where user_id = _user and role = 'courier_partner';
  end if;
  perform private.audit('courier.' || _decision, 'couriers', _user::text, jsonb_build_object('from', c.status, 'to', next_status, 'note', note));
  return next_status;
end $$;

-- ---------- privilégios ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.submit_courier_application(text, text, uuid, public.courier_vehicle, text, text, boolean)',
    'public.set_courier_online(boolean)',
    'public.admin_list_couriers(public.courier_status)',
    'public.admin_review_courier(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
