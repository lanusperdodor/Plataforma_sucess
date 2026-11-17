-- Diagnóstico SOMENTE LEITURA: por que um entregador vê (ou não vê) cada corrida aberta.
-- Rode no SQL Editor do Supabase. Não altera nada.
-- Para cada corrida aberta (oferta) e cada entregador com cadastro, mostra "VÊ" ou o motivo de não ver.

with corridas as (
  select d.order_id, o.code as pedido, b.name as loja, d.city_id, ci.name as cidade_corrida, d.is_test, d.offer_round,
         d.offered_at, d.offer_expires_at, o.status as status_pedido
    from public.deliveries d
    join public.orders o on o.id = d.order_id
    join public.businesses b on b.id = d.business_id
    left join public.cities ci on ci.id = d.city_id
   where d.status = 'offered' and d.courier_id is null
), entregadores as (
  select c.user_id, c.full_name, u.email, c.status, c.is_online, c.city_id, ci.name as cidade_entregador,
         private.is_test_user(c.user_id) as conta_teste,
         exists (select 1 from public.deliveries a where a.courier_id = c.user_id and a.status in ('accepted', 'picked_up')) as em_entrega
    from public.couriers c
    join auth.users u on u.id = c.user_id
    left join public.cities ci on ci.id = c.city_id
)
select k.pedido, k.loja, k.cidade_corrida, e.full_name as entregador, e.email, e.cidade_entregador,
       case
         when e.status <> 'approved' then 'NÃO VÊ: cadastro ' || e.status::text
         when not e.is_online then 'NÃO VÊ: está OFFLINE'
         when e.city_id is distinct from k.city_id then 'NÃO VÊ: cidade diferente da corrida'
         when e.conta_teste <> k.is_test then case when k.is_test then 'NÃO VÊ: corrida de TESTE e entregador REAL' else 'NÃO VÊ: corrida REAL e entregador de TESTE' end
         when k.status_pedido in ('rejected', 'cancelled') then 'NÃO VÊ: pedido recusado/cancelado'
         when exists (select 1 from public.delivery_declines x where x.order_id = k.order_id and x.courier_id = e.user_id and x.offer_round = k.offer_round)
           then 'NÃO VÊ: recusou esta corrida (volta na próxima rodada)'
         when e.em_entrega then 'VÊ (só aceita depois de concluir a entrega atual)'
         else 'VÊ'
       end as situacao,
       k.offered_at as corrida_criada, k.offer_expires_at as rodada_expira
  from corridas k cross join entregadores e
 order by k.offered_at desc, situacao, e.full_name;

-- Entregadores próprios de loja que ainda NÃO têm cadastro de parceiro (precisam tocar em "Ficar online" uma vez)
select u.email, p.full_name, b.name as loja
  from public.business_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  join public.businesses b on b.id = m.business_id
 where m.member_role = 'courier_own' and not exists (select 1 from public.couriers c where c.user_id = m.user_id);
