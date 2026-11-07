# Spec UI/UX — Requirements (execução faseada, NÃO iniciada além da base)

Ordem: 1 tokens/componentes → 2 home cliente → 3 scroll inteligente → 4 página da loja → 5 carrinho/checkout → 6 dashboard lojista → 7 painel entregador → 8 Master → 9 testes de responsividade/a11y/performance.

## Requisitos
- Paleta e tokens conforme `design-system.md`; troca de marca só em tokens/brand.
- Cabeçalho da home encolhe ao rolar e restaura no topo, sem layout shift.
- Categorias horizontais com item ativo; setas no desktop.
- Filtros compactos fixos; preservar scroll, filtros, busca e cidade ao voltar da loja.
- Skeletons, imagens lazy/responsivas, paginação progressiva (sem centenas de itens).
- Banner com controles manuais, sem troca rápida, respeita `prefers-reduced-motion`.
- Barra inferior mobile (Início, Explorar, Pedidos, Favoritos, Perfil), área segura.
- Loja: capa, logo, barra de categorias sticky acompanhando seção visível (IntersectionObserver), cores do lojista com contraste AA garantido.
- Dashboard: sidebar desktop, nav compacta mobile, novo pedido com aviso visual + som configurável.
- Entregador: oferta com valor, retirada, distância, aceitar/recusar.
- Mapa: marcador com interpolação visual, aviso de localização desatualizada, sem recálculo de rota por atualização.
- Animações 150–350 ms, transform/opacity; Core Web Vitals; navegação por teclado.

## Aceitação
Cada tela é navegável e conectada a dados reais do Supabase antes de ser marcada concluída.
