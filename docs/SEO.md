# SEO da Tucaí — operação

## Como funciona
- `wrangler.jsonc` publica o Worker `src/worker/index.ts` junto com os arquivos de `dist/`.
- Toda rota do app responde **200** com o `index.html` reescrito na borda: `<title>`, `description`, `canonical`,
  `og:title/description/url` e `robots` próprios da página. URL inexistente responde **404**.
- Os metadados saem de funções públicas do banco (`supabase/migrations/0017_seo.sql`): `seo_business`, `seo_city`,
  `seo_job` e `sitemap_entries`. Elas ignoram dados de demonstração, estabelecimentos não aprovados e os dados de teste do Painel Master.
- No navegador, `src/seo/RouteMeta.tsx` aplica a mesma lógica (`src/seo/resolve.ts`) a cada troca de rota.
- `/robots.txt` e `/sitemap.xml` são gerados pelo Worker. Cidade só entra com estabelecimento ativo ou vaga aberta.
- Áreas privadas (login, conta, pedidos, sacola, painéis, entregador, admin) e o Conectuaí respondem `noindex`.
- Uma loja aberta pela seção errada (`/restaurantes/<loja>`) é redirecionada (301) para a URL certa.

## Variáveis (wrangler.jsonc → vars)
| Variável | Uso |
|---|---|
| `SITE_URL` | Domínio canônico, sem barra final. Hoje: `https://plataforma-sucess.marcossonopi.workers.dev` |
| `ALLOW_INDEXING` | `"true"` só em produção. Fora do domínio de `SITE_URL` o Worker responde `noindex` e o robots bloqueia tudo |

## Ao escolher o domínio oficial
1. Ligar o domínio ao Worker no painel da Cloudflare (Workers → plataforma-sucess → Domains & Routes).
2. Trocar `SITE_URL` em `wrangler.jsonc` e publicar. A partir daí o `workers.dev` passa a responder `noindex` sozinho.
3. Opcional: redirecionar o `workers.dev` para o domínio novo (regra de redirecionamento na Cloudflare).
4. Search Console: adicionar a propriedade de domínio (verificação por DNS, TXT no domínio) e enviar `https://<domínio>/sitemap.xml`.
5. Revisar GA4 e Meta Pixel (Fase 4) para o domínio novo.

## Google Search Console (domínio atual)
- `workers.dev` não permite verificação por DNS (o domínio é da Cloudflare). Use **prefixo de URL** com a metatag HTML.
  Quando o Google mostrar o código (`<meta name="google-site-verification" content="...">`), ele entra no Worker/HTML em uma mudança pequena.
- Depois de verificado: Sitemaps → enviar `sitemap.xml`. O Google só indexa depois de rastrear; acompanhe em “Páginas”.

## Testar localmente
```
npm run build
npx wrangler dev
```
Abra `/robots.txt`, `/sitemap.xml`, `/restaurantes` e veja o código-fonte (Ctrl+U): título e canonical já vêm no HTML.

## GA4, Meta Pixel e consentimento (Fase 4)
- IDs em `wrangler.jsonc → vars`: `GA4_ID` (formato `G-XXXX`) e `META_PIXEL_ID` (só números). Vazios = nada carrega e o aviso de cookies não aparece.
- Com ID configurado, o Worker escreve `<meta name="tucai:ga4-id">`/`<meta name="tucai:meta-pixel-id">` e amplia a CSP **só** com os domínios da ferramenta ativa.
- O app (`src/components/consent/ConsentManager.tsx`) mostra o aviso (Aceitar, Recusar, Personalizar). Scripts do Google/Meta só são baixados depois do aceite da categoria:
  estatísticas → GA4; marketing → Pixel. Recusar não limita o site. A escolha fica em `consent:v1` (com data e versão do aviso) e pode ser mudada em `/armazenamento`.
- Google Consent Mode v2: `analytics_storage` conforme a escolha; `ad_storage`, `ad_user_data` e `ad_personalization` sempre negados (sem Google Ads).
- Eventos (`src/features/tracking/tracker.ts`), sem nome, e-mail, telefone ou endereço, valores em BRL:

| Ação real | GA4 | Meta Pixel |
|---|---|---|
| Trocar de página | `page_view` (1 por rota) | `PageView` |
| Ver lista de estabelecimentos | `view_item_list` | — |
| Clicar num estabelecimento da lista | `select_item` | — |
| Abrir página do estabelecimento | `view_item` | `ViewContent` |
| Adicionar à sacola | `add_to_cart` | `AddToCart` |
| Abrir o checkout | `begin_checkout` | `InitiateCheckout` |
| Pedido **entregue ou retirado** | `purchase` (1 por pedido) | `Purchase` |
| Buscar | `search` | `Search` |
| Criar conta | `sign_up` | `CompleteRegistration` |
| Entrar | `login` | — |

- Deduplicação: cada evento leva `event_id`/`eventID`; a compra usa `purchase-<id do pedido>`, pronto para a futura Conversions API.
- Pendência jurídica: revisar o texto do aviso e da política antes de ativar o marketing.
