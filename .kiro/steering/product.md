---
inclusion: always
---

# Produto — Plataforma Regional (nome provisório)

Nome, cores e textos de marca vivem em `src/config/brand.ts` e `src/styles/tokens.css`. Nunca hardcodar o nome.

- Idioma: pt-BR. Moeda: BRL (centavos inteiros). Fuso: America/Sao_Paulo.
- Região inicial: Itaú de Minas/MG; descoberta regional até 200 km (configurável); expansão nacional.
- MVP = **delivery de alimentos**. Shopping, serviços, rede social, vagas e publicidade são FUTUROS: apenas preparar a arquitetura, não implementar.

## Perfis (um usuário pode ter vários)
customer, business_owner, business_staff, courier_partner, courier_own, service_provider, platform_operator, platform_master.

## Planos (valores só editáveis pelo Master)
- Delivery: R$ 79/mês. Presencial + Delivery: R$ 99/mês (QR Code, NFC, link Google, placa).

## Módulos do MVP
Auth/perfis → loja do restaurante → cardápio → carrinho/checkout → pedidos → entregas → pagamentos (sandbox) → rastreamento → Master → assinaturas → QR.

Regras financeiras: ver #[[file:.kiro/steering/business-rules.md]]. Segurança: #[[file:.kiro/steering/security.md]].
