# Segurança operacional e continuidade

## Backups (não verificado na infraestrutura)
Nada foi confirmado no projeto Supabase. Verificar em Project Settings → Database/Backups qual o
plano: a disponibilidade de backups diários e de PITR varia por plano. Até confirmar, **não há
garantia de backup automático**.

Estratégia proposta:
1. Plano com backup diário gerenciado (e PITR quando houver dados financeiros).
2. Cópia lógica semanal adicional: `supabase db dump --linked -f backup.sql` (esquema) e
   `--data-only`, guardada cifrada (ex.: `age`/GPG) em armazenamento com acesso restrito a 2 pessoas.
3. Retenção: 30 dias (diário) / 12 semanas (semanal) — validar com o jurídico/LGPD.
4. Teste de restauração mensal num projeto ou PostgreSQL descartável, registrando data e resultado.

## Logs
| Log | Onde | Acesso | Retenção |
|---|---|---|---|
| Ações administrativas, permissões, cadastros, LGPD | `audit_logs` (imutável) | `audit.view` + MFA | mínimo 6 meses; final a validar |
| Autenticação (logins, falhas) | Supabase Auth logs | painel do Supabase | conforme plano |
| API/limites (HTTP 429) | Supabase API logs | painel do Supabase | conforme plano |
| Acesso ao site | Cloudflare | painel da Cloudflare | conforme plano |
Nunca registrar senhas, tokens, texto livre de usuários ou documentos.

## Monitoramento (a configurar — depende de fornecedor)
Alertas úteis, sem excesso: picos de falhas de login (Supabase Auth logs), respostas 429 e 5xx da
API, ações administrativas fora do padrão (`audit_logs`: concessões de papel/permissão, mudança de
`require_admin_mfa`), e, quando existirem, falhas de pagamento e webhooks. Revisar semanalmente
`audit_logs` de concessões até haver alertas automáticos.

## Resposta a incidentes
Responsáveis: definir 1 líder de incidente e 1 suplente entre os sócios, mais contato técnico.
Canal de emergência: definir (telefone/grupo fechado). Pendente de preenchimento pela Tucaí.

1. **Identificar**: registrar quando, como foi detectado e o que foi afetado.
2. **Conter**: revogar chaves/sessões (Supabase → rotate keys; `signOut` global do usuário),
   suspender contas/estabelecimentos envolvidos, desligar a funcionalidade.
3. **Investigar**: `audit_logs`, logs do Supabase/Cloudflare, commits recentes.
4. **Corrigir e recuperar**: correção com teste, restauração de backup se necessário.
5. **Registrar**: linha do tempo, dados e titulares afetados, decisões.
6. **Avaliar comunicação**: se houver dados pessoais envolvidos com risco ou dano relevante aos
   titulares, o encarregado e o jurídico avaliam a comunicação à ANPD e aos titulares no prazo da
   regulamentação vigente (Resolução CD/ANPD nº 15/2024: 3 dias úteis, a confirmar). Nenhuma
   notificação é enviada automaticamente.

## Revisão de código e privilégios
- Merge só com CI verde (typecheck, lint, testes, build, segredos, audit, testes SQL) e revisão humana das migrations.
- Revisão trimestral das permissões da equipe (Painel → Equipe) e remoção de quem saiu.
- Ações destrutivas (anonimização) exigem confirmação explícita e são auditadas.
