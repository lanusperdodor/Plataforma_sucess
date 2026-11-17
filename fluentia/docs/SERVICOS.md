# Serviços externos, custos e configuração

O app funciona sem nenhum serviço pago, inclusive o professor de IA no modo grátis (Gemini): lições, exercícios, revisões, estatísticas, síntese e reconhecimento de voz (do próprio Android) são gratuitos e locais. Só o **professor de IA** (conversa, correção de redações, geração de lições) e a **avaliação fonética** opcional dependem de serviços externos. Nada é contratado automaticamente.

## Jeito simples e grátis (recomendado): Google Gemini direto no app

Sem servidor, sem Cloudflare, sem cartão:

1. No celular ou computador, abra **https://aistudio.google.com/apikey** e entre com sua conta Google.
2. Toque em **Create API key** (Criar chave de API) e copie a chave (começa com `AIza`).
3. No Fluentia: **Perfil → Inteligência artificial → Simples e grátis** → cole a chave → **Salvar e testar**.
   O app escolhe sozinho um modelo "Flash" disponível para a sua chave e mostra "Conectado. Provedor: Google Gemini".

Como funciona e o que saber:
- O app fala direto com a API do Gemini (formato compatível com "chat completions"). A chave é **sua**, digitada no app e guardada no Keystore do aparelho; ela **não** vem embutida no APK e **não** entra no backup.
- O nível gratuito tem limites por minuto e por dia (folgados para uso pessoal). Se estourar, o app avisa e você tenta mais tarde. Limites atuais: ai.google.dev/gemini-api/docs/rate-limits.
- No nível gratuito, o Google pode usar o conteúdo enviado para melhorar os produtos dele. Não escreva dados pessoais sensíveis nas conversas. Detalhes: ai.google.dev/gemini-api/terms.
- A avaliação fonética não existe nesse modo (só no modo "meu backend" com Azure).
- Testado com respostas simuladas; a primeira chamada real é a sua (não havia chave nesta sessão).

## Modo avançado: backend próprio (Cloudflare + Claude)

### Por que existe um backend

Chaves de API nunca vão dentro do APK (qualquer um extrairia). O projeto inclui `backend/`, um Cloudflare Worker que:

- guarda a chave do provedor de IA como segredo;
- exige um token pessoal seu (`APP_TOKEN`) em cada requisição;
- limita requisições (20/min e um teto diário configurável) como trava de custo;
- registra só metadados técnicos (rota, status, duração) — nunca o conteúdo.

O app guarda a URL do backend e o token no armazenamento seguro do Android (Keystore).

### Custo do backend

Cloudflare Workers tem plano gratuito (na data desta documentação, 100 mil requisições por dia), muito acima do uso pessoal. Confira em developers.cloudflare.com/workers/platform/pricing.

### Publicar o backend — opção 1: pelo navegador (sem instalar nada)

1. Gere o arquivo único do backend (no computador com o projeto): `cd fluentia/backend && npx wrangler deploy --dry-run --minify --outdir para-colar` — ou use o `fluentia-backend.js` já gerado e enviado junto com esta entrega.
2. Em **dash.cloudflare.com → Workers & Pages → Create → Create Worker**, dê o nome exato **`fluentia-backend`** e clique em **Deploy** (publica um "Hello World" provisório).
3. Clique em **Edit code**, apague todo o conteúdo do editor, cole o conteúdo inteiro de `fluentia-backend.js` e clique em **Deploy**.
4. **Settings → Runtime → Compatibility flags**: adicione `nodejs_compat` (e use compatibility date `2026-11-01` ou mais recente).
5. **Settings → Variables and Secrets → Add**, tipo **Secret**:
   - `APP_TOKEN` — uma senha longa que você inventa (32+ caracteres). É ela que você digita no app.
   - `ANTHROPIC_API_KEY` — sua chave em console.anthropic.com → API Keys (a conta precisa de créditos; defina um limite de gastos em Billing → Limits).
   Opcionais (tipo Text; sem eles valem os padrões): `ANTHROPIC_MODEL` (padrão `claude-opus-5-5`), `ANTHROPIC_EFFORT` (`low`), `DAILY_REQUEST_LIMIT` (`300`), `PROVIDER` (`anthropic`).
6. Abra https://fluentia-backend.marcossonopi.workers.dev — deve aparecer **"Fluentia backend online"**. (A página "There is nothing here yet" significa que o Worker ainda não foi publicado com esse nome.)

Sempre que o código do backend mudar, repita os passos 1 e 3.

### Publicar o backend — opção 2: pelo terminal

```bash
cd fluentia/backend
npm install
npx wrangler login                       # conta Cloudflare gratuita
npx wrangler secret put APP_TOKEN        # invente uma senha longa (32+ caracteres)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy                      # publica em https://fluentia-backend.marcossonopi.workers.dev
```

No app: Perfil → Inteligência artificial. O endereço `https://fluentia-backend.marcossonopi.workers.dev` já vem preenchido (é o nome do Worker em `backend/wrangler.jsonc` na sua conta Cloudflare `marcossonopi`); cole o mesmo `APP_TOKEN` → **Salvar e testar**. Se publicar com outro nome ou domínio, troque o endereço nessa tela (ou em `DEFAULT_BACKEND_URL`, `src/services/aiRuntime.ts`).

## Provedor de IA

### Anthropic (padrão)

`PROVIDER=anthropic`, modelo em `ANTHROPIC_MODEL` (`wrangler.jsonc`). Preços por milhão de tokens (entrada / saída), na data desta documentação:

| Modelo | Entrada | Saída | Observação |
|---|---|---|---|
| `claude-opus-5-5` (padrão) | US$ 4 | US$ 20 | Melhor qualidade pedagógica |
| `claude-sonnet-5-5` | US$ 2 | US$ 10 | Meio-termo |
| `claude-haiku-5-5` | US$ 0,10 | US$ 0,50 | Bem mais barato; qualidade menor em correções sutis |

Estimativa de uma mensagem na conversa: ~2–4 mil tokens de entrada (instruções + histórico; as instruções fixas usam cache, que barateia as repetições) e ~0,3–1 mil de saída (resposta + raciocínio interno). Ordem de grandeza: **~US$ 0,02–0,04 por mensagem com Opus 5.5** e **~US$ 0,001 com Haiku 5.5**. Uma redação corrigida custa algumas vezes isso; gerar uma lição, ~US$ 0,10–0,25 com Opus. O esforço de raciocínio está em `ANTHROPIC_EFFORT=low` para conter custo.

Para trocar o modelo, edite `ANTHROPIC_MODEL` em `wrangler.jsonc` e rode `npx wrangler deploy`. A escolha entre qualidade e custo é sua.

Recomendações:
- Defina um **limite de gastos mensal** no console da Anthropic (console.anthropic.com → Billing → Limits).
- Ajuste o limite diário do app em Perfil → Inteligência artificial, e `DAILY_REQUEST_LIMIT` no backend.
- Preços atualizados: anthropic.com/pricing.

Em recusas de segurança do modelo, o backend usa o fallback automático do lado do servidor (parâmetro `fallbacks: "default"`) nos modelos que o suportam; se ainda assim houver recusa, o app mostra a mensagem em vez de inventar uma resposta.

### Alternativa: qualquer API compatível com "chat completions"

`PROVIDER=openai-compatible` com os segredos `OPENAI_API_KEY`, `OPENAI_BASE_URL` e `OPENAI_MODEL`. Vários provedores oferecem cotas gratuitas nesse formato. A qualidade das correções e do formato JSON varia por modelo; esse caminho foi testado só com respostas simuladas.

## Voz

| Recurso | Onde roda | Custo | Envio de dados |
|---|---|---|---|
| Síntese (o professor falando) | `expo-speech`, vozes do Android | grátis | não sai do aparelho |
| Reconhecimento (sua fala → texto) | `expo-speech-recognition`, serviço do Android (Google) | grátis | o Android pode processar o áudio na nuvem do Google; há pacotes offline por idioma |
| Avaliação fonética (opcional) | Azure AI Speech, via backend | ver abaixo | a gravação da frase, só quando você toca em "Avaliação fonética" |

### Avaliação fonética (opcional)

Reconhecimento de fala e avaliação de pronúncia são coisas diferentes. Sem um serviço fonético, o app mostra apenas o que foi reconhecido e onde a transcrição diferiu da frase — e diz isso claramente, sem inventar nota.

O backend tem integração com a Avaliação de Pronúncia do Azure AI Speech (precisão de fonemas, fluência, completude e, em inglês, prosódia). O Azure tem um nível gratuito (F0) com algumas horas de áudio por mês; confira em azure.microsoft.com/pricing/details/cognitive-services/speech-services. Para ativar:

```bash
npx wrangler secret put AZURE_SPEECH_KEY
npx wrangler secret put AZURE_SPEECH_REGION    # ex.: brazilsouth
npx wrangler deploy
```

Depois, no app, **Salvar e testar** de novo em Perfil → Inteligência artificial; o botão "Avaliação fonética" aparece após cada gravação (Android 13+, que permite guardar o áudio reconhecido).

**Atenção:** essa integração foi escrita conforme a documentação pública e testada só com respostas simuladas; ainda não foi validada contra uma conta Azure real.
