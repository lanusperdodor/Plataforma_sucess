# Próximos passos

1. **Numa máquina com internet:** `npm install` → `npm run typecheck && npm run lint && npm test -- --run && npm run build`. Corrigir o que falhar (versões do `package.json` não foram validadas).
2. **Supabase (conta gratuita do usuário):** criar projeto, preencher `.env.local`, aplicar `supabase/migrations/0001_foundation.sql` (`supabase db push`) e rodar `supabase test db`.
3. Habilitar MFA para o futuro Master e criar o primeiro `platform_master` manualmente via SQL no painel (nunca por código/senha fixa).
4. **Próxima Spec:** `lojas` — businesses completo, themes (validação de contraste), horários, cadastro de restaurante + aprovação pelo Master.
5. Depois: cardápio → carrinho/checkout (motor de preços no backend) → pedidos.
6. Spec UI/UX: seguir a ordem em `.kiro/specs/ui-ux`.
7. Decisões pendentes do usuário: nome da marca, provedor de pagamento, provedor de mapas, tratamento de descontos na base da comissão.
