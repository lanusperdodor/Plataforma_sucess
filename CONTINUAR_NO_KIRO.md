# Continuação integral do Projeto Milhão no Kiro

Continue este repositório existente, sem reiniciar nem sobrescrever o trabalho. O objetivo é entregar o MVP completo da plataforma regional de delivery documentado neste projeto, em etapas verificáveis, e não apenas a fundação ou uma demonstração visual.

## Leia primeiro
- Todas as instruções em `.kiro/steering/`.
- `ARQUITETURA.md`, `REGRAS_COMERCIAIS.md`, `PROGRESSO.md`, `PROXIMOS_PASSOS.md`.
- `.kiro/specs/fundacao/` e `.kiro/specs/ui-ux/requirements.md`.
- `REVISAO_LOCAL.md`, com os resultados reais da validação no Windows.

## Estado real
A branch atual é `feat/fundacao-fase-1`. Existe PR para main ainda sem merge. O repositório já foi clonado, as dependências instaladas e o lockfile gerado. Não repita clone ou instalação sem necessidade. Typecheck e lint passaram; 24 testes reais do Vitest passaram; build passou. Banco e autenticação real ainda não foram validados. Não marcar a Fase 1 concluída apenas por esses checks.

## Primeiro: fechar a fundação
1. Revisar a migration e os testes SQL. Verificar o tipo enum no INSERT com UNION ALL de role_permissions; restringir o REVOKE global às tabelas deste módulo; testar privilégios, isolamento entre empresas, escalada de papéis e auditoria em banco descartável antes de qualquer aplicação remota.
2. Resolver os alertas do npm audit com versões compatíveis e nova validação completa, sem usar --force indiscriminadamente.
3. Verificar login, cadastro, logout, recuperação de senha completa (incluindo definir uma senha nova), edição do perfil e transições de sessão. Corrigir falhas reais e adicionar testes pertinentes.
4. Caso faltem projeto Supabase, credenciais públicas, ferramentas ou decisões, pedir somente o necessário e avançar nas tarefas independentes. Nunca inventar credenciais, usar service_role no frontend ou aplicar migrations em produção sem revisão.
5. Manter o PR sem merge até revisão do banco e verificações concluídas. Não publicar, contratar serviços ou ativar cobranças.

## Depois: desenvolver todo o MVP em specs
Criar um roteiro mestre com requisitos, dependências, critérios de aceite e tarefas pequenas para cada módulo. Reaproveitar as specs existentes. Implementar uma etapa por vez, sem perder o objetivo do produto inteiro:
1. Autenticação, perfis, papéis e permissões, incluindo usuários com múltiplos papéis e isolamento por empresa.
2. Lojas/restaurantes: cadastro, aprovação administrativa, cidade, horários, identidade visual com contraste acessível e equipe com permissões.
3. Cardápios: categorias, produtos, imagens, preços, disponibilidade e opções necessárias ao pedido.
4. Experiência do cliente: home regional, busca/categorias/filtros, página da loja, favoritos e navegação mobile conforme a spec UI/UX.
5. Carrinho e checkout: endereço, retirada/entrega própria/parceira, orçamento de frete antes de confirmar, motor financeiro no backend e snapshot imutável.
6. Pedidos: criação e transições autorizadas, acompanhamento pelo cliente, painel do restaurante e atualizações em tempo real; evitar duplicidade.
7. Entregas: aprovação e painel de entregadores, oferta com valor/distância, aceite atômico, entrega própria e parceira, estados e comprovação adequada.
8. Pagamentos em sandbox: provedor a decidir com o usuário, webhooks assinados, idempotência, conciliação, estornos e tarifas separadas.
9. Rastreamento: MapLibre, localização apenas durante entrega ativa, acesso restrito ao pedido, sinal de localização desatualizada e retenção limitada.
10. Administração Master/operador: aprovações, permissões, planos/taxas, auditoria e visão financeira, com MFA antes de produção.
11. Assinaturas dos planos e experiência presencial/QR, NFC e link Google conforme o plano aprovado, sem cobrança real não autorizada.
12. Integração ponta a ponta: fluxos cliente/lojista/entregador/Master, RLS, acessibilidade, responsividade, desempenho e documentação de operação. Preparar deploy Cloudflare Pages, mas aguardar autorização para publicar.

Shopping, serviços, rede social, vagas e publicidade estão documentados como FUTUROS. Preparar a arquitetura; não ampliar o MVP para esses módulos sem decisão do usuário.

## Regras comerciais a preservar
- pt-BR, BRL em centavos inteiros, America/Sao_Paulo; início em Itaú de Minas/MG e expansão regional/nacional.
- Comissão 0% até R$ 50; acima disso, 2% sobre TODO o subtotal.
- Entrega parceira curta: cliente R$ 4 + restaurante R$ 2 = entregador R$ 5 + plataforma R$ 1, mais a comissão aplicável.
- Entrega própria: R$ 1 para a plataforma, sem aplicar o pagamento de R$ 5 do parceiro; retirada sem receita de entrega.
- Fretes longos por zona/distância; entregador sempre financiado antes de confirmar.
- Planos: Delivery R$ 79/mês; Presencial + Delivery R$ 99/mês. Alterações de taxas apenas pelo Master, com auditoria e sem afetar pedidos confirmados.
- Promoções financiadas pelo estabelecimento e limitadas por orçamento/uso/validade; não inventar subsídio da plataforma.

## Método de entrega
Ler o código antes de editar; preservar a stack; cada módulo precisa funcionar contra dados reais de teste para ser concluído. Rodar typecheck, lint, testes sem watch e build após mudanças relevantes; testes SQL para autorização e E2E para fluxos críticos. Atualizar PROGRESSO e PROXIMOS_PASSOS com evidências e limitações. Fazer commits pequenos apenas se autorizados; não fazer push, merge ou deploy automaticamente. Quando uma etapa terminar, continuar a próxima tarefa independente do roteiro; pedir decisões apenas quando bloquearem trabalho concreto.

Comece apresentando o roteiro completo e identificando a primeira tarefa executável da fundação; em seguida implemente essa tarefa e valide o resultado.
