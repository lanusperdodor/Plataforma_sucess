---
inclusion: always
---

# Fluxo de desenvolvimento e economia de créditos

- Um módulo relevante = uma Spec (requirements → design → tasks) em `.kiro/specs/<modulo>/`. Tarefas pequenas e verificáveis.
- Ler o código existente antes de editar; não reescrever módulos; não reinstalar dependências.
- Verificação local antes de marcar concluído: `npm run typecheck && npm run lint && npm test -- --run && npm run build`.
- Testes: unitários para regras financeiras/permissões (obrigatórios), integração para banco/RLS, E2E para fluxos críticos. Nada de watch mode.
- Não marcar etapa como concluída só porque a UI existe; precisa funcionar contra dados reais/sandbox.
- Commits pequenos (Conventional Commits em pt-BR ou en). Nunca commitar `.env`.
- Atualizar `PROGRESSO.md` e `PROXIMOS_PASSOS.md` ao fim de cada fase (curtos).
- Nunca contratar serviço pago, ativar créditos extras ou fazer deploy sem autorização explícita. Se os créditos acabarem, deixar o estado salvo e a próxima tarefa em `PROXIMOS_PASSOS.md`.
