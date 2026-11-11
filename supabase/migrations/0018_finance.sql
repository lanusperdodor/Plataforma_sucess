-- 0018_finance: financeiro do Painel Master (controle manual: não há cobrança online contratada).
--  * Planos aprovados (REGRAS_COMERCIAIS.md): Delivery R$ 79/mês; Presencial + Delivery R$ 99/mês.
--  * Assinatura por estabelecimento: plano, valor contratado (snapshot), início e vencimento.
--  * Cobranças (mensalidade, comissão dos pedidos ou outra): abertas, pagas ou canceladas.
--    "Recebido" = cobranças pagas; "a receber" = abertas; "vencido" = abertas com vencimento passado.
--  * Comissão e taxas da plataforma vêm dos pedidos concluídos (valores gravados no pedido).
--  * Ler: permissão finance.view (Master tem todas). Alterar: só Master. Tudo auditado.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.finance', 200, 600);

create table public.plans (
  code text primary key check (code ~ '^[a-z_]{3,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  price_cents integer not null check (price_cents > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0
);
insert into public.plans(code, name, price_cents, sort_order) values
  ('delivery', 'Delivery', 7900, 10),
  ('presencial_delivery', 'Presencial + Delivery', 9900, 20);

create type public.subscription_status as enum ('active', 'canceled');
create type public.charge_kind as enum ('plano', 'comissao', 'outro');
create type public.charge_status as enum ('aberta', 'paga', 'cancelada');

create table public.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan_code text not null references public.plans(code),
  price_cents integer not null check (price_cents >= 0),
  status public.subscription_status not null default 'active',
  started_on date not null default current_date,
  current_period_end date not null,
  notes text check (notes is null or char_length(notes) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end >= started_on)
);
-- uma assinatura ativa por estabelecimento
create unique index business_subscriptions_active_idx on public.business_subscriptions(business_id) where status = 'active';
create index business_subscriptions_business_idx on public.business_subscriptions(business_id);
create index business_subscriptions_plan_idx on public.business_subscriptions(plan_code);
create index business_subscriptions_created_by_idx on public.business_subscriptions(created_by);
create trigger business_subscriptions_updated before update on public.business_subscriptions for each row execute function public.set_updated_at();

create table public.platform_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subscription_id uuid references public.business_subscriptions(id) on delete set null,
  kind public.charge_kind not null,
  description text not null check (char_length(description) between 2 and 200),
  amount_cents integer not null check (amount_cents > 0),
  due_on date not null,
  -- mês de referência da comissão (evita cobrar o mesmo mês duas vezes)
  reference_month date check (reference_month is null or reference_month = date_trunc('month', reference_month)::date),
  status public.charge_status not null default 'aberta',
  paid_at timestamptz,
  paid_method text check (paid_method is null or paid_method in ('pix', 'dinheiro', 'cartao', 'boleto', 'transferencia', 'outro')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paga') = (paid_at is not null))
);
create unique index platform_charges_commission_month_idx on public.platform_charges(business_id, reference_month) where kind = 'comissao' and status <> 'cancelada';
create index platform_charges_business_idx on public.platform_charges(business_id, status);
create index platform_charges_subscription_idx on public.platform_charges(subscription_id);
create index platform_charges_created_by_idx on public.platform_charges(created_by);
create index platform_charges_status_due_idx on public.platform_charges(status, due_on);
create trigger platform_charges_updated before update on public.platform_charges for each row execute function public.set_updated_at();

alter table public.plans enable row level security;
alter table public.business_subscriptions enable row level security;
alter table public.platform_charges enable row level security;
-- planos: catálogo público (aparece na contratação); demais só pelas funções
create policy plans_select on public.plans for select to anon, authenticated using (is_active);
revoke all on public.plans, public.business_subscriptions, public.platform_charges from public, anon, authenticated;
grant select on public.plans to anon, authenticated;
-- o estabelecimento vê o próprio plano e as próprias cobranças
create policy business_subscriptions_member on public.business_subscriptions for select to authenticated
  using (public.has_business_permission(business_id, 'settings.manage') or public.has_business_permission(business_id, 'reports.view'));
create policy platform_charges_member on public.platform_charges for select to authenticated
  using (public.has_business_permission(business_id, 'settings.manage') or public.has_business_permission(business_id, 'reports.view'));
grant select on public.business_subscriptions, public.platform_charges to authenticated;

-- comissão + taxas de plataforma dos pedidos concluídos num período
create or replace function private.platform_fees(_business uuid, _from timestamptz, _to timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(o.commission_cents + o.platform_delivery_fee_cents), 0)::int
    from public.orders o
   where (_business is null or o.business_id = _business) and o.status in ('delivered', 'picked_up')
     and o.updated_at >= _from and o.updated_at < _to
$$;
revoke all on function private.platform_fees(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.admin_finance_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  perform private.require_permission('finance.view');
  return jsonb_build_object(
    'active_businesses', (select count(*) from public.businesses where status = 'active' and not is_demo),
    'active_subscriptions', (select count(*) from public.business_subscriptions s join public.businesses b on b.id = s.business_id where s.status = 'active' and b.status = 'active'),
    'mrr_cents', coalesce((select sum(s.price_cents) from public.business_subscriptions s join public.businesses b on b.id = s.business_id where s.status = 'active' and b.status = 'active'), 0),
    'received_month_cents', coalesce((select sum(amount_cents) from public.platform_charges where status = 'paga' and paid_at >= m), 0),
    'received_total_cents', coalesce((select sum(amount_cents) from public.platform_charges where status = 'paga'), 0),
    'open_cents', coalesce((select sum(amount_cents) from public.platform_charges where status = 'aberta'), 0),
    'overdue_cents', coalesce((select sum(amount_cents) from public.platform_charges where status = 'aberta' and due_on < current_date), 0),
    'fees_month_cents', private.platform_fees(null, m, now() + interval '1 second'),
    'due_soon', (select count(*) from public.business_subscriptions where status = 'active' and current_period_end <= current_date + 7)
  );
end $$;

create or replace function public.admin_finance_businesses()
returns table (business_id uuid, name text, slug text, business_type public.business_type, status public.business_status,
               city text, owner_name text, contact_phone text, whatsapp text,
               subscription_id uuid, plan_code text, plan_name text, price_cents integer, started_on date, current_period_end date,
               open_cents integer, overdue_cents integer, last_paid_at timestamptz, fees_month_cents integer)
language plpgsql stable security definer set search_path = '' as $$
declare m timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  perform private.require_permission('finance.view');
  return query
    select b.id, b.name, b.slug, b.business_type, b.status,
           case when c.id is null then null else c.name || ' - ' || c.state end,
           p.full_name, coalesce(b.phone, p.phone), coalesce(b.whatsapp, b.phone, p.phone),
           s.id, s.plan_code, pl.name, s.price_cents, s.started_on, s.current_period_end,
           coalesce((select sum(ch.amount_cents)::int from public.platform_charges ch where ch.business_id = b.id and ch.status = 'aberta'), 0),
           coalesce((select sum(ch.amount_cents)::int from public.platform_charges ch where ch.business_id = b.id and ch.status = 'aberta' and ch.due_on < current_date), 0),
           (select max(ch.paid_at) from public.platform_charges ch where ch.business_id = b.id and ch.status = 'paga'),
           private.platform_fees(b.id, m, now() + interval '1 second')
      from public.businesses b
      left join public.cities c on c.id = b.city_id
      left join public.profiles p on p.id = b.owner_id
      left join public.business_subscriptions s on s.business_id = b.id and s.status = 'active'
      left join public.plans pl on pl.code = s.plan_code
     where not b.is_demo and b.status in ('active', 'suspended')
     order by s.current_period_end nulls first, b.name;
end $$;

create or replace function public.admin_list_charges(_status public.charge_status default null, _business uuid default null)
returns table (id uuid, business_id uuid, business_name text, kind public.charge_kind, description text, amount_cents integer,
               due_on date, reference_month date, status public.charge_status, paid_at timestamptz, paid_method text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  return query
    select ch.id, ch.business_id, b.name, ch.kind, ch.description, ch.amount_cents, ch.due_on, ch.reference_month, ch.status,
           ch.paid_at, ch.paid_method, ch.created_at
      from public.platform_charges ch join public.businesses b on b.id = ch.business_id
     where (_status is null or ch.status = _status) and (_business is null or ch.business_id = _business)
     order by (ch.status = 'aberta') desc, ch.due_on, ch.created_at desc
     limit 300;
end $$;

-- definir/trocar plano (encerra o anterior)
create or replace function public.admin_set_subscription(_business uuid, _plan text, _started_on date, _period_end date, _price_cents integer default null, _notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pl public.plans%rowtype; sid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  select * into pl from public.plans where code = _plan and is_active;
  if not found then raise exception 'Plano inválido.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.businesses where id = _business and not is_demo) then raise exception 'Estabelecimento não encontrado.' using errcode = 'P0001'; end if;
  if _period_end < _started_on then raise exception 'O vencimento não pode ser antes do início.' using errcode = 'P0001'; end if;
  update public.business_subscriptions set status = 'canceled' where business_id = _business and status = 'active';
  insert into public.business_subscriptions(business_id, plan_code, price_cents, started_on, current_period_end, notes, created_by)
  values (_business, pl.code, coalesce(_price_cents, pl.price_cents), _started_on, _period_end, nullif(btrim(coalesce(_notes, '')), ''), auth.uid())
  returning id into sid;
  perform private.audit('finance.subscription', 'business_subscriptions', sid::text, jsonb_build_object('business', _business, 'plan', pl.code, 'until', _period_end));
  return sid;
end $$;

create or replace function public.admin_cancel_subscription(_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  update public.business_subscriptions set status = 'canceled' where business_id = _business and status = 'active';
  if not found then raise exception 'Sem plano ativo.' using errcode = 'P0001'; end if;
  perform private.audit('finance.subscription_cancel', 'businesses', _business::text, '{}'::jsonb);
end $$;

-- cobrança da mensalidade do próximo período (vence no fim do período atual)
create or replace function public.admin_charge_subscription(_business uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.business_subscriptions%rowtype; pl public.plans%rowtype; cid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  select * into s from public.business_subscriptions where business_id = _business and status = 'active';
  if not found then raise exception 'Defina o plano antes de cobrar.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.platform_charges where subscription_id = s.id and kind = 'plano' and status = 'aberta') then
    raise exception 'Já existe mensalidade em aberto para este plano.' using errcode = 'P0001';
  end if;
  select * into pl from public.plans where code = s.plan_code;
  insert into public.platform_charges(business_id, subscription_id, kind, description, amount_cents, due_on, created_by)
  values (_business, s.id, 'plano', 'Mensalidade ' || pl.name || ' até ' || to_char((s.current_period_end + interval '1 month')::date, 'DD/MM/YYYY'),
          s.price_cents, s.current_period_end, auth.uid())
  returning id into cid;
  perform private.audit('finance.charge', 'platform_charges', cid::text, jsonb_build_object('kind', 'plano'));
  return cid;
end $$;

-- comissão e taxas de plataforma de um mês fechado (pedidos concluídos)
create or replace function public.admin_charge_commission(_business uuid, _month date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ref date := date_trunc('month', _month)::date; f timestamptz; t timestamptz; total int; cid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  if ref >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Gere a comissão só de meses já encerrados.' using errcode = 'P0001';
  end if;
  f := ref::timestamp at time zone 'America/Sao_Paulo';
  t := (ref + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';
  total := private.platform_fees(_business, f, t);
  if total <= 0 then raise exception 'Sem comissão ou taxas neste mês.' using errcode = 'P0001'; end if;
  insert into public.platform_charges(business_id, kind, description, amount_cents, due_on, reference_month, created_by)
  values (_business, 'comissao', 'Comissão e taxas de ' || to_char(ref, 'MM/YYYY'), total, current_date + 7, ref, auth.uid())
  returning id into cid;
  perform private.audit('finance.charge', 'platform_charges', cid::text, jsonb_build_object('kind', 'comissao', 'month', ref));
  return cid;
exception when unique_violation then
  raise exception 'A comissão deste mês já foi gerada.' using errcode = 'P0001';
end $$;

create or replace function public.admin_create_charge(_business uuid, _description text, _amount_cents integer, _due_on date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  insert into public.platform_charges(business_id, kind, description, amount_cents, due_on, created_by)
  values (_business, 'outro', btrim(_description), _amount_cents, _due_on, auth.uid())
  returning id into cid;
  perform private.audit('finance.charge', 'platform_charges', cid::text, jsonb_build_object('kind', 'outro'));
  return cid;
end $$;

-- pagamento recebido: mensalidade paga renova o plano por 1 mês
create or replace function public.admin_mark_charge_paid(_charge uuid, _method text, _paid_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare ch public.platform_charges%rowtype;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  update public.platform_charges set status = 'paga', paid_at = coalesce(_paid_at, now()), paid_method = _method
   where id = _charge and status = 'aberta' returning * into ch;
  if not found then raise exception 'Cobrança não está em aberto.' using errcode = 'P0001'; end if;
  if ch.kind = 'plano' and ch.subscription_id is not null then
    update public.business_subscriptions set current_period_end = (current_period_end + interval '1 month')::date
     where id = ch.subscription_id and status = 'active';
  end if;
  perform private.audit('finance.paid', 'platform_charges', ch.id::text, jsonb_build_object('amount', ch.amount_cents, 'method', _method));
end $$;

create or replace function public.admin_cancel_charge(_charge uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  update public.platform_charges set status = 'cancelada' where id = _charge and status = 'aberta';
  if not found then raise exception 'Só cobranças em aberto podem ser canceladas.' using errcode = 'P0001'; end if;
  perform private.audit('finance.charge_cancel', 'platform_charges', _charge::text, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_finance_summary()', 'public.admin_finance_businesses()', 'public.admin_list_charges(public.charge_status, uuid)',
    'public.admin_set_subscription(uuid, text, date, date, integer, text)', 'public.admin_cancel_subscription(uuid)',
    'public.admin_charge_subscription(uuid)', 'public.admin_charge_commission(uuid, date)',
    'public.admin_create_charge(uuid, text, integer, date)', 'public.admin_mark_charge_paid(uuid, text, timestamptz)',
    'public.admin_cancel_charge(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
