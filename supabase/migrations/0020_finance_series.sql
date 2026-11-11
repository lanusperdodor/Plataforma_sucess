-- 0020_finance_series: séries mensais para os gráficos do Financeiro (dados reais, sem estimativa).
--  * recebido: cobranças pagas no mês (pela data do pagamento)
--  * comissão e taxas: geradas pelos pedidos concluídos no mês
--  * novas assinaturas: planos iniciados no mês
-- Fuso de Brasília. Leitura com finance.view.

create or replace function public.admin_finance_series(_months integer default 12)
returns table (month date, received_cents integer, fees_cents integer, new_subscriptions integer)
language plpgsql stable security definer set search_path = '' as $$
declare n int := least(greatest(coalesce(_months, 12), 1), 36);
        first_month date := (date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => n - 1))::date;
begin
  perform private.require_permission('finance.view');
  return query
    with months as (select generate_series(first_month, date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, interval '1 month')::date as m)
    select ms.m,
           coalesce((select sum(ch.amount_cents)::int from public.platform_charges ch
                      where ch.status = 'paga' and date_trunc('month', ch.paid_at at time zone 'America/Sao_Paulo')::date = ms.m), 0),
           coalesce((select sum(o.commission_cents + o.platform_delivery_fee_cents)::int from public.orders o
                      where o.status in ('delivered', 'picked_up') and date_trunc('month', o.updated_at at time zone 'America/Sao_Paulo')::date = ms.m), 0),
           (select count(*)::int from public.business_subscriptions s where date_trunc('month', s.started_on)::date = ms.m)
      from months ms
     order by ms.m;
end $$;

create or replace function public.admin_finance_by_plan()
returns table (plan_code text, plan_name text, businesses integer, mrr_cents integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  return query
    select p.code, p.name,
           (select count(*)::int from public.business_subscriptions s join public.businesses b on b.id = s.business_id
             where s.plan_code = p.code and s.status = 'active' and b.status = 'active'),
           coalesce((select sum(s.price_cents)::int from public.business_subscriptions s join public.businesses b on b.id = s.business_id
             where s.plan_code = p.code and s.status = 'active' and b.status = 'active'), 0)
      from public.plans p
    union all
    select null, 'Sem plano',
           (select count(*)::int from public.businesses b
             where b.status = 'active' and not b.is_demo
               and not exists (select 1 from public.business_subscriptions s where s.business_id = b.id and s.status = 'active')),
           0;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_finance_series(integer)', 'public.admin_finance_by_plan()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
