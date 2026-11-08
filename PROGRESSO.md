# Progresso

## Fase 1 — Fundação (parcial)

**Verificado de fato (Node 22 + TypeScript 5.9 estrito):**
- `pricing.ts`: 14 testes passando (R$ 28/50/56/64, 4+2=5+1, entrega própria, retirada, conservação de valores, snapshot).
- `permissions.ts`: 7 testes passando (bloqueio sem sessão, isolamento entre empresas, limites de cargo, master x operador).
- Typecheck estrito dos dois módulos: OK.
- Método: os arquivos `*.test.ts` reais rodaram com um shim do `vitest` sobre `node:test` em /tmp (fora do repo).

**Escrito mas NÃO verificado:**
- Frontend (Vite/React/Tailwind, auth, telas), `eslint`, `vite build`: o sandbox não tem acesso ao npm (403). Versões em `package.json` não foram conferidas no registry.
- `supabase/migrations/0001_foundation.sql` e `supabase/tests/rls_foundation.sql`: sem PostgreSQL no sandbox; nunca executados.

**Decisões assumidas (revisar):**
- Entrega própria: a taxa de R$ 1 é cobrada do restaurante (descontada do repasse).
- Comissão calculada sobre o subtotal de produtos; descontos ainda não modelados.
- Arredondamento half-up em centavos.

Ainda NÃO existe: loja, cardápio, pedidos, pagamentos, entregadores, mapa, Master. Nenhum critério de aceitação do MVP (seção 25) está cumprido.
