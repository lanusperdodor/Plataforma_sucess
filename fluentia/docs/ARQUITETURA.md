# Arquitetura

## Visão geral

```
┌────────────── Android (APK) ──────────────┐        ┌──── Cloudflare Worker ────┐
│ Expo Router (telas)                        │        │ backend/src/index.ts       │
│   └ state/app.tsx (contexto, timers)      │ HTTPS  │  • token pessoal           │
│ domain/  lógica pura (testada em Node)     │ ─────▶ │  • limites de requisição   │──▶ Anthropic / API compatível
│ db/      SQLite (expo-sqlite) + migrações  │ Bearer │  • chave do provedor       │──▶ Azure Speech (opcional)
│ services/ IA, TTS, STT, Keystore, backup   │        └────────────────────────────┘
└────────────────────────────────────────────┘
   TTS: vozes do Android · STT: serviço de voz do Android
```

## Decisões

- **Expo SDK 58 + Expo Router + TypeScript estrito.** Projeto gerenciado; as pastas `android/`/`ios/` são geradas (`expo prebuild`) e não versionadas.
- **SQLite local como fonte da verdade.** Um usuário, sem login. `src/db/types.ts` define uma interface mínima (`exec/run/all/first/tx`) implementada por `expo-sqlite` no app e por `node:sqlite` nos testes — os mesmos repositórios rodam nos dois, então os testes exercitam SQL real.
- **Migrações versionadas** por `PRAGMA user_version` (`src/db/migrations.ts`), cada uma em transação. Regra: nunca editar uma migração publicada; acrescentar outra.
- **Currículo em código** (`src/content/*.ts`), sincronizado com as tabelas `courses/units/lessons` quando `CONTENT_VERSION` muda. Progresso é guardado por identificador estável (`en.a1.u1.l1.w3`); por isso não se reordena itens publicados. Unidades previstas e ainda sem lições aparecem como "planejadas" e podem ganhar lições geradas por IA, salvas no banco (offline depois).
- **Progresso independente por idioma**: toda tabela de progresso tem coluna `lang`; o nível exibido é o da próxima lição não concluída daquele idioma.
- **Avanço por desempenho**: uma lição só é concluída com ≥ 70 % na avaliação (sem dicas de leitura); só então o vocabulário entra nas revisões. Abrir a lição não conta.
- **Correção local tolerante** (`src/domain/grading.ts`): aceita todas as respostas previstas, ignora caixa/pontuação, expande contrações do inglês, avisa sobre acento ausente e tolera um erro de digitação em palavra longa (só em alfabeto latino). Coreano e mandarim são comparados exatamente (mandarim por caractere). Texto livre vai para a IA.
- **Fala ≠ pronúncia**: o exercício de fala compara a transcrição com a frase e mostra o diff; nenhuma "nota" é derivada disso. Nota fonética só com serviço real (Azure), exibida separadamente.
- **FSRS** via `ts-fsrs` (retenção desejada 90 %, intervalo máximo 365 dias). A fila começa pelo cartão vencido há mais tempo. Errar um item aprendido em outro exercício antecipa a revisão dele.
- **Plano diário** (`src/domain/plan.ts`): só os idiomas agendados para o dia da semana; tempo dividido pela prioridade; ordem revisões → próxima lição → habilidade mais fraca (acerto < 75 % com ≥ 8 respostas em 14 dias) → conversa.
- **IA atrás de uma camada própria**: o app conhece apenas `/v1/complete` e `/v1/pronunciation` do seu backend. Trocar de provedor é configuração do backend. O cliente tem timeout, nova tentativa só para falhas transitórias (rede, 502–504), códigos de erro claros, teto diário local e registro de uso (tokens) para controle de custos.
- **Saída estruturada**: o professor responde em JSON validado por esquema (fala, leitura, tradução, feedback, sugestões). O histórico é reenviado no mesmo formato, para o modelo lembrar das dicas já dadas e só entregar a correção na segunda tentativa.
- **Privacidade**: chaves e token fora do backup e no Keystore; gravações temporárias no cache, apagadas a cada nova tentativa e ao sair do exercício; telas avisam quando texto/áudio sai do aparelho.

## Banco (tabelas)

`profile`, `settings`, `languages`, `courses`, `units`, `lessons`, `lesson_progress`, `attempts`, `vocabulary`, `reviews` (estado FSRS), `review_log`, `assessments`, `conversations`, `messages`, `writing_submissions`, `goals`, `study_sessions`, `xp_log`, `achievements`, `ai_usage`.

## Testes

| Comando | O que cobre |
|---|---|
| `npm test` | 133 testes: correção, geração de exercícios para todas as lições, currículo, migrações, persistência em arquivo, progresso independente, FSRS, conversas, backup/restauração (inclusive falha no meio), plano, gamificação, cliente de IA (falhas de rede, timeout, limites, recusas), professor, backend (autenticação, validação, limites, provedores, avaliação fonética) |
| `npm run test:e2e` | Interface completa no Chromium (build web): boas-vindas, lição com prática/reprovação/aprovação, progresso por idioma, revisão, professor de IA com backend simulado, estatísticas, backup → apagar tudo → restaurar, persistência após recarregar |
