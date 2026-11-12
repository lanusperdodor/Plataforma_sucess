# E-mails da Tucaí (Supabase Auth)

Os e-mails de cadastro, recuperação de senha, convite da equipe e link de acesso são enviados pelo **Supabase Auth**.
Os modelos em português, com a marca Tucaí, estão em `supabase/templates/`. Eles não ficam no app: precisam ser colados no painel do Supabase.

## Onde colar (Supabase → Authentication → Emails → Templates)

| Modelo no Supabase | Assunto sugerido | Arquivo |
|---|---|---|
| Confirm signup | Confirme seu e-mail na Tucaí | `confirmacao-cadastro.html` |
| Invite user | Você foi convidado para a Tucaí | `convite.html` |
| Magic Link | Seu link de acesso à Tucaí | `link-de-acesso.html` (é o que chega no convite da aba Equipe) |
| Change Email Address | Confirme seu novo e-mail na Tucaí | `troca-de-email.html` |
| Reset Password | Redefina sua senha da Tucaí | `recuperar-senha.html` (botão "Enviar recuperação de senha" da aba Logins e "Esqueci a senha") |
| Reauthentication | Código de confirmação da Tucaí | `reautenticacao.html` |

Abra cada modelo, troque o assunto, apague o conteúdo e cole o HTML do arquivo. As variáveis `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .NewEmail }}` e `{{ .SiteURL }}` são preenchidas pelo Supabase.

## Antes de usar com clientes reais

1. **Endereços do site** (Authentication → URL Configuration):
   - Site URL: `https://plataforma-sucess.marcossonopi.workers.dev` (ou o domínio próprio);
   - Redirect URLs: `https://plataforma-sucess.marcossonopi.workers.dev/**`.
   Sem isso, os links dos e-mails podem levar ao endereço errado.
2. **Envio próprio (SMTP)** (Authentication → Emails → SMTP Settings): o envio padrão do Supabase tem limite baixo de mensagens por hora e pode cair no spam. Use um provedor (Resend, Brevo, Amazon SES, Zoho…) e um remetente do seu domínio, por exemplo `nao-responda@seudominio.com.br`, com SPF e DKIM configurados no domínio.
3. Faça um teste: "Esqueci a senha" com o seu e-mail e um convite da aba Equipe.
