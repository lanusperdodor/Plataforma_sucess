# Plataforma Regional (nome provisório)

Delivery regional (Itaú de Minas/MG → Brasil). React + TypeScript + Vite + Tailwind + Supabase.

## Rodar localmente
```bash
npm install
cp .env.example .env.local   # preencha URL e chave anon do SEU projeto Supabase
npm run dev
```
Scripts: `typecheck`, `lint`, `test -- --run`, `build`.

## Banco
Migrations em `supabase/migrations`. Aplicar com Supabase CLI (`supabase link` + `supabase db push`). Nunca use `service_role` no frontend.

## Documentos
`ARQUITETURA.md` · `REGRAS_COMERCIAIS.md` · `PROGRESSO.md` · `PROXIMOS_PASSOS.md` · `.kiro/steering` · `.kiro/specs`

## Deploy
Cloudflare Pages (free): build `npm run build`, saída `dist`. Não feito; requer sua autorização e conta.
