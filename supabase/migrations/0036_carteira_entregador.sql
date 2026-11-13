-- 0036_carteira_entregador: ganhos do entregador parceiro ficam GUARDADOS por 7 dias e depois podem ser sacados.
--  * Não é bloqueio: o entregador vê tudo o que ganhou. Cada entrega fica guardada 7 dias a partir da conclusão e então
--    passa para "disponível para saque". Assim ele junta um valor maior em vez de sacar de 5 em 5 reais.
--  * Saque: o entregador pede o saque do saldo disponível (chave Pix); um pedido em aberto por vez. O Master marca como
--    pago (depois de transferir) ou recusa (o valor volta para o disponível). Tudo auditado; o entregador é avisado.
--  * Regra de repasse de cada entrega parceira (já gravada no pedido, imutável):
--      cliente paga a taxa de entrega (R$ 4) + estabelecimento contribui (R$ 2) = entregador recebe (R$ 5) + Tucaí (R$ 1).
--    A tarifa da Tucaí sai desse total: o estabelecimento NÃO paga R$ 2 + R$ 1. As telas do estabelecimento somavam as duas
--    partes como custo dele (R$ 3) — corrigido aqui (entrega própria continua pagando a tarifa da plataforma).
--  * Resumo para o Master: quanto os clientes e os estabelecimentos pagaram, quanto os entregadores ganharam e quanto a Tucaí
--    recebe por entrega; saques pagos, pedidos e saldo guardado.

create or replace function private.courier_hold_days() returns integer language sql immutable as $$ select 7 $$;

create table if not exists public.courier_withdrawals (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  pix_key text not null check (char_length(btrim(pix_key)) between 3 and 140),
  status text not null default 'solicitado' check (status in ('solicitado', 'pago', 'recusado', 'cancelado')),
  is_test boolean not null default false,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 300)
);
create index if not exists courier_withdrawals_courier_idx on public.courier_withdrawals(courier_id, requested_at desc);
create index if not exists courier_withdrawals_status_idx on public.courier_withdrawals(status, requested_at);
create index if not exists courier_withdrawals_decided_by_idx on public.courier_withdrawals(decided_by);
-- um pedido de saque em aberto por entregador
create unique index if not exists courier_withdrawals_one_open_idx on public.courier_withdrawals(courier_id) where status = 'solicitado';

alter table public.courier_withdrawals enable row level security;
drop policy if exists courier_withdrawals_own_select on public.courier_withdrawals;
create policy courier_withdrawals_own_select on public.courier_withdrawals for select to authenticated
  using (courier_id = (select auth.uid()));
revoke all on public.courier_withdrawals from public, anon, authenticated;
grant select on public.courier_withdrawals to authenticated;  -- só as próprias linhas (RLS); gravação só pelas funções

-- saldo de um entregador (usado pelo próprio entregador e pelo Master)
create or replace function private.courier_wallet_of(_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with d as (
    select courier_pay_cents as cents, delivered_at from public.deliveries
     where courier_id = _user and status = 'delivered' and delivered_at is not null),
  w as (select * from public.courier_withdrawals where courier_id = _user),
  s as (
    select coalesce((select sum(cents) from d), 0)::int as ganho,
           coalesce((select sum(cents) from d where delivered_at <= now() - make_interval(days => private.courier_hold_days())), 0)::int as liberado,
           coalesce((select sum(amount_cents) from w where status = 'solicitado'), 0)::int as em_saque,
           coalesce((select sum(amount_cents) from w where status = 'pago'), 0)::int as sacado)
  select jsonb_build_object(
    'dias_guardado', private.courier_hold_days(),
    'ganho_total_cents', s.ganho,
    'guardado_cents', s.ganho - s.liberado,
    'disponivel_cents', greatest(s.liberado - s.em_saque - s.sacado, 0),
    'em_saque_cents', s.em_saque,
    'sacado_cents', s.sacado,
    'liberacoes', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'cents', cents) order by dia) from (
        select ((delivered_at + make_interval(days => private.courier_hold_days())) at time zone 'America/Sao_Paulo')::date as dia, sum(cents)::int as cents
          from d where delivered_at > now() - make_interval(days => private.courier_hold_days()) group by 1) x), '[]'::jsonb))
    from s
$$;

-- entregador: carteira (mantém os campos antigos de courier_earnings para compatibilidade)
create or replace function public.courier_wallet() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  return private.courier_wallet_of(c.user_id) || jsonb_build_object(
    'today_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'
                               and delivered_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0),
    'week_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'
                              and delivered_at >= now() - interval '7 days'), 0),
    'deliveries', (select count(*) from public.deliveries where courier_id = c.user_id and status = 'delivered'));
end $$;

create or replace function public.courier_withdrawals_list()
returns table (id uuid, amount_cents integer, pix_key text, status text, requested_at timestamptz, decided_at timestamptz, note text)
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  return query select w.id, w.amount_cents, w.pix_key, w.status, w.requested_at, w.decided_at, w.note
    from public.courier_withdrawals w where w.courier_id = c.user_id order by w.requested_at desc limit 50;
end $$;

-- entregador: pede o saque de TODO o saldo disponível (o que já passou dos 7 dias)
create or replace function public.courier_request_withdrawal(_pix_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); avail int; w public.courier_withdrawals%rowtype;
begin
  perform private.rate_limit('courier.withdrawal', 10, 3600);
  if char_length(btrim(coalesce(_pix_key, ''))) < 3 then raise exception 'Informe a chave Pix para receber.' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('courier_wallet:' || c.user_id::text));
  if exists (select 1 from public.courier_withdrawals where courier_id = c.user_id and status = 'solicitado') then
    raise exception 'Você já tem um saque em análise. Aguarde a Tucaí concluir.' using errcode = 'P0001';
  end if;
  avail := (private.courier_wallet_of(c.user_id)->>'disponivel_cents')::int;
  if avail <= 0 then
    raise exception 'Ainda não há saldo disponível. Cada entrega fica guardada % dias antes de poder ser sacada.', private.courier_hold_days() using errcode = 'P0001';
  end if;
  insert into public.courier_withdrawals(courier_id, amount_cents, pix_key, is_test)
  values (c.user_id, avail, btrim(_pix_key),
          exists (select 1 from private.test_data_runs r where r.removed_at is null and c.user_id = any(r.user_ids)))
  returning * into w;
  perform private.audit('courier.withdrawal_request', 'courier_withdrawals', w.id::text, jsonb_build_object('amount', w.amount_cents));
  return jsonb_build_object('id', w.id, 'amount_cents', w.amount_cents);
end $$;

create or replace function public.courier_cancel_withdrawal(_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  update public.courier_withdrawals set status = 'cancelado', decided_at = now()
   where id = _id and courier_id = c.user_id and status = 'solicitado';
  if not found then raise exception 'Este saque não pode mais ser cancelado.' using errcode = 'P0001'; end if;
end $$;

-- Master: pedidos de saque (com o saldo atual de cada entregador)
create or replace function public.admin_courier_withdrawals(_status text default 'solicitado', _include_test boolean default true)
returns table (id uuid, courier_id uuid, courier_name text, amount_cents integer, pix_key text, status text, requested_at timestamptz,
               decided_at timestamptz, note text, is_test boolean, disponivel_cents integer, guardado_cents integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  if coalesce(_status, 'todos') not in ('todos', 'solicitado', 'pago', 'recusado', 'cancelado') then raise exception 'Situação inválida.' using errcode = 'P0001'; end if;
  return query
    select w.id, w.courier_id, coalesce(c.full_name, 'Entregador'), w.amount_cents, w.pix_key, w.status, w.requested_at, w.decided_at, w.note, w.is_test,
           (private.courier_wallet_of(w.courier_id)->>'disponivel_cents')::int, (private.courier_wallet_of(w.courier_id)->>'guardado_cents')::int
      from public.courier_withdrawals w left join public.couriers c on c.user_id = w.courier_id
     where (coalesce(_status, 'todos') = 'todos' or w.status = _status) and (_include_test or not w.is_test)
     order by (w.status = 'solicitado') desc, w.requested_at desc limit 200;
end $$;

-- Master: marca como pago (depois de transferir) ou recusa (valor volta para o disponível)
create or replace function public.admin_decide_withdrawal(_id uuid, _decision text, _note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.courier_withdrawals%rowtype;
begin
  perform private.require_master();
  perform private.rate_limit('admin.withdrawal', 120, 600);
  if _decision not in ('pago', 'recusado') then raise exception 'Decisão inválida.' using errcode = 'P0001'; end if;
  if _decision = 'recusado' and char_length(btrim(coalesce(_note, ''))) < 3 then raise exception 'Informe o motivo da recusa.' using errcode = 'P0001'; end if;
  update public.courier_withdrawals set status = _decision, decided_at = now(), decided_by = auth.uid(), note = nullif(left(btrim(coalesce(_note, '')), 300), '')
   where id = _id and status = 'solicitado' returning * into w;
  if not found then raise exception 'Este saque não está mais em análise.' using errcode = 'P0001'; end if;
  perform private.audit('finance.withdrawal_' || _decision, 'courier_withdrawals', w.id::text, jsonb_build_object('amount', w.amount_cents, 'courier', w.courier_id));
  perform private.notify_link(w.courier_id, 'ops_alert', null, '/entregador/saques',
    case when _decision = 'pago' then 'Seu saque de R$ ' || to_char(w.amount_cents / 100.0, 'FM999999990.00') || ' foi pago.'
         else 'Seu saque foi recusado: ' || w.note || '. O valor voltou para o seu saldo disponível.' end);
end $$;

-- Master: quem pagou e quem recebeu nas entregas parceiras do período
create or replace function public.admin_delivery_money(_from date, _to date, _include_test boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  perform private.require_permission('finance.view');
  if _from is null or _to is null or _to < _from or _to - _from > 366 then raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001'; end if;
  return (
    with o as (
      select o.* from public.orders o
       where o.status = 'delivered' and o.updated_at >= f and o.updated_at < t and (_include_test or not o.is_test)
         and o.fulfillment in ('delivery_partner', 'delivery_own')),
    w as (select * from public.courier_withdrawals where (_include_test or not is_test))
    select jsonb_build_object(
      'entregas_parceiras', (select count(*) from o where fulfillment = 'delivery_partner'),
      'clientes_pagaram_cents', coalesce((select sum(delivery_fee_cents) from o where fulfillment = 'delivery_partner'), 0),
      'lojas_pagaram_cents', coalesce((select sum(merchant_delivery_contribution_cents) from o where fulfillment = 'delivery_partner'), 0),
      'entregadores_ganharam_cents', coalesce((select sum(courier_pay_cents) from o where fulfillment = 'delivery_partner'), 0),
      'tucai_parceiras_cents', coalesce((select sum(platform_delivery_fee_cents) from o where fulfillment = 'delivery_partner'), 0),
      'entregas_proprias', (select count(*) from o where fulfillment = 'delivery_own'),
      'tucai_proprias_cents', coalesce((select sum(platform_delivery_fee_cents) from o where fulfillment = 'delivery_own'), 0),
      'teste_incluido', _include_test,
      'pedidos_teste', (select count(*) from o where is_test),
      'saques_pagos_cents', coalesce((select sum(amount_cents) from w where status = 'pago' and decided_at >= f and decided_at < t), 0),
      'saques_em_analise', (select count(*) from w where status = 'solicitado'),
      'saques_em_analise_cents', coalesce((select sum(amount_cents) from w where status = 'solicitado'), 0),
      'saldo_entregadores_cents', coalesce((select sum(courier_pay_cents) from public.deliveries d
                                             where d.status = 'delivered' and (_include_test or not d.is_test)), 0)
                                  - coalesce((select sum(amount_cents) from w where status in ('pago', 'solicitado')), 0)));
end $$;

-- estabelecimento: custo de entrega = contribuição (parceira) ou tarifa da plataforma (entrega própria); nunca as duas somadas
create or replace function private.merchant_delivery_cost(_fulfillment public.order_fulfillment, _contribution integer, _platform_fee integer) returns integer
language sql immutable set search_path = '' as $$
  select case when _fulfillment = 'delivery_partner' then _contribution when _fulfillment = 'delivery_own' then _platform_fee else 0 end
$$;

create or replace function public.merchant_finance(_business uuid, _from date, _to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
        today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_premium(_business);
  if _from is null or _to is null or _to < _from or _to - _from > 366 then raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001'; end if;
  return (
    with done as (select * from public.orders where business_id = _business and status in ('delivered', 'picked_up')),
    per as (select * from done where updated_at >= f and updated_at < t),
    items as (
      select i.quantity, i.line_total_cents, case when i.product_id is null then null else private.product_unit_cost(i.product_id) end as unit_cost
        from public.order_items i join per o on o.id = i.order_id),
    exp as (
      select e.*, case
               when e.recurrence = 'unica' then (case when e.spent_on between _from and _to then 1 else 0 end)
               when e.spent_on > _to then 0
               else ((extract(year from _to) * 12 + extract(month from _to))
                     - (extract(year from greatest(e.spent_on, _from)) * 12 + extract(month from greatest(e.spent_on, _from))) + 1)::int
             end as times
        from public.business_expenses e where e.business_id = _business)
    select jsonb_build_object(
      'hoje_cents', coalesce((select sum(subtotal_cents) from done where updated_at >= today), 0),
      'mes_cents', coalesce((select sum(subtotal_cents) from done where updated_at >= month), 0),
      'pedidos', (select count(*) from per),
      'ticket_medio_cents', coalesce((select round(avg(subtotal_cents)) from per), 0)::int,
      'cancelados', (select count(*) from public.orders where business_id = _business and status in ('rejected', 'cancelled') and updated_at >= f and updated_at < t),
      'faturamento_bruto_cents', coalesce((select sum(subtotal_cents + case when fulfillment = 'delivery_own' then delivery_fee_cents else 0 end) from per), 0),
      'comissao_cents', coalesce((select sum(commission_cents) from per), 0),
      'taxas_entrega_cents', coalesce((select sum(private.merchant_delivery_cost(fulfillment, merchant_delivery_contribution_cents, platform_delivery_fee_cents)) from per), 0),
      'custo_produtos_cents', coalesce((select sum(quantity * unit_cost) from items where unit_cost is not null), 0),
      'itens_sem_custo', (select count(*) from items where unit_cost is null),
      'vendas_itens_com_custo_cents', coalesce((select sum(line_total_cents) from items where unit_cost is not null), 0),
      'despesas_cents', coalesce((select sum(amount_cents * times) from exp), 0),
      'despesas_por_categoria', coalesce((select jsonb_object_agg(category, total) from (select category, sum(amount_cents * times) as total from exp where times > 0 group by category) x), '{}'::jsonb),
      'recebido_na_entrega_cents', coalesce((select sum(total_cents) from per where fulfillment <> 'delivery_partner'), 0),
      'caixa_hoje', coalesce((select jsonb_object_agg(payment_method, total) from (select payment_method, sum(total_cents) as total from done where updated_at >= today group by payment_method) x), '{}'::jsonb)));
end $$;

create or replace function public.merchant_overview(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        premium boolean := public.business_has_premium(_business);
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with o as (select * from public.orders where business_id = _business and created_at >= month - interval '14 days')
    select jsonb_build_object(
      'premium', premium,
      'recebidos_hoje', (select count(*) from o where created_at >= today),
      'concluidos_hoje', (select count(*) from o where status in ('delivered', 'picked_up') and updated_at >= today),
      'cancelados_hoje', (select count(*) from o where status in ('rejected', 'cancelled') and updated_at >= today),
      'em_andamento', (select count(*) from public.orders x where x.business_id = _business and x.status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery')),
      'faturamento_hoje_cents', coalesce((select sum(subtotal_cents) from o where status in ('delivered', 'picked_up') and updated_at >= today), 0),
      'faturamento_mes_cents', coalesce((select sum(subtotal_cents) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0),
      'ticket_medio_cents', coalesce((select round(avg(subtotal_cents)) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0)::int,
      'recebido_mes_cents', coalesce((select sum(total_cents) from o where status in ('delivered', 'picked_up') and updated_at >= month and fulfillment <> 'delivery_partner'), 0),
      'pendente_cents', coalesce((select sum(total_cents) from public.orders x where x.business_id = _business and x.status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery')), 0),
      'taxas_mes_cents', coalesce((select sum(commission_cents + private.merchant_delivery_cost(fulfillment, merchant_delivery_contribution_cents, platform_delivery_fee_cents)) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0),
      'despesas_mes_cents', case when premium then coalesce((select sum(amount_cents) from public.business_expenses e where e.business_id = _business
                                   and (e.recurrence = 'mensal' and e.spent_on < (month + interval '1 month') or e.spent_on >= month::date)), 0) end,
      'serie', coalesce((select jsonb_agg(jsonb_build_object('dia', d::date, 'cents', coalesce((select sum(subtotal_cents) from o
                           where status in ('delivered', 'picked_up') and (updated_at at time zone 'America/Sao_Paulo')::date = d::date), 0)) order by d)
                          from generate_series((now() at time zone 'America/Sao_Paulo')::date - 13, (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') d), '[]'::jsonb)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.courier_hold_days()', 'private.courier_wallet_of(uuid)', 'private.merchant_delivery_cost(public.order_fulfillment, integer, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.courier_wallet()', 'public.courier_withdrawals_list()', 'public.courier_request_withdrawal(text)', 'public.courier_cancel_withdrawal(uuid)',
    'public.admin_courier_withdrawals(text, boolean)', 'public.admin_decide_withdrawal(uuid, text, text)', 'public.admin_delivery_money(date, date, boolean)',
    'public.merchant_finance(uuid, date, date)', 'public.merchant_overview(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
