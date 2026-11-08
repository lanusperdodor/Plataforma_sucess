---
inclusion: always
---

# Design system

Tokens em `src/styles/tokens.css` (CSS variables) — única fonte das cores/tipografia/raios. Lojas podem sobrescrever apenas `--store-primary/--store-secondary`, validadas por contraste (WCAG AA, `src/lib/color`).

- Marca **Tucaí** (slogan "Tudo junto. Tudo aí."; mascote **Tuca**). Cores: carvão fosco `#17191B` (marca, texto, barras), laranja `#FF5500` (preenchimentos, CTA principal, selos, destaques) e branco `#FFFFFF`. Apoio neutro `#F6F6F5`. Laranja como texto sobre branco usa `#C2410C` (AA); sobre laranja o texto é carvão (5,5:1), nunca branco em texto pequeno. Sucesso `#16A34A`, erro `#DC2626`.
- Laranja como assinatura pontual (CTA principal, selos, contadores), carvão para navegação ativa e texto; NÃO usar laranja como fundo geral. Fundos claros, fotos reais. Arquivos da marca em `public/brand` (logo, ícone, Tuca). Um único Tuca por tela, sem cortes de corpo.
- Tipografia Inter. Ícones Lucide. Sem gradientes gigantes, partículas, neon, brilhos, sombras pesadas.
- Movimento: 150–350 ms, só transform/opacity, sempre com propósito; respeitar `prefers-reduced-motion`.
- Mobile-first: barra inferior (Início, Explorar, Comunidade, Pedidos, Perfil; Favoritos fica dentro do Perfil), área segura, alvos >= 44px.
- Acessibilidade: foco visível, teclado, contraste AA, labels em todos os campos.
- Detalhes de UX/scroll: spec `.kiro/specs/ui-ux`.
