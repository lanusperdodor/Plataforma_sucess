-- 0038_entregador_resumo: a tela inicial do entregador mostra ganhos do mês e entregas de hoje/mês com números do banco.
-- Só acrescenta campos a courier_wallet() (mesmas permissões e regras de saque da 0036; nada financeiro muda).
create or replace function public.courier_wallet() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
        today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  return private.courier_wallet_of(c.user_id) || jsonb_build_object(
    'today_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered' and delivered_at >= today), 0),
    'week_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'
                              and delivered_at >= now() - interval '7 days'), 0),
    'month_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered' and delivered_at >= month), 0),
    'deliveries_today', (select count(*) from public.deliveries where courier_id = c.user_id and status = 'delivered' and delivered_at >= today),
    'deliveries_month', (select count(*) from public.deliveries where courier_id = c.user_id and status = 'delivered' and delivered_at >= month),
    'deliveries', (select count(*) from public.deliveries where courier_id = c.user_id and status = 'delivered'));
end $$;
revoke all on function public.courier_wallet() from public, anon;
grant execute on function public.courier_wallet() to authenticated;
