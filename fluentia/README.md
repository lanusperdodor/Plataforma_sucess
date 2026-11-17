# Fluentia

Professor particular de idiomas com IA, para uso pessoal no Android: **inglês, espanhol, coreano e mandarim**, do zero ao avançado, com interface em português.

- Lições com explicação, pronúncia, vocabulário, exemplos com áudio, prática e avaliação (CEFR A1–C2; referências TOPIK/HSK sem equivalência direta).
- Exercícios corrigidos no aparelho: escolha, montar frase, completar, tradução digitada, ditado, escuta, identificação de tons do mandarim e fala com microfone.
- Professor virtual por texto e por voz (turnos): fala no seu nível, dá dica antes da resposta, corrige, traduz, explica em português, guarda o histórico.
- Correção de textos livres pela IA (frases, diálogos, redações) com explicação dos erros.
- Revisão espaçada com **FSRS**, plano diário adaptativo para os quatro idiomas, metas, XP, sequência, conquistas e estatísticas.
- Tudo salvo localmente (SQLite), com backup/restauração em arquivo. Funciona offline, exceto a IA.

## Usar sem instalar nada (claude.ai)

Versão web, privada, no domínio do Claude: **https://claude.ai/artifact/VVpmN4gSA3CYuUUZJMM8Qe**

Abra o link no navegador (celular ou computador) conectado à sua conta do Claude. O professor de IA usa o Claude da sua própria conta — sem chave, sem servidor e sem custo além do seu plano. O microfone usa o ditado do claude.ai (Chrome no computador ou app do Claude para desktop). O progresso fica salvo no navegador; faça backups em Perfil → Dados e backup. Para atualizar a página depois de mudar o código: `npm run build:claude` e republicar `artifact-build/index.html` com os arquivos de `artifact-files.json`.

## Começo rápido

```bash
cd fluentia
npm install
npm test              # testes unitários e de integração (Node)
npm run typecheck
npx expo start        # desenvolvimento
```

Instalar no celular: veja **[docs/INSTALACAO.md](docs/INSTALACAO.md)**.
Ligar o professor de IA de graça: crie uma chave em aistudio.google.com/apikey e cole em Perfil → Inteligência artificial → Simples e grátis. Detalhes e o modo avançado (backend com Claude): **[docs/SERVICOS.md](docs/SERVICOS.md)**. O APK não contém chaves.

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
