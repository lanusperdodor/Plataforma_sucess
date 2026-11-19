# Publicação nas lojas (Google Play e App Store)

> **Decisão (2026-11-19): por enquanto a Tucaí é distribuída SÓ pelo navegador** (instalação pela página `/app`, sem lojas).
> O app nativo (`mobile/`) e os prints (`store-screenshots/`) ficam guardados para quando decidirmos publicar nas lojas.
> Antes de publicar nas lojas será preciso: login com Google pelo navegador do sistema, "Entrar com Apple", notificação
> nativa e esconder a compra de planos no iPhone. Suporte: suportetucai@gmail.com.

Há três formas de ter a Tucaí no celular:
1. **Pelo site, hoje, sem loja:** página `/app` ("Baixe o app"). No Android tem o botão Instalar; no iPhone, Compartilhar → Adicionar à Tela de Início.
2. **App nativo (React Native + Expo):** projeto em `mobile/`. Veja `mobile/README.md` (QR Code, builds e envio).
3. **Lojas:** Google Play e App Store, com os textos e prints abaixo.

## Textos da loja (pt-BR)

**Nome do app:** Tucaí

**Subtítulo (App Store, até 30 caracteres):** Delivery e comércio da cidade

**Descrição curta (Google Play, até 80 caracteres):** Peça comida, compre no comércio local e acompanhe a entrega no mapa.

**Descrição completa:**

> Tucaí: tudo junto, tudo aí. O app do comércio da sua cidade.
>
> 🍔 Peça dos restaurantes, lanchonetes, pizzarias e marmitarias perto de você, para entregar ou retirar no balcão.
> 🛍️ Compre nas lojas da cidade: farmácia, moda, mercado e muito mais.
> 🔧 Encontre serviços e profissionais da região.
> 📍 Acompanhe o pedido em tempo real: preparo, saída e o entregador chegando no mapa.
> 💬 Pague na entrega ou na retirada: dinheiro, Pix ou cartão na maquininha.
> 💼 Veja vagas de emprego no comércio local.
> 👥 Conectuaí: a rede social da sua região.
>
> Para entregadores: receba corridas de todas as lojas da cidade, com aviso sonoro de corrida nova, rota pelo GPS até o restaurante e até o cliente, e acompanhe seus ganhos e saques.
>
> Para lojistas: cardápio, pedidos, equipe, entregas próprias ou com entregadores parceiros, caixa e relatórios num só painel.
>
> Valorize o comércio da sua cidade. Baixe a Tucaí.

**Palavras-chave (App Store, até 100 caracteres):** delivery,comida,lanche,pizza,marmita,loja,mercado,farmácia,entrega,entregador,cidade,comércio

**Categoria:** Comida e Bebida (principal) · Compras (secundária)

**Classificação etária:** Livre / 4+ (sem conteúdo restrito). A rede social Conectuaí tem denúncia e moderação; responda o questionário com "conteúdo gerado por usuários: sim, com moderação".

**Links obrigatórios:**
- Política de privacidade: https://plataforma-sucess.marcossonopi.workers.dev/privacidade
- Termos de uso: https://plataforma-sucess.marcossonopi.workers.dev/termos
- Suporte: suportetucai@gmail.com

**Privacidade nas lojas ("Segurança dos dados" / "App Privacy"):** dados coletados = nome, e-mail, telefone, endereço de entrega, localização precisa (só entregador, durante a entrega), fotos enviadas pela pessoa e histórico de pedidos. Nenhum dado é vendido. A pessoa pode pedir a exclusão da conta em Perfil → Privacidade.

**Conta de teste para os revisores (obrigatório):** crie uma conta de cliente e uma de entregador só para a revisão e informe e-mail e senha no formulário de envio. Não use contas reais.

## Prints (gerados com a skill app-store-screenshots)

Em `store-screenshots/exports/`:

| Pasta | Onde usar | Tamanho |
|---|---|---|
| `ios-6.9/` | App Store, iPhone 6,9" | 1320×2868 |
| `ios-6.5/` | App Store, iPhone 6,5" | 1284×2778 |
| `android-telefone/` | Google Play, telefone | 1080×1920 |
| `google-play-banner/` | Google Play, imagem de destaque | 1024×500 |

As telas dos prints foram capturadas do app de verdade, rodando localmente com **dados de exemplo** (Burguer do Tuca, Pizzaria Forno a Lenha…). Nada foi criado na produção. Quando houver lojas reais, recapture com elas.

Para editar textos e layout dos prints:

```bash
cd store-screenshots
```

```bash
npm install
```

```bash
npm run dev
```

Abra http://localhost:3000, ajuste e clique em **Export bundle**.

Ícone do app: `mobile/assets/icon.png` (1024×1024).

## Passo a passo do envio
1. Criar as contas (Expo, Google Play Console US$ 25, Apple Developer US$ 99/ano).
2. `eas build --platform all --profile production` (o EAS cria e guarda os certificados).
3. Google Play Console: criar o app, preencher os textos acima, enviar o AAB (`eas submit --platform android`), teste interno, depois produção.
4. App Store Connect: criar o app com o bundle `br.com.tucai.app`, preencher os textos, enviar o build (`eas submit --platform ios`), informar a conta de teste, enviar para revisão.
5. Depois da aprovação: colocar os links das lojas na página `/app` do site.
