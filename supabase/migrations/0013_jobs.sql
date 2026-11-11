-- 0013_jobs: vagas de emprego publicadas por estabelecimentos ativos e candidaturas.
--  * Publicação e gestão exigem a permissão de empresa jobs.manage (dono e gerente).
--  * Vaga pública só enquanto aberta, dentro da validade e de estabelecimento ativo.
--  * Candidatura única por vaga; a pessoa acompanha o andamento e pode desistir.
--  * Equipe da plataforma com jobs.manage pode encerrar vagas irregulares.
--  * Currículo em texto (sem upload de arquivo: armazenamento de arquivos ainda não contratado).
--  * LGPD: pedidos, entregas e candidaturas entram na exportação; a anonimização apaga contato e endereço.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('job.save', 30, 3600), ('job.apply', 20, 3600), ('job.application_update', 200, 600);

insert into public.permissions(code) values ('jobs.manage') on conflict do nothing;
insert into public.role_permissions(member_role, permission) values ('owner', 'jobs.manage'), ('manager', 'jobs.manage')
  on conflict do nothing;

create type public.job_employment as enum ('clt', 'pj', 'temporario', 'estagio', 'freelancer', 'meio_periodo');
create type public.job_work_mode as enum ('presencial', 'hibrido', 'remoto');
create type public.job_status as enum ('open', 'paused', 'closed');
create type public.job_application_status as enum ('submitted', 'reviewing', 'interview', 'rejected', 'hired', 'withdrawn');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  city_id uuid references public.cities(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  area text not null check (area in ('atendimento', 'cozinha', 'entregas', 'vendas', 'administrativo', 'servicos_gerais', 'tecnologia', 'outros')),
  description text not null check (char_length(btrim(description)) between 20 and 4000),
  requirements text check (requirements is null or char_length(requirements) <= 2000),
  benefits text check (benefits is null or char_length(benefits) <= 1000),
  employment_type public.job_employment not null,
  work_mode public.job_work_mode not null default 'presencial',
  salary_min_cents integer check (salary_min_cents is null or salary_min_cents > 0),
  salary_max_cents integer check (salary_max_cents is null or salary_max_cents > 0),
  openings smallint not null default 1 check (openings between 1 and 100),
  status public.job_status not null default 'open',
  expires_at timestamptz not null default now() + interval '30 days',
  created_by uuid references auth.users(id) on delete set null,
  closed_reason text check (closed_reason is null or char_length(closed_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (salary_max_cents is null or salary_min_cents is null or salary_max_cents >= salary_min_cents)
);
create index jobs_public_idx on public.jobs(city_id, status, created_at desc);
create index jobs_business_idx on public.jobs(business_id, created_at desc);
create index jobs_created_by_idx on public.jobs(created_by);
create trigger jobs_updated before update on public.jobs for each row execute function public.set_updated_at();

create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 3 and 120),
  phone text not null check (phone ~ '^[0-9+() -]{8,20}$'),
  message text check (message is null or char_length(message) <= 1500),
  experience text check (experience is null or char_length(experience) <= 3000),
  status public.job_application_status not null default 'submitted',
  employer_note text check (employer_note is null or char_length(employer_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);
create index job_applications_applicant_idx on public.job_applications(applicant_id, created_at desc);
create trigger job_applications_updated before update on public.job_applications for each row execute function public.set_updated_at();

-- notificações de vagas
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply',
  'order_new', 'order_update', 'delivery_offer', 'job_application', 'job_update'));
alter table public.notifications drop constraint notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or link ~ '^/(conectuai|pedidos|painel|entregador|vagas)/[A-Za-z0-9/_-]*$');

create or replace function public.job_is_public(_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j where j.id = _job and j.status = 'open' and j.expires_at > now()
                   and public.is_active_business(j.business_id))
$$;

-- criar/editar vaga
create or replace function public.save_job(
  _business uuid, _title text, _area text, _description text, _employment public.job_employment,
  _work_mode public.job_work_mode default 'presencial', _requirements text default null, _benefits text default null,
  _salary_min_cents integer default null, _salary_max_cents integer default null, _openings integer default 1,
  _days integer default 30, _job uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b public.businesses%rowtype; jid uuid;
begin
  if not public.has_business_permission(_business, 'jobs.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('job.save');
  select * into b from public.businesses where id = _business;
  if b.status <> 'active' then raise exception 'Só estabelecimentos ativos publicam vagas.' using errcode = 'P0001'; end if;
  if coalesce(_days, 30) not between 1 and 90 then raise exception 'Validade de 1 a 90 dias.' using errcode = 'P0001'; end if;
  if _job is null then
    insert into public.jobs(business_id, city_id, title, area, description, requirements, benefits, employment_type, work_mode,
                            salary_min_cents, salary_max_cents, openings, expires_at, created_by)
    values (b.id, b.city_id, btrim(_title), _area, btrim(_description), nullif(btrim(coalesce(_requirements, '')), ''),
            nullif(btrim(coalesce(_benefits, '')), ''), _employment, coalesce(_work_mode, 'presencial'), _salary_min_cents, _salary_max_cents,
            coalesce(_openings, 1), now() + make_interval(days => coalesce(_days, 30)), auth.uid())
    returning id into jid;
  else
    update public.jobs set title = btrim(_title), area = _area, description = btrim(_description),
           requirements = nullif(btrim(coalesce(_requirements, '')), ''), benefits = nullif(btrim(coalesce(_benefits, '')), ''),
           employment_type = _employment, work_mode = coalesce(_work_mode, 'presencial'),
           salary_min_cents = _salary_min_cents, salary_max_cents = _salary_max_cents, openings = coalesce(_openings, 1),
           expires_at = now() + make_interval(days => coalesce(_days, 30)), city_id = b.city_id
     where id = _job and business_id = b.id and status <> 'closed'
    returning id into jid;
    if jid is null then raise exception 'Vaga não encontrada ou encerrada.' using errcode = 'P0001'; end if;
  end if;
  perform private.audit('job.save', 'jobs', jid::text, jsonb_build_object('business', b.id));
  return jid;
end $$;

create or replace function public.set_job_status(_job uuid, _status public.job_status, _reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs%rowtype; platform boolean;
begin
  select * into j from public.jobs where id = _job;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  platform := public.has_platform_permission('jobs.manage');
  if not public.has_business_permission(j.business_id, 'jobs.manage') and not (platform and _status = 'closed') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.limit_for('job.save');
  if j.status = 'closed' then raise exception 'Vaga encerrada não pode ser reaberta. Publique uma nova.' using errcode = 'P0001'; end if;
  update public.jobs set status = _status, closed_reason = case when _status = 'closed' then nullif(btrim(coalesce(_reason, '')), '') end
   where id = j.id;
  perform private.audit('job.status', 'jobs', j.id::text, jsonb_build_object('status', _status, 'platform', platform));
end $$;

-- candidatar-se
create or replace function public.apply_to_job(_job uuid, _full_name text, _phone text, _message text default null, _experience text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare j public.jobs%rowtype; aid uuid; m uuid;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para se candidatar.' using errcode = '42501'; end if;
  perform private.limit_for('job.apply');
  if not public.job_is_public(_job) then raise exception 'Vaga indisponível.' using errcode = 'P0001'; end if;
  select * into j from public.jobs where id = _job;
  if public.has_business_permission(j.business_id, 'orders.view') then
    raise exception 'A equipe do estabelecimento não pode se candidatar à própria vaga.' using errcode = 'P0001';
  end if;
  insert into public.job_applications(job_id, applicant_id, full_name, phone, message, experience)
  values (_job, auth.uid(), btrim(_full_name), btrim(_phone), nullif(btrim(coalesce(_message, '')), ''), nullif(btrim(coalesce(_experience, '')), ''))
  returning id into aid;
  for m in select bm.user_id from public.business_members bm join public.role_permissions rp on rp.member_role = bm.member_role and rp.permission = 'jobs.manage'
            where bm.business_id = j.business_id loop
    perform private.notify_link(m, 'job_application', null, '/painel/' || j.business_id || '/vagas', 'Nova candidatura para "' || left(j.title, 60) || '".');
  end loop;
  return aid;
exception when unique_violation then
  raise exception 'Você já se candidatou a esta vaga.' using errcode = 'P0001';
end $$;

create or replace function public.withdraw_application(_application uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.job_applications set status = 'withdrawn'
   where id = _application and applicant_id = auth.uid() and status not in ('hired', 'rejected', 'withdrawn');
  if not found then raise exception 'Candidatura não pode ser retirada.' using errcode = 'P0001'; end if;
end $$;

create or replace function public.update_application_status(_application uuid, _status public.job_application_status, _note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.job_applications%rowtype; j public.jobs%rowtype;
begin
  select * into a from public.job_applications where id = _application;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into j from public.jobs where id = a.job_id;
  if not public.has_business_permission(j.business_id, 'jobs.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('job.application_update');
  if _status in ('submitted', 'withdrawn') then raise exception 'Status inválido.' using errcode = 'P0001'; end if;
  if a.status = 'withdrawn' then raise exception 'A pessoa retirou a candidatura.' using errcode = 'P0001'; end if;
  update public.job_applications set status = _status, employer_note = nullif(btrim(coalesce(_note, '')), '') where id = a.id;
  perform private.notify_link(a.applicant_id, 'job_update', null, '/vagas/' || j.id,
    'Sua candidatura para "' || left(j.title, 60) || '": ' || case _status
      when 'reviewing' then 'em análise.' when 'interview' then 'chamada para entrevista.'
      when 'rejected' then 'não seguiu no processo.' when 'hired' then 'aprovada!' else _status::text end);
end $$;

-- ---------- RLS ----------
alter table public.jobs enable row level security;
alter table public.job_applications enable row level security;
create policy jobs_select_public on public.jobs for select to anon using (public.job_is_public(id));
create policy jobs_select on public.jobs for select to authenticated
  using (public.job_is_public(id) or public.has_business_permission(business_id, 'jobs.manage') or public.has_platform_permission('jobs.manage'));
create policy job_applications_select on public.job_applications for select to authenticated
  using (applicant_id = (select auth.uid())
         or exists (select 1 from public.jobs j where j.id = job_id and public.has_business_permission(j.business_id, 'jobs.manage')));
revoke all on public.jobs, public.job_applications from public, anon, authenticated;
grant select on public.jobs to anon, authenticated;
grant select on public.job_applications to authenticated;

-- ---------- LGPD ----------
create or replace function private.commerce_export(_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'status', o.status, 'created_at', o.created_at,
                          'total_cents', o.total_cents, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
                          'delivery_address', o.delivery_address,
                          'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.quantity)) from public.order_items i where i.order_id = o.id))
                          order by o.created_at) from public.orders o where o.customer_id = _uid), '[]'::jsonb),
    'deliveries_made', (select count(*) from public.deliveries d where d.courier_id = _uid and d.status = 'delivered'),
    'job_applications', coalesce((select jsonb_agg(jsonb_build_object('job', j.title, 'status', a.status, 'created_at', a.created_at,
                          'full_name', a.full_name, 'phone', a.phone, 'message', a.message, 'experience', a.experience))
                          from public.job_applications a join public.jobs j on j.id = a.job_id where a.applicant_id = _uid), '[]'::jsonb))
$$;
revoke all on function private.commerce_export(uuid) from public, anon, authenticated;

do $$
declare src text;
begin
  select pg_get_functiondef('public.my_data_export()'::regprocedure) into src;
  if strpos(src, '''notes'', jsonb_build_array(') = 0 then raise exception 'my_data_export: ponto de extensão não encontrado'; end if;
  src := replace(src, '''notes'', jsonb_build_array(', '''commerce'', private.commerce_export(uid),
    ''notes'', jsonb_build_array(');
  execute src;

  select pg_get_functiondef('private.anonymize_user(uuid)'::regprocedure) into src;
  if strpos(src, 'delete from public.notifications where user_id = _user;') = 0 then raise exception 'anonymize_user: ponto de extensão não encontrado'; end if;
  src := replace(src, 'delete from public.notifications where user_id = _user;', 'delete from public.notifications where user_id = _user;
  -- pedidos ficam para a contabilidade do estabelecimento, sem dados pessoais
  update public.orders set customer_name = ''Cliente removido'', customer_phone = ''00000000'', notes = null,
         delivery_address = case when delivery_address is null then null else ''Endereço removido'' end, delivery_reference = null
   where customer_id = _user;
  delete from public.job_applications where applicant_id = _user;');
  execute src;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.job_is_public(uuid)',
    'public.save_job(uuid, text, text, text, public.job_employment, public.job_work_mode, text, text, integer, integer, integer, integer, uuid)',
    'public.set_job_status(uuid, public.job_status, text)',
    'public.apply_to_job(uuid, text, text, text, text)', 'public.withdraw_application(uuid)',
    'public.update_application_status(uuid, public.job_application_status, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  grant execute on function public.job_is_public(uuid) to anon;
end $$;
