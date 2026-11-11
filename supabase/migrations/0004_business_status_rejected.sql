-- 0004: novo estado de estabelecimento "rejected" (solicitação recusada pelo Master).
-- Isolado em migration própria: um valor novo de enum não pode ser usado na mesma transação.
alter type public.business_status add value if not exists 'rejected';
