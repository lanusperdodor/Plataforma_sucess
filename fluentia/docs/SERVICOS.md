# Serviços externos, custos e configuração

O app funciona sem nenhum serviço pago: lições, exercícios, revisões, estatísticas, síntese e reconhecimento de voz (do próprio Android) são gratuitos e locais. Só o **professor de IA** (conversa, correção de redações, geração de lições) e a **avaliação fonética** opcional dependem de serviços externos. Nada é contratado automaticamente.

## Por que existe um backend

Chaves de API nunca vão dentro do APK (qualquer um extrairia). O projeto inclui `backend/`, um Cloudflare Worker que:

- guarda a chave do provedor de IA como segredo;
- exige um token pessoal seu (`APP_TOKEN`) em cada requisição;
- limita requisições (20/min e um teto diário configurável) como trava de custo;
- registra só metadados técnicos (rota, status, duração) — nunca o conteúdo.

O app guarda a URL do backend e o token no armazenamento seguro do Android (Keystore).

### Custo do backend

Cloudflare Workers tem plano gratuito (na data desta documentação, 100 mil requisições por dia), muito acima do uso pessoal. Confira em developers.cloudflare.com/workers/platform/pricing.

### Publicar o backend

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
