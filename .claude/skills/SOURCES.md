# Skills instaladas neste repositório

Registro de origem. Skills de terceiros foram copiadas SEM scripts executáveis, depois de lidas e conferidas.
Atualizar = copiar de novo da mesma origem, revisar o diff e registrar o commit aqui.

| Skill | Origem (commit) | Licença | Conteúdo | Uso na Tucaí |
|---|---|---|---|---|
| `supabase` | supabase/agent-skills (0.1.2) | MIT | markdown | Auth, RLS, Supabase em geral |
| `supabase-postgres-best-practices` | supabase/agent-skills (1.1.1) | MIT | markdown | migrations, índices, RLS, consultas |
| `frontend-design` | anthropics/skills `skills/frontend-design` (2c5958e) | Apache-2.0 | 1 SKILL.md | direção visual, tipografia, evitar aparência genérica de IA |
| `web-design-guidelines` | vercel-labs/agent-skills `skills/web-design-guidelines` (1a2c79d) | MIT | 1 SKILL.md; busca as regras em raw.githubusercontent.com/vercel-labs/web-interface-guidelines a cada uso (só leitura) | revisão de acessibilidade, formulários, navegação, responsividade |
| `vercel-react-best-practices` | vercel-labs/agent-skills `skills/react-best-practices` (1a2c79d) | MIT | SKILL.md + 72 regras | desempenho e organização React (partes de Next.js não se aplicam: o app é Vite) |
| `differential-review` | trailofbits/skills `plugins/differential-review` (149d7b2) | CC-BY-SA-4.0 | markdown | revisão de segurança do diff antes do merge |
| `sharp-edges` | trailofbits/skills `plugins/sharp-edges` (149d7b2) | CC-BY-SA-4.0 | markdown (agents/openai.yaml removido) | APIs e configurações perigosas (auth, JS, config) |
| `ui-ux-pro-max` | nextlevelbuilder/ui-ux-pro-max-skill `.claude/skills/ui-ux-pro-max` (6ae86f6, v2.15.0) | MIT | SKILL.md + dados CSV + 4 scripts Python (só biblioteca padrão, sem rede; testes do autor não copiados) | acessibilidade, toque, formulários e navegação dos painéis; identidade da Tucaí preservada (nota no SKILL.md) |
| `tucai-release-audit` | própria | — | SKILL.md + 2 scripts próprios | auditoria de lançamento (12 áreas) |

Avaliadas e NÃO instaladas (ver motivo):
- `webapp-testing` (anthropics): script Python `with_server.py`; duplica o Playwright já usado (`scripts/e2e-homologacao.mjs`, `responsive-audit.cjs`).
- taste (tyfarrago-hub): `quieter`/`polish` exigem `impeccable` (58 arquivos, 21 scripts); `redesign-existing-projects` recomenda imagens de placeholder (proibido em produção) e é de origem sem licença.
- trailofbits `insecure-defaults`, `static-analysis`, `supply-chain-risk-auditor`: dependem de scripts/ferramentas (Semgrep, CodeQL, Python com rede); `npm audit` e `check-secrets` cobrem o básico. Instalar só com aprovação.
