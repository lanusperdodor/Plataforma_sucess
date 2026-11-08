# Prévia visual — Projeto Milhão

Versão local com a identidade Tucaí (carvão, laranja e branco). A vitrine antiga em /previa mantém estilos próprios até ser removida. Nenhum deploy, merge ou pagamento real.

## Abrir
http://127.0.0.1:5173/ — com o servidor Vite em execução. F5 no Kiro inicia o servidor quando a porta está livre; Shift+F5 encerra a sessão iniciada pelo depurador. Não abrir index.html diretamente pelo sistema de arquivos.

## Navegação disponível
- `/`: vitrine, seis restaurantes ilustrativos, busca, categorias, filtro de rapidez e ordenação.
- `/explorar`, `/favoritos`, `/perfil`: descoberta e seleção das experiências.
- `/loja/brasa` (e demais lojas): cardápio, categoria e modal com quantidade.
- `/carrinho`, `/checkout`: sacola de uma loja por vez, quantidades, entrega/retirada e pagamento demonstrativo. Usa o motor de preços existente em centavos.
- `/pedidos`, `/pedido/:id`: pedidos criados na visita e avanço manual das etapas.
- `/painel`: restaurante; pedidos em colunas, disponibilidade simulada do cardápio, formulário da loja e planos sem contratação.
- `/entregador`: disponibilidade, oferta de R$ 5, aceite, retirada e entrega de demonstração; mapa ilustrativo sem geolocalização.
- `/master`: visão geral, aprovação simulada, estabelecimentos, entregadores, financeiro e preferências ilustrativas.
- Rotas originais de autenticação preservadas, inclusive `/nova-senha` criada pelo Kiro.

No topo, o seletor Cliente / Restaurante / Entregador / Administração permite conhecer os painéis sem credenciais. Ações nesses painéis não modificam o Supabase. Favoritos e sacola são guardados localmente; pedidos simulados duram a visita. Imagens ilustrativas carregadas do Unsplash. Indicadores e estabelecimentos são fictícios.

## Verificação
Typecheck, lint sem avisos, 45 testes e build. Auditoria npm sem vulnerabilidades na verificação final. Browser: produto com duas unidades, sacola de R$ 56 + entrega de R$ 4 = R$ 60, checkout e acompanhamento; pedido aceito no painel; entrega simulada até conclusão; aprovação ilustrativa; filtro por pizzas e favoritos. Verificados desktop de 1440 px e celular de 390 px; corrigidos banner e largura de painéis. Integração real, RLS remota e pagamentos continuam fora desta prévia.
