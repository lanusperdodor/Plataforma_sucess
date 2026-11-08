# Spec Fundação — Tasks (status real)

Legenda: [x] feito e verificado · [~] verificado localmente, falta Supabase real · [ ] pendente

- [x] 1. Steering e specs
- [x] 2. Scaffold Vite/React/TS/Tailwind, tokens, brand (Vite 8, Vitest 5, Router 7, Zod 4; audit 0)
- [x] 3. Motor de preços puro + testes (28/50/56/64, 4+2=5+1, próprio, retirada)
- [~] 4. Migração 0001 + testes SQL: passam em PostgreSQL 18 descartável com stub de `auth`; falta rodar no Supabase
- [x] 5. Matriz de permissões + testes (isolamento entre empresas, bloqueio)
- [~] 6. Cliente Supabase + AuthProvider (corrida entre usuários, erros, recuperação) — testado com cliente simulado
- [~] 7. Telas login/cadastro/recuperação/nova senha/conta + rota protegida — testadas com cliente simulado
- [x] 8. typecheck + lint + build + vitest completos (45 testes)
- [x] 9. README / PROGRESSO / PROXIMOS_PASSOS
- [ ] 10. Supabase de teste: aplicar 0001, testes SQL reais, smoke de auth com e-mail real, Redirect URL `/nova-senha`
- [ ] 11. Primeiro `platform_master` via SQL + MFA
- [ ] 12. E2E Playwright de auth contra o Supabase de teste
