---
inclusion: always
---

# Produto — Tucaí ("Tudo junto. Tudo aí.")

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

## Prioridade atual definida pelo usuário — visual primeiro (07/11/2026)
O usuário priorizou experimentar todo o visual navegável antes das integrações restantes. A identidade aprovada (substitui a paleta verde anterior) é Tucaí: carvão fosco #17191B, laranja #FF5500 e branco, com o mascote Tuca na apresentação da página inicial. Já existe uma prévia em `src/features/preview/`; preservar esse trabalho e todas as rotas de autenticação. Dados de demonstração não significam módulo integrado concluído. Continuar refinando as telas e a experiência; retomar o banco e pagamentos depois da revisão visual.
