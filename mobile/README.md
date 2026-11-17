# App Tucaí (Android e iOS) — React Native + Expo

App nativo que abre a plataforma Tucaí por dentro e acrescenta recursos do celular:
- **GPS** liberado para a rota do entregador e o rastreio do cliente.
- **Som do pedido novo sem tocar na tela.** No app, a mídia toca sem gesto (`mediaPlaybackRequiresUserAction={false}`).
- **Câmera e galeria** para fotos.
- **Botão Voltar** do Android.
- **Links externos** (WhatsApp, telefone, mapas, pagamento) abrem fora do app.
- **Tela "Sem internet"** com o botão "Tentar de novo".
- **Links `tucai://pedidos/123`** abrem a tela certa.

Tudo o que muda no site aparece no app na hora, sem publicar versão nova.

## Rodar no computador e testar no celular (QR Code)

```bash
cd mobile
```

```bash
npm install
```

```bash
npx expo start
```

1. Instale o **Expo Go** no celular (Google Play ou App Store).
2. Escaneie o **QR Code** que aparece no terminal: no Android pelo próprio Expo Go, no iPhone pela câmera.
3. O celular e o computador precisam estar na mesma rede Wi-Fi. Se não estiverem, use `npx expo start --tunnel`.

Endereço do site: `app.json` → `expo.extra.siteUrl`. Troque quando o domínio oficial estiver no ar.

## Gerar os aplicativos para as lojas (EAS, nuvem da Expo)

Contas necessárias, que você cria e paga:

| Conta | Para quê | Custo |
|---|---|---|
| Expo (expo.dev) | compilar Android/iOS na nuvem | plano gratuito atende o começo |
| Google Play Console | publicar no Android | US$ 25, uma vez |
| Apple Developer Program | publicar no iPhone | US$ 99 por ano |

```bash
npm install -g eas-cli
```

```bash
eas login
```

```bash
eas build --platform android --profile preview
```

O comando acima gera um APK para instalar e testar direto no Android.

```bash
eas build --platform all --profile production
```

Esse gera o AAB (Google Play) e o IPA (App Store). Os **certificados e as chaves de assinatura** (Android keystore, certificados e perfis da Apple) são criados e guardados pelo EAS quando ele pergunta. Responda "sim". Nada disso vai para o GitHub.

```bash
eas submit --platform android
```

```bash
eas submit --platform ios
```

Identificadores: Android `br.com.tucai.app`, iOS `br.com.tucai.app`. Troque em `app.json` antes do 1º envio, se quiser outro. Depois do envio, eles não mudam mais.

## Antes de enviar para a Apple
- A Apple recusa apps que são "só um site dentro de um app" (regra 4.2). Este app já usa GPS nativo, câmera, som de pedido e funciona sem internet, o que ajuda.
- O próximo passo recomendado é a **notificação nativa** (`expo-notifications`) para o aviso de corrida com o app fechado. Isso aumenta a chance de aprovação e melhora o aviso do entregador.
- Textos, prints e certificados: veja `docs/LOJAS.md`.

## Conferências feitas
- `npx tsc --noEmit`: ok.
- `npx expo export --platform android --platform ios`: os pacotes JavaScript do Android e do iOS compilam.
