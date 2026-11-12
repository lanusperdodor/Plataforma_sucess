-- RECUPERAÇÃO ADMINISTRATIVA DO MODO MANUTENÇÃO (independente do app e do painel Master).
-- Use se o painel não abrir ou o Master perder o acesso durante a manutenção.
-- Executar no SQL Editor do Supabase (papel postgres). Não apaga nem altera pedidos, pagamentos ou sessões:
-- só devolve a plataforma ao estado NORMAL, registra na auditoria e mostra as verificações de integridade.

-- 1) estado atual
select mode, reason, eta, changed_at, prepared_at, started_at from private.platform_state;

-- 2) voltar ao normal (troque o motivo)
select private.maintenance_force_normal('Recuperação manual: painel indisponível');

-- 3) conferir operações em andamento após o retorno
select private.maintenance_inflight();
