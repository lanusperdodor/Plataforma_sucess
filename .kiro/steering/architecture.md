---
inclusion: always
---

# Arquitetura

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS v4 + React Router + TanStack Query + react-hook-form + zod + lucide-react + motion (só quando CSS não bastar). PWA depois. Mapas: MapLibre (fase de rastreamento).
**Backend:** Supabase (Postgres, Auth, RLS, Storage, Realtime, Edge Functions). Regras críticas (preço, comissão, pagamento, aceite de corrida) no banco/Edge Functions.
**Hospedagem:** Cloudflare Pages Free (.pages.dev). Sem deploy em produção sem autorização do usuário.

## Pastas
- `src/config` marca/ambiente · `src/styles` tokens · `src/lib` utilitários puros (money, supabase client)
- `src/features/<modulo>` (auth, permissions, pricing, ...) · `src/components` UI reutilizável · `src/pages` rotas
- `supabase/migrations` SQL versionado · `supabase/functions` Edge Functions · `tests` · `docs`

## Princípios
- Multi-tenant: toda tabela de negócio tem `business_id` + RLS.
- Papéis: tabela `user_roles` (globais) e `business_members` (por empresa). Autorização final SEMPRE no banco.
- Frontend usa só `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Nunca `service_role`.
- Módulos futuros entram como novas tabelas/features, sem alterar o núcleo.
- Registrar decisões relevantes em `ARQUITETURA.md` (curto).
