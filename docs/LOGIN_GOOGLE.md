# Login com Google (Supabase Auth)

Diagnóstico feito em 12/11/2026 contra o projeto Supabase `folrcnsihpllvutnhdmy` (sem alterar nada no projeto):

| Verificação | Resultado |
|---|---|
| Provedor Google no Supabase (`/auth/v1/settings`) | **Ativado** (no momento do teste) |
| Supabase monta o redirecionamento para o Google (domínio Cloudflare e localhost) | OK — `client_id` 450243…, `redirect_uri=https://folrcnsihpllvutnhdmy.supabase.co/auth/v1/callback` |
| Google aceita esse `redirect_uri` | **NÃO** — Google responde `Error 400: redirect_uri_mismatch` |

O erro `Unsupported provider: provider is not enabled` aparece quando o provedor Google está desligado no Supabase
(Authentication → Sign In / Providers → Google). No teste ele já estava ligado; o bloqueio atual é no Google Cloud.

## 1. Google Cloud Console (manual)

Projeto do Google que contém o cliente OAuth com ID começando em `450243…`:

1. **APIs e serviços → Credenciais → IDs do cliente OAuth 2.0** → abrir o cliente (tipo **Aplicativo da Web**).
2. **URIs de redirecionamento autorizados** → adicionar exatamente:
   `https://folrcnsihpllvutnhdmy.supabase.co/auth/v1/callback`
   (é o endereço do Supabase, não o do site; não precisa colocar o domínio da Cloudflare nem localhost aqui).
3. **Origens JavaScript autorizadas** (opcional, recomendado):
   `https://plataforma-sucess.marcossonopi.workers.dev` e `http://localhost:5173`.
4. **Tela de consentimento OAuth**: nome do app (Tucaí), e-mail de suporte, domínio autorizado `supabase.co`
   (e o domínio oficial da Tucaí quando houver). Escopos: `email`, `profile`, `openid`.
   Se estiver em **Teste**, só os e-mails cadastrados em "Usuários de teste" conseguem entrar; para todos, **Publicar o app**.
5. Salvar. A mudança pode levar alguns minutos.

## 2. Supabase (manual)

1. **Authentication → Sign In / Providers → Google**: ativado, com o **Client ID** e o **Client Secret** do cliente acima.
   O Client Secret fica só no Supabase; nunca no código, no GitHub ou no Cloudflare.
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://plataforma-sucess.marcossonopi.workers.dev`
   - **Redirect URLs** (lista de permitidos), adicionar:
     - `https://plataforma-sucess.marcossonopi.workers.dev/**`
     - `http://localhost:5173/**`
     - (domínio oficial da Tucaí, quando houver: `https://SEU-DOMINIO/**`)
   Sem isso o Supabase ignora o retorno pedido pelo app e volta para a Site URL.
3. Manter as proteções: confirmação de e-mail, MFA do Master e "Allow new users to sign up" como estão.

## 3. O que o app faz (já no código)

- Botão "Continuar com Google" no login único e no cadastro → `supabase.auth.signInWithOAuth({ provider: 'google', redirectTo: <origem>/entrar })`.
- Na volta, o Supabase grava a sessão no navegador; o login único reconhece o perfil e abre o painel:
  Master → `/admin` (MFA continua exigido no painel), empresário → painel da loja, funcionário → pedidos,
  entregador → entregas, cliente → área do cliente.
- Conta nova pelo Google: perfil criado automaticamente como **cliente** (gatilho `handle_new_user`); nenhum papel
  administrativo é concedido. Conta já existente com o mesmo e-mail verificado é vinculada pelo Supabase, mantendo papéis.
- Se o Google/Supabase devolver erro (cancelado, endereço não autorizado, provedor desligado), a tela de login mostra o motivo em português.

## 4. Como conferir depois de configurar

1. Abrir `https://plataforma-sucess.marcossonopi.workers.dev/entrar` → "Continuar com Google".
2. Deve abrir a tela de escolha de conta do Google (sem "Error 400").
3. Depois de escolher a conta, volta para a Tucaí já logado e no painel do seu perfil.
