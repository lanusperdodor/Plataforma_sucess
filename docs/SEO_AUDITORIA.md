# Tucaí — Auditoria de SEO e plano (Fase 1)

Data: 11/11/2026 · Site auditado: `https://plataforma-sucess.marcossonopi.workers.dev` (build atual da `main`).
Escopo desta fase: só diagnóstico e plano. Nada foi alterado no site, no banco ou no Cloudflare.

## 1. Resumo

| Item | Situação | Gravidade |
|---|---|---|
| Rotas acessadas direto (`/restaurantes`, `/lojas/x`, `/entrar`…) | **HTTP 404 com corpo vazio**: só `/` funciona; links compartilhados, atualizar a página e o Google recebem 404 | **Crítica** |
| Renderização | 100% no cliente (React SPA). Sem JavaScript aparece só “Carregando o Tucaí…” | Alta |
| Título/descrição por página | Um único `<title>` e `description` para todas as rotas; o app não altera `document.title` | Alta |
| Canonical | Não existe | Alta |
| `sitemap.xml` | Não existe (404) | Alta |
| `robots.txt` | Existe, mas é o gerado pela Cloudflare (só “content signals”, sem `Sitemap:` nem regras próprias) | Média |
| `noindex` em áreas privadas | Não existe | Média |
| Open Graph / Twitter | Só `og:title` e `og:site_name`; sem imagem, URL, descrição e `twitter:card` | Média |
| Dados estruturados (JSON-LD) | Não existem | Média |
| Analytics / Pixel / consentimento | Não existem (a política declara que não há rastreamento hoje: correto) | — |
| Desempenho (celular simulado Moto G4, CPU 4× mais lenta) | FCP 1,0 s · **LCP 2,7 s** (limite “bom”: 2,5 s) · CLS 0 | Média |
| Carregamento inicial | ~600 KB de JS (≈177 KB comprimido) em 8 arquivos; cache imutável em `/assets` correto | Média |
| Acessibilidade básica | `lang="pt-BR"`, link “Pular para o conteúdo”, imagens com `alt`, um `<h1>` na home | Boa |
| Segurança | CSP, HSTS, X-Frame-Options e demais cabeçalhos de `public/_headers` aplicados | Boa |

## 2. Achados em detalhe

### 2.1 Hospedagem e roteamento (crítico)
- O repositório não tem `wrangler.jsonc`/`wrangler.toml`: o projeto foi ligado ao Cloudflare pelo painel (Workers com arquivos estáticos).
- Não há regra de SPA (`not_found_handling: "single-page-application"`) nem Worker próprio. Resultado medido:
  `GET /` → 200; `GET /restaurantes`, `/restaurantes/qualquer`, `/entrar`, `/admin` → **404, 0 bytes**.
- A navegação dentro do app funciona (o React troca a rota sem pedir ao servidor), por isso o problema passa despercebido.
- **Correção necessária antes de qualquer SEO**: configurar o Worker (ver plano, Fase 2). Isso muda a configuração de deploy e exige sua autorização.

### 2.2 Renderização e conteúdo indexável
- O Google executa JavaScript, mas com atraso e sem garantia. Outros buscadores e as prévias de WhatsApp/Facebook **não executam JS**: hoje veem só o HTML base, igual para todas as páginas.
- Conclusão: não é preciso migrar para SSR completo. O caminho de menor risco é um **Worker na borda** que:
  1. serve os arquivos estáticos e devolve o `index.html` (HTTP 200) para rotas do app e 404 de verdade para URLs inexistentes;
  2. **injeta no HTML** título, descrição, canonical, Open Graph e JSON-LD de cada página pública (HTMLRewriter), lendo dados públicos do Supabase (mesmas permissões de um visitante);
  3. inclui um bloco de conteúdo visível (h1, texto, lista de links) que o React substitui ao iniciar;
  4. gera `sitemap.xml` e `robots.txt`.
  O frontend React continua igual.

### 2.3 Rotas
| Pública e indexável | Pública, sem indexar | Privada (noindex) |
|---|---|---|
| `/`, `/restaurantes`, `/lojas`, `/servicos`, `/vagas`, `/restaurantes/:slug`, `/lojas/:slug`, `/servicos/:slug`, `/vagas/:id`, `/entregadores`, `/cadastrar-negocio` (página de captação), `/privacidade`, `/termos` | `/busca`, `/explorar` (repete listagens), `/armazenamento`, `/conectuai/*` (conteúdo de pessoas; decisão sua) | `/entrar`, `/cadastro`, `/recuperar-senha`, `/nova-senha`, `/conta`, `/perfil/*`, `/sacola`, `/sacola/checkout`, `/pedidos/*`, `/notificacoes`, `/painel/*`, `/entregador/*`, `/admin/*`, `/vagas/minhas-candidaturas` |

- **Duplicidade**: `BusinessPage` abre qualquer slug em `/restaurantes/`, `/lojas/` e `/servicos/`, então uma loja aparece em três URLs. O Worker deve redirecionar (301) para a URL do tipo correto e o canonical deve apontar para ela.
- **Não existem URLs de cidade**: a cidade fica só no aparelho (seletor). Para SEO regional são necessárias rotas como `/cidades/passos-mg` e `/cidades/passos-mg/restaurantes`. Os slugs já existem no banco (`passos-mg`).

### 2.4 Dados disponíveis hoje (consultados como visitante)
- 58 cidades ativas, 23 categorias, **0 estabelecimentos públicos, 0 produtos, 0 vagas**.
- Pela regra do brief (não publicar cidade sem operação real), o sitemap hoje teria só a home e as páginas institucionais. Cidades entram automaticamente quando tiverem estabelecimento ativo.
- `public_businesses` não expõe `updated_at` (decisão anterior, coberta por teste). Para preencher `lastmod` com datas reais, proponho uma função pública só de leitura `sitemap_entries()` (slug, tipo, cidade, data de atualização), que já exclui dados de demonstração e os **dados de teste** criados pelo Painel Master.
- Estabelecimentos “[Teste]” precisam ficar fora do sitemap e com `noindex`.

### 2.5 Desempenho
- Elemento de LCP na home: área do mascote (PNG pré-carregado de 250 KB e vídeo de 1,7 MB).
- Oportunidades sem perder função: WebP/AVIF para o mascote; garantir que o vídeo carregue depois do primeiro desenho; avaliar tirar `supabase-js` do carregamento inicial nas páginas institucionais; revisar o chunk `schemas` (91 KB).
- Fontes: só fonte do sistema (bom). Cache de `/assets` com `immutable` (bom). HTML com `max-age=0, must-revalidate` (correto para deploys).

### 2.6 Visual (menor)
- No celular, o nome da cidade no topo fica cortado (“Itaú de …”).

## 3. Plano por fase

**Fase 2: base técnica de indexação** (precisa da sua autorização para mudar a configuração de deploy)
- `wrangler.jsonc` versionado + Worker (`worker/index.ts`) com assets, fallback de SPA, 404 real e `X-Robots-Tag: noindex` nas rotas privadas.
- Variável `SITE_URL` (domínio canônico configurável; hoje o `workers.dev`) e `ALLOW_INDEXING` (homologação nunca indexa).
- Títulos e descrições por página (estáticos e a partir de dados reais de cidade e estabelecimento), canonical e redirecionamentos 301 de duplicidades.
- `robots.txt` próprio com `Sitemap:` absoluto; `sitemap.xml` (índice quando passar de 1 arquivo) gerado do banco, com cache curto na borda.
- Migration com `sitemap_entries()` e rotas `/cidades/:slug[/:seção]` no app.

**Fase 3: compartilhamento e dados estruturados**
- Open Graph/Twitter completos e imagem de compartilhamento 1200×630 feita com o logotipo e o mascote existentes.
- JSON-LD: `Organization` e `WebSite` (home); `BreadcrumbList`; `Restaurant`/`LocalBusiness` (com horário e endereço só quando cadastrados); `JobPosting` (só vagas abertas e válidas); `Product`/`Offer` só se houver página própria de produto. Sem avaliações, preços ou horários inventados.

**Fase 4: GA4, Meta Pixel e consentimento**
- Gerenciador de preferências (necessários / análise / marketing), registro do consentimento e opção de alterar depois; nada de terceiros carrega antes do aceite. Google Consent Mode v2.
- Eventos só nas ações reais: `purchase` e `Purchase` quando o pedido for **concluído** (entregue/retirado), não ao enviar. `event_id` para deduplicar com a futura Conversions API. Sem nome, e-mail, telefone ou endereço.
- Ajuste da CSP para os domínios do Google e da Meta, só quando os IDs existirem; atualização do inventário LGPD e da política.

**Fase 5: desempenho e homologação**
- Imagens otimizadas, revisão dos chunks e testes automatizados das metatags, sitemap, robots, noindex, JSON-LD e eventos sem duplicação.

## 4. O que preciso de você
1. **Autorização** para versionar a configuração do Worker (muda como o Cloudflare publica o site) e confirmar como o deploy está ligado: Workers Builds pelo painel, com qual comando de build/deploy.
2. **Domínio definitivo**, quando escolher (até lá o canônico fica no `workers.dev`).
3. **Search Console**: o código da metatag (ou o nome do arquivo HTML) que o Google mostrar. Verificação por DNS só com o domínio próprio.
4. **GA4**: o ID de medição (`G-…`). **Meta Pixel**: o Pixel ID.
5. Decisão: o **Conectuaí** (perfis e publicações públicas) deve aparecer no Google? Proposta: não, por enquanto.
6. Revisão jurídica do texto de cookies e da política antes de ativar marketing.

Bloqueio desta fase: nenhum. O acesso ao endereço do site foi liberado nesta sessão para medir o que os buscadores recebem.
