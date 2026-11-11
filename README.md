# Tucaí — Tudo junto. Tudo aí.

Delivery regional (Itaú de Minas/MG → Brasil). React + TypeScript + Vite + Tailwind + Supabase.

## Rodar localmente
```bash
npm install
cp .env.example .env.local   # preencha URL e chave anon do SEU projeto Supabase
npm run dev
```
Scripts: `typecheck`, `lint`, `test -- --run`, `build`, `test:sql` (PostgreSQL local descartável; ver PROXIMOS_PASSOS.md).

## Banco
Migrations em `supabase/migrations`. Aplicar com Supabase CLI (`supabase link` + `supabase db push`). Nunca use `service_role` no frontend.
Primeiro administrador: `supabase/admin/bootstrap_first_master.sql` (manual, uma vez). Painel Master em `/admin`.

## Documentos
`AUDITORIA.md` (estado real dos módulos) · `ARQUITETURA.md` · `REGRAS_COMERCIAIS.md` · `PROGRESSO.md` · `PROXIMOS_PASSOS.md` · `.kiro/steering` · `.kiro/specs`

## Deploy
Cloudflare Pages (free): build `npm run build`, saída `dist`. Não feito; requer sua autorização e conta.

## Visualizar com F5 no Kiro
Com esta pasta aberta e confiável, pressione F5 e escolha Projeto Milhão — abrir no navegador, se solicitado. O Vite inicia em http://127.0.0.1:5173 e o navegador padrão abre automaticamente. Alterações aparecem automaticamente. Shift+F5 encerra o servidor. Sem configuração do Supabase, a interface abre, mas cadastro e login ficam indisponíveis. Se a porta 5173 estiver ocupada, encerre a execução anterior antes de iniciar outra.
