# Privacidade e LGPD — inventário e procedimentos

Conformidade jurídica final depende de revisão especializada. Fonte única dos tratamentos,
operadores e armazenamento local: `src/features/legal/inventory.ts` (exibida em `/privacidade`
e `/armazenamento`; o teste `inventory.test.ts` falha se surgir chave de armazenamento não declarada).

## Dados institucionais pendentes (não inventar)
Razão social, CNPJ, endereço, encarregado (DPO) e e-mail de privacidade: `src/config/legal.ts`
(todos nulos e exibidos como "pendente"). Preencher antes da publicação definitiva.

## Minimização (estado atual)
- Não coletamos localização em tempo real, documentos, dados de pagamento nem dados sensíveis.
- Endereço do estabelecimento só aparece publicamente se aprovado; o e-mail do dono só para a equipe com permissão.
- Entregadores (Sprint 5): exigir apenas os documentos necessários, guardar em bucket privado com prazo de retenção e acesso só de quem analisa.

## Consentimento
Nenhum tratamento atual tem o consentimento como base legal; por isso não há banner nem caixas de
consentimento (seria declarar algo inexistente). Quando houver (ex.: e-mail de marketing), criar
registro de decisão com versão, revogação e sem caixa pré-marcada.

## Direitos do titular — fluxo implementado
1. Titular: Perfil → Privacidade e dados (`/perfil/privacidade`): baixa a cópia dos dados
   (`my_data_export`) e registra pedidos (`submit_privacy_request`), com histórico e resposta.
2. Equipe com `privacy.manage` (+ MFA): Painel → Privacidade. Registra "em atendimento",
   "concluída" ou "não atendida" com justificativa visível ao titular. Tudo auditado sem o texto livre.
3. Prazo de resposta: definir com o jurídico (a LGPD prevê resposta imediata simplificada ou até 15 dias para a completa).

## Exclusão e retenção
- Pedido de exclusão concluído com "anonimizar": apaga nome, telefone e cidade do perfil e o nome
  em avaliações (`private.anonymize_user`). Registros comerciais, fiscais e de auditoria são mantidos.
- Exclusão da conta de login: Supabase → Authentication → Users → excluir o usuário. Por FK,
  perfil/papéis são removidos; solicitações LGPD ficam com `user_id` nulo (prova do atendimento).
  Negócios do usuário bloqueiam a exclusão (owner sem cascade) — transferir ou encerrar antes.
- Retenção por categoria: ver tabela em `/privacidade` (prazos marcados "a validar").
- Cópias de segurança: dados excluídos permanecem nos backups até expirarem pela retenção do
  backup; em caso de restauração, reaplicar as exclusões/anonimizações registradas em `privacy_requests`.

## Operadores (contratos)
Ver `OPERATORS` no inventário. Nenhum contrato/DPA foi confirmado como assinado. Revisar: Supabase
(região do projeto, DPA, subprocessadores), Cloudflare (DPA), e os futuros provedores de pagamento,
mapas, mensageria, monitoramento e IA antes da contratação.
