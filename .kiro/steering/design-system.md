---
inclusion: always
---

# Design system

Tokens em `src/styles/tokens.css` (CSS variables) — única fonte das cores/tipografia/raios. Lojas podem sobrescrever apenas `--store-primary/--store-secondary`, validadas por contraste (WCAG AA, `src/lib/color`).

- Marca: roxo `#6D28D9` (institucional), violeta `#8B5CF6` (interativo). Superfície `#FFFFFF`, apoio `#F8FAFC`, texto `#111827`, sucesso `#16A34A`, erro `#DC2626`.
- Roxo como assinatura (botões, navegação ativa, seleção), NÃO fundo geral. Fundos claros, fotos reais.
- Tipografia Inter. Ícones Lucide. Sem gradientes gigantes, partículas, neon, brilhos, sombras pesadas.
- Movimento: 150–350 ms, só transform/opacity, sempre com propósito; respeitar `prefers-reduced-motion`.
- Mobile-first: barra inferior (Início, Explorar, Pedidos, Favoritos, Perfil), área segura, alvos >= 44px.
- Acessibilidade: foco visível, teclado, contraste AA, labels em todos os campos.
- Detalhes de UX/scroll: spec `.kiro/specs/ui-ux`.
