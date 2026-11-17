# Fluentia

Professor particular de idiomas com IA, para uso pessoal no Android: **inglês, espanhol, coreano e mandarim**, do zero ao avançado, com interface em português.

- Lições com explicação, pronúncia, vocabulário, exemplos com áudio, prática e avaliação (CEFR A1–C2; referências TOPIK/HSK sem equivalência direta).
- Exercícios corrigidos no aparelho: escolha, montar frase, completar, tradução digitada, ditado, escuta, identificação de tons do mandarim e fala com microfone.
- Professor virtual por texto e por voz (turnos): fala no seu nível, dá dica antes da resposta, corrige, traduz, explica em português, guarda o histórico.
- Correção de textos livres pela IA (frases, diálogos, redações) com explicação dos erros.
- Revisão espaçada com **FSRS**, plano diário adaptativo para os quatro idiomas, metas, XP, sequência, conquistas e estatísticas.
- Tudo salvo localmente (SQLite), com backup/restauração em arquivo. Funciona offline, exceto a IA.

## Começo rápido

```bash
cd fluentia
npm install
npm test              # testes unitários e de integração (Node)
npm run typecheck
npx expo start        # desenvolvimento
```

Instalar no celular: veja **[docs/INSTALACAO.md](docs/INSTALACAO.md)**.
Ligar o professor de IA: veja **[docs/SERVICOS.md](docs/SERVICOS.md)** (backend próprio; o APK não contém chaves).

## Documentos

| Arquivo | Conteúdo |
|---|---|
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Gerar e instalar o APK (EAS ou build local) |
| [docs/SERVICOS.md](docs/SERVICOS.md) | Backend de IA, provedores, custos, avaliação fonética |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Estrutura do código, banco, decisões |
| [docs/STATUS.md](docs/STATUS.md) | O que está pronto e testado, o que depende de configuração, o que falta |

## Estrutura

```
fluentia/
  src/app/        telas (Expo Router)
  src/content/    currículo dos quatro idiomas
  src/domain/     correção, exercícios, FSRS, plano, gamificação (lógica pura, testada)
  src/db/         SQLite: migrações, repositórios, backup
  src/services/   IA (cliente/professor), voz (TTS/STT), armazenamento seguro
  backend/        Cloudflare Worker que guarda a chave da IA
  tests/          testes (Vitest) e teste de interface (Playwright)
```
