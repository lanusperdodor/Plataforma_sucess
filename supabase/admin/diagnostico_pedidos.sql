-- Diagnóstico SOMENTE LEITURA dos pedidos de teste (não altera nada). Rode no SQL Editor do Supabase.
-- Mostra os últimos pedidos, para qual estabelecimento (e lote) foram e quem é a equipe que pode vê-los.

-- 1) Últimos 20 pedidos com estabelecimento, modalidade, status e e-mail do cliente
select o.created_at, o.code, o.status, o.fulfillment, b.name as estabelecimento, b.slug, b.id as business_id,
       cu.email as cliente
  from public.orders o
  join public.businesses b on b.id = o.business_id
  left join auth.users cu on cu.id = o.customer_id
 order by o.created_at desc
 limit 20;

-- 2) Estabelecimentos "[Teste]" e as contas que podem ver os pedidos de cada um
select b.name as estabelecimento, b.slug, b.delivery_offer as entrega, m.member_role as papel, u.email as login
  from public.businesses b
  join public.business_members m on m.business_id = b.id
  join auth.users u on u.id = m.user_id
 where b.name like '[Teste]%'
 order by b.created_at, b.name, m.member_role;

-- 3) Entregas criadas (só pedidos com "entregador parceiro" que ficaram prontos geram oferta)
select d.offered_at, o.code, d.status, b.name as estabelecimento
  from public.deliveries d join public.orders o on o.id = d.order_id join public.businesses b on b.id = d.business_id
 order by d.offered_at desc
 limit 20;
