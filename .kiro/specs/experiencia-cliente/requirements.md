# Requirements Document

## Introduction

Redesenho completo da experiência do cliente da plataforma regional, com aparência e comportamento de aplicativo. A camada cliente reúne delivery de alimentos, shopping regional, rede social comercial, comunidade, vagas e serviços em uma única navegação adaptativa (celular, tablet/notebook e desktop). A região inicial é Itaú de Minas/MG.

Esta spec substitui `src/features/preview/VisualPreview.tsx` por telas reais conectadas ao Supabase, por meio de uma camada de repositório e hooks TanStack Query. Novas migrations criam as tabelas de lojas/comércios, cardápio, comunidade, vagas, pedidos, endereços, favoritos, notificações, cupons e serviços, todas com RLS no padrão de `supabase/migrations/0001_foundation.sql`. Um seed de demonstração popula Itaú de Minas/MG.

### Decisões do usuário que alteram specs anteriores

- Comunidade, vagas, lojas/comércios e serviços deixaram de ser "futuros" (`product.md`, `roteiro-mvp`) por decisão explícita do usuário, restritos à camada cliente. A arquitetura segue multi-tenant (`business_id` + RLS).
- A barra inferior mobile passa a ser Início, Explorar, Comunidade, Pedidos, Perfil (antes: Início, Explorar, Pedidos, Favoritos, Perfil em `design-system.md` e `ui-ux`). Favoritos passa a ser seção do Perfil.
- Esta spec reaproveita e cumpre os requisitos de `.kiro/specs/ui-ux/requirements.md` (cabeçalho que compacta, categorias horizontais, filtros fixos, preservação de estado, skeletons, página da loja com barra sticky, code splitting) e as etapas M2 (parte pública), M3 (leitura), M4, M5 e M6 (lado cliente) de `.kiro/specs/roteiro-mvp/requirements.md`.
- Identidade visual (atualizada pelo usuário): marca Tucaí, slogan "Tudo junto. Tudo aí.", mascote Tuca. Carvão fosco `#17191B` como cor primária, laranja `#FF5500` para CTA principal, selos e destaques (texto laranja sobre branco em `#C2410C`), branco e neutro claro `#F6F6F5` como fundos.

### Fora do escopo

- Criação e edição de posts, vagas e cardápio pelo comerciante (somente seed).
- Pagamento real e qualquer provedor de pagamento.
- Rastreamento por mapa.
- Painéis de lojista, entregador e Master.

## Glossary

- **Plataforma**: aplicação web do cliente descrita nesta spec (React + Vite + Supabase).
- **Backend**: Postgres do Supabase, com tabelas, políticas RLS e funções `security definer` (e Edge Functions quando necessário).
- **Cliente**: usuário autenticado com papel `customer`.
- **Visitante**: usuário sem sessão, que acessa apenas dados públicos via chave anon.
- **Comércio**: registro em `businesses` com tipo `restaurante`, `loja` ou `servico`.
- **Comércio_Ativo**: Comércio com status `active`.
- **Restaurante**: Comércio do tipo `restaurante`.
- **Cardápio**: conjunto de categorias, produtos e grupos de adicionais de um Restaurante.
- **Produto**: item vendável do Cardápio, com preço em centavos.
- **Grupo_de_Adicionais**: conjunto de opções de um Produto com mínimo, máximo e acréscimo por opção.
- **Sacola**: carrinho do Cliente, armazenado em `localStorage` do navegador, com itens de um único Restaurante.
- **Pedido**: registro em `orders` criado pelo Checkout, com itens (`order_items`) e eventos de status (`order_events`).
- **Pedido_de_Teste**: Pedido criado sem pagamento real e rotulado como simulado.
- **Checkout**: fluxo que converte a Sacola em Pedido_de_Teste.
- **Motor_de_Preços**: regras de `src/features/pricing` e sua implementação no backend (função SQL).
- **Snapshot_de_Taxas**: cópia imutável da configuração de taxas vigente, gravada no Pedido.
- **Post**: publicação da Comunidade, com tipo `imagem_texto`, `promocao`, `oferta_relampago`, `vaga`, `evento`, `video`, `atualizacao_comercial` ou `novo_produto`.
- **Post_Patrocinado**: Post marcado como `sponsored` no banco.
- **Comunidade**: feed central de Posts e Comércios em destaque.
- **Vaga**: oferta de emprego de um Comércio; **Candidatura** é o registro mínimo do Cliente a uma Vaga.
- **Serviço**: oferta de profissional ou prestador, com estrutura básica.
- **Interação**: curtir, salvar, seguir ou favoritar, persistida no Supabase para o próprio usuário.
- **Repositório**: módulo em `src/features/<modulo>` que encapsula as chamadas ao Supabase.
- **Layout_Mobile**: viewport com largura menor que 768 px.
- **Layout_Tablet**: viewport com largura de 768 px a 1023 px.
- **Layout_Desktop**: viewport com largura de 1024 px ou mais.
- **Busca_Inteligente**: campo de busca central que consulta Restaurantes, lojas, produtos, vagas, serviços e Posts.
- **Cabeçalho**: barra superior da Plataforma, em estado expandido ou compacto.
- **Tokens**: variáveis CSS de `src/styles/tokens.css`.

## Requirements

### Requirement 1: Navegação adaptativa

**User Story:** Como Cliente, quero uma navegação que se adapte ao meu dispositivo, para que eu use a Plataforma com a mesma facilidade no celular, tablet ou desktop.

#### Acceptance Criteria

1. WHILE a viewport estiver no Layout_Mobile, THE Plataforma SHALL exibir barra inferior fixa com cinco destinos: Início, Explorar, Comunidade, Pedidos e Perfil.
2. WHILE a viewport estiver no Layout_Mobile, THE Plataforma SHALL exibir no topo a localização atual, a busca, o botão de notificações, o acesso rápido ao perfil e a sacola com contador de itens.
3. WHILE a viewport estiver no Layout_Mobile e a Sacola contiver itens, THE Plataforma SHALL exibir um botão flutuante de sacola com o contador e o total.
4. WHILE a viewport estiver no Layout_Tablet, THE Plataforma SHALL exibir cabeçalho com menu lateral colapsável e filtros fixos nas listagens.
5. WHILE a viewport estiver no Layout_Desktop, THE Plataforma SHALL exibir topo com logo, localização, busca, perfil, notificações e sacola, menu lateral e conteúdo com largura máxima de 1280 px.
6. WHEN o Cliente selecionar um destino de navegação, THE Plataforma SHALL marcar o destino ativo com `aria-current="page"` e indicação visual.
7. THE Plataforma SHALL manter as rotas `/entrar`, `/cadastro`, `/recuperar-senha`, `/nova-senha` e `/conta` com o comportamento atual.
8. THE Plataforma SHALL oferecer as áreas Início, Explorar, Restaurantes, Página do Restaurante, Comunidade, Pedidos, Perfil, Sacola/Checkout, Vagas, Lojas, Serviços e Notificações, cada uma com rota própria.

### Requirement 2: Acesso público e áreas pessoais

**User Story:** Como Visitante, quero explorar a Plataforma sem cadastro, para que eu decida criar conta só quando quiser pedir ou interagir.

#### Acceptance Criteria

1. THE Plataforma SHALL permitir ao Visitante acessar Início, Explorar, Restaurantes, Página do Restaurante, Comunidade, Lojas, Serviços e Vagas sem login.
2. THE Plataforma SHALL ler dados públicos com a chave anon limitados a Comércios_Ativos e seus Cardápios, Posts, Vagas e Serviços publicados.
3. WHEN um Visitante acessar Pedidos, Perfil, Notificações ou Checkout, THE Plataforma SHALL redirecionar para `/entrar` preservando a rota de destino.
4. WHEN um Visitante tentar curtir, salvar, seguir, favoritar, comentar ou candidatar-se, THE Plataforma SHALL exibir convite de login e preservar a ação pendente.
5. WHEN o Cliente concluir o login a partir de um redirecionamento, THE Plataforma SHALL levar o Cliente à rota de destino original.
6. WHEN o Cliente sair da conta, THE Plataforma SHALL limpar do cache de consultas os dados pessoais e manter a Sacola local.

### Requirement 3: Início

**User Story:** Como Cliente, quero uma página inicial que mostre o que há de relevante na minha cidade, para que eu descubra e peça rapidamente.

#### Acceptance Criteria

1. THE Plataforma SHALL exibir no Início um bloco de propósito com o título "Da sua cidade. Do seu jeito." e o subtítulo "Peça, descubra, acompanhe e conecte-se com o comércio local.".
2. THE Plataforma SHALL exibir no bloco de propósito três chamadas de ação: Restaurantes, Comunidade e Comércios, cada uma levando à rota correspondente.
3. THE Plataforma SHALL exibir a Busca_Inteligente centralizada no Início.
4. THE Plataforma SHALL exibir as categorias Lanches, Pizzas, Marmitas, Açaí, Farmácia, Roupas, Calçados, Beleza, Serviços e Vagas, cada uma com ícone Lucide e rótulo textual.
5. WHILE a viewport estiver no Layout_Mobile, THE Plataforma SHALL exibir as categorias em faixa horizontal rolável.
6. WHILE a viewport estiver no Layout_Desktop, THE Plataforma SHALL exibir as categorias em grade.
7. THE Plataforma SHALL exibir no Início as seções Perto de você, Mais pedidos, Promoções do dia, Comerciantes em destaque, Novidades da comunidade, Vagas próximas, Empresas da região, Serviços populares, Recomendados e Últimos vistos.
8. THE Plataforma SHALL exibir em cada seção do Início título, subtítulo, ação "Ver mais" e cards.
9. IF uma seção do Início não tiver itens, THEN THE Plataforma SHALL ocultar a seção ou exibir estado vazio com texto explicativo.
10. WHEN o Cliente abrir um item da seção Últimos vistos, THE Plataforma SHALL registrar o item na lista local de últimos vistos, limitada a 12 itens.

### Requirement 4: Busca inteligente

**User Story:** Como Cliente, quero buscar em um só campo por restaurantes, lojas, produtos, vagas, serviços e posts, para que eu encontre qualquer coisa da cidade.

#### Acceptance Criteria

1. WHEN o Cliente ou o Visitante digitar ao menos 2 caracteres na Busca_Inteligente, THE Plataforma SHALL consultar o Repositório após 300 ms sem nova digitação.
2. THE Plataforma SHALL agrupar os resultados por tipo: Restaurantes, Lojas, Produtos, Vagas, Serviços e Posts.
3. THE Plataforma SHALL limitar cada grupo de resultados a 5 itens e oferecer "Ver todos" para o grupo.
4. THE Plataforma SHALL retornar apenas resultados de Comércios_Ativos da cidade selecionada.
5. IF a consulta de busca não retornar resultados, THEN THE Plataforma SHALL exibir mensagem de estado vazio com sugestão de categorias.
6. IF a consulta de busca falhar, THEN THE Plataforma SHALL exibir mensagem de erro com ação "Tentar novamente".
7. THE Plataforma SHALL permitir navegar pelos resultados com teclado (setas, Enter e Esc) e anunciar a quantidade de resultados a leitores de tela.
8. THE Plataforma SHALL tratar o texto digitado como dado literal, sem interpretar caracteres especiais como sintaxe de consulta.

### Requirement 5: Explorar, Restaurantes, Lojas e Serviços

**User Story:** Como Cliente, quero listar e filtrar restaurantes, lojas e serviços, para que eu compare e escolha com rapidez.

#### Acceptance Criteria

1. THE Plataforma SHALL exibir em Explorar o agrupamento Restaurantes, Lojas, Serviços, Vagas e Comunidade, com acesso direto a cada área.
2. THE Plataforma SHALL listar Restaurantes com filtros por categoria, entrega ou retirada, avaliação mínima, promoções e faixa de preço.
3. THE Plataforma SHALL ordenar Restaurantes por proximidade, popularidade ou tempo de entrega, conforme escolha do Cliente.
4. THE Plataforma SHALL exibir em cada card de Restaurante capa, logo, nome, categoria, avaliação, tempo estimado, taxa de entrega, indicador aberto/fechado, selo de promoção quando existir e ação "Ver cardápio".
5. THE Plataforma SHALL calcular o indicador aberto/fechado a partir dos horários do Comércio no fuso America/Sao_Paulo.
6. THE Plataforma SHALL carregar listagens de forma progressiva em páginas de 12 itens.
7. THE Plataforma SHALL listar Lojas e Comércios com filtros por categoria e cidade, e exibir cards com capa, logo, nome, categoria, avaliação e indicador aberto/fechado.
8. THE Plataforma SHALL listar Serviços e profissionais com estrutura básica: nome, categoria, cidade e contato.
9. IF a listagem não retornar itens para os filtros ativos, THEN THE Plataforma SHALL exibir estado vazio com ação "Limpar filtros".
10. WHEN o Cliente aplicar ou alterar filtros ou ordenação, THE Plataforma SHALL refletir a escolha na URL por parâmetros de consulta.

### Requirement 6: Página do Restaurante

**User Story:** Como Cliente, quero uma página completa do restaurante, para que eu conheça o local e monte meu pedido com facilidade.

#### Acceptance Criteria

1. THE Plataforma SHALL exibir na Página do Restaurante capa, logo, nome, avaliação, horário, taxa, tempo estimado e endereço.
2. THE Plataforma SHALL oferecer abas Cardápio, Promoções, Avaliações, Informações e Publicações.
3. THE Plataforma SHALL exibir na aba Cardápio as categorias em barra sticky que destaca a categoria da seção visível, usando IntersectionObserver.
4. WHEN o Cliente selecionar uma categoria na barra sticky, THE Plataforma SHALL rolar até a seção correspondente em no máximo 350 ms, ou imediatamente quando `prefers-reduced-motion` estiver ativo.
5. THE Plataforma SHALL manter a Sacola acessível durante a rolagem da Página do Restaurante.
6. WHEN o Cliente selecionar um Produto, THE Plataforma SHALL abrir modal com foto, descrição, preço, Grupos_de_Adicionais, campo de observações e controle de quantidade.
7. WHILE o modal de Produto estiver aberto, THE Plataforma SHALL prender o foco no modal, fechar com Esc e devolver o foco ao elemento que o abriu.
8. IF o Cliente tentar adicionar um Produto sem atender ao mínimo de algum Grupo_de_Adicionais obrigatório, THEN THE Plataforma SHALL bloquear a adição e indicar o grupo pendente.
9. IF o Cliente exceder o máximo de opções de um Grupo_de_Adicionais, THEN THE Plataforma SHALL impedir a seleção adicional e informar o limite.
10. IF o Restaurante estiver fechado, THEN THE Plataforma SHALL exibir o aviso "Fechado agora" e o próximo horário de abertura.
11. IF o slug do Restaurante não existir ou o Comércio não for ativo, THEN THE Plataforma SHALL exibir página "Não encontrado" com ação de voltar a Restaurantes.
12. THE Plataforma SHALL exibir na aba Publicações os Posts do Comércio e na aba Avaliações a média e a lista de avaliações.

### Requirement 7: Sacola local

**User Story:** Como Cliente, quero uma sacola que se mantém entre visitas, para que eu não perca meus itens ao navegar ou recarregar.

#### Acceptance Criteria

1. THE Plataforma SHALL persistir a Sacola em `localStorage` do navegador.
2. WHEN o Cliente adicionar, remover ou alterar a quantidade de um item, THE Plataforma SHALL atualizar o contador, o subtotal estimado e a persistência local em no máximo 100 ms.
3. WHEN o Cliente adicionar um item de Restaurante diferente do que está na Sacola, THE Plataforma SHALL solicitar confirmação antes de substituir o conteúdo da Sacola.
4. THE Plataforma SHALL guardar na Sacola apenas identificadores de Produto e de opções, quantidades e observações, sem armazenar preços como fonte de verdade.
5. IF o conteúdo da Sacola em `localStorage` estiver corrompido ou em formato inválido, THEN THE Plataforma SHALL descartar o conteúdo e iniciar uma Sacola vazia.
6. IF um Produto da Sacola estiver indisponível ou removido, THEN THE Plataforma SHALL sinalizar o item e impedir o Checkout até a remoção do item.
7. THE Plataforma SHALL exibir o subtotal da Sacola com valores recalculados a partir dos preços lidos do Cardápio.

### Requirement 8: Checkout e Pedido de Teste

**User Story:** Como Cliente, quero finalizar minha sacola em um pedido, para que eu acompanhe o preparo e a entrega.

#### Acceptance Criteria

1. THE Plataforma SHALL exibir no Checkout itens, subtotal, frete, descontos, total, endereço, forma de pagamento, tempo estimado, campo de cupom, campo de observações e um botão principal de confirmação.
2. THE Plataforma SHALL rotular o Checkout e o Pedido como "Pedido de teste (simulado, sem cobrança real)".
3. WHEN o Cliente confirmar o Checkout, THE Plataforma SHALL chamar função do backend que cria o Pedido, os itens e o evento inicial de status em uma única transação.
4. THE Backend SHALL recalcular preços de Produtos e opções a partir do Cardápio, ignorando qualquer valor monetário enviado pelo cliente.
5. THE Backend SHALL calcular comissão e taxas com as regras do Motor_de_Preços: comissão 0% quando o subtotal for menor ou igual a R$ 50,00 e 2% sobre todo o subtotal quando for maior.
6. WHERE o modo for entrega por parceiro, THE Backend SHALL aplicar cliente 400, restaurante 200, entregador 500 e plataforma 100, em centavos.
7. WHERE o modo for entrega própria, THE Backend SHALL cobrar do restaurante a taxa de plataforma de 100 centavos e não aplicar os 500 centavos do parceiro.
8. WHERE o modo for retirada, THE Backend SHALL registrar receita de entrega igual a zero.
9. THE Backend SHALL gravar no Pedido o Snapshot_de_Taxas vigente e impedir alteração posterior desse snapshot.
10. THE Backend SHALL representar todos os valores monetários em centavos inteiros de BRL.
11. THE Backend SHALL produzir, para subtotais de R$ 28, R$ 50, R$ 56 e R$ 64, resultados idênticos aos de `src/features/pricing`.
12. WHEN o Cliente reenviar a mesma confirmação com a mesma chave de idempotência, THE Backend SHALL retornar o Pedido já criado sem criar outro.
13. IF o Restaurante estiver fechado, inativo ou o subtotal for inferior ao pedido mínimo, THEN THE Backend SHALL rejeitar o Pedido com mensagem de motivo em pt-BR.
14. IF um Produto ou opção for indisponível ou não pertencer ao Restaurante, THEN THE Backend SHALL rejeitar o Pedido e identificar o item.
15. IF o cupom informado for inválido, expirado, esgotado ou inelegível, THEN THE Backend SHALL rejeitar o cupom sem rejeitar o Pedido e informar o motivo.
16. THE Backend SHALL tratar o desconto de cupom como custo do estabelecimento e nunca como custo da plataforma.
17. IF o endereço de entrega não pertencer ao Cliente autenticado, THEN THE Backend SHALL rejeitar o Pedido.
18. WHEN o Pedido for criado, THE Plataforma SHALL esvaziar a Sacola e levar o Cliente à tela de acompanhamento do Pedido.
19. WHILE o Checkout estiver em envio, THE Plataforma SHALL desabilitar o botão de confirmação e indicar o progresso.
20. THE Plataforma SHALL exibir ao Cliente valores de pré-visualização obtidos do backend, e não calculados de forma independente no frontend.

### Requirement 9: Pedidos

**User Story:** Como Cliente, quero acompanhar e repetir meus pedidos, para que eu saiba o estado de cada um e peça de novo com poucos toques.

#### Acceptance Criteria

1. THE Plataforma SHALL listar em Pedidos duas visões: Em andamento e Anteriores.
2. THE Plataforma SHALL exibir em cada Pedido restaurante, itens, total, etapa atual e data.
3. THE Plataforma SHALL exibir na tela de acompanhamento a linha do tempo das etapas registradas em `order_events`.
4. WHEN o Cliente selecionar "Repetir pedido", THE Plataforma SHALL adicionar à Sacola os itens atualmente disponíveis do Pedido e informar os itens indisponíveis.
5. WHEN o Cliente selecionar "Suporte" em um Pedido, THE Plataforma SHALL exibir canais de contato do Comércio e o identificador do Pedido.
6. THE Plataforma SHALL permitir ao Cliente ler somente os próprios Pedidos, itens e eventos.
7. WHILE um Pedido estiver em andamento, THE Plataforma SHALL atualizar a etapa exibida a cada 15 segundos ou por Realtime filtrado pelo usuário.
8. IF a lista de Pedidos estiver vazia, THEN THE Plataforma SHALL exibir estado vazio com ação para Restaurantes.

### Requirement 10: Comunidade

**User Story:** Como Cliente, quero um feed da comunidade comercial da minha cidade, para que eu acompanhe novidades, ofertas, eventos e vagas dos comércios.

#### Acceptance Criteria

1. THE Plataforma SHALL exibir na Comunidade o feed de Posts, filtros por tipo e a lista de empresas em destaque.
2. THE Plataforma SHALL suportar os tipos de Post: imagem com texto, promoção, oferta relâmpago, vaga, evento, vídeo preparado, atualização comercial e novo produto.
3. THE Plataforma SHALL exibir em cada Post o avatar e nome do Comércio, horário relativo de publicação, tipo, conteúdo e localização quando informada.
4. WHERE o Post tiver `sponsored` verdadeiro, THE Plataforma SHALL exibir o rótulo textual "Patrocinado" visível e acessível a leitores de tela.
5. WHEN o Cliente curtir, salvar ou seguir, THE Plataforma SHALL persistir a Interação no Supabase e atualizar a interface de forma otimista, revertendo em caso de falha.
6. THE Plataforma SHALL permitir ao Cliente comentar em um Post, com texto de 1 a 500 caracteres, persistido no Supabase.
7. THE Plataforma SHALL exibir a contagem de curtidas e de comentários de cada Post.
8. IF o comentário estiver vazio ou exceder 500 caracteres, THEN THE Plataforma SHALL rejeitar o envio e indicar o limite.
9. THE Plataforma SHALL carregar o feed em páginas de 10 Posts com ordenação do mais recente ao mais antigo.
10. WHERE o Post for do tipo vídeo, THE Plataforma SHALL exibir área de vídeo preparada com imagem de capa e indicação de reprodução, sem exigir player completo.
11. THE Plataforma SHALL permitir ao Cliente consultar os Posts salvos e os Comércios seguidos no Perfil.
12. THE Plataforma SHALL exibir apenas Posts publicados de Comércios_Ativos.

### Requirement 11: Vagas

**User Story:** Como Cliente, quero ver vagas de emprego da minha região e me candidatar, para que eu encontre trabalho no comércio local.

#### Acceptance Criteria

1. THE Plataforma SHALL listar Vagas com empresa, cargo, cidade, categoria e as ações "Ver mais" e "Candidatar".
2. THE Plataforma SHALL permitir filtrar Vagas por categoria e cidade.
3. WHEN o Cliente selecionar "Candidatar" em uma Vaga, THE Plataforma SHALL registrar a Candidatura com identificador do Cliente, da Vaga e mensagem opcional de até 500 caracteres.
4. IF o Cliente já tiver Candidatura para a Vaga, THEN THE Plataforma SHALL exibir o estado "Candidatura enviada" e impedir duplicidade.
5. THE Plataforma SHALL permitir ao Cliente ler somente as próprias Candidaturas.
6. THE Plataforma SHALL exibir apenas Vagas publicadas de Comércios_Ativos.

### Requirement 12: Perfil, endereços e cupons

**User Story:** Como Cliente, quero gerenciar meus dados, endereços, favoritos e cupons, para que meus pedidos sejam mais rápidos e personalizados.

#### Acceptance Criteria

1. THE Plataforma SHALL exibir no Perfil as seções dados pessoais, endereços, pagamentos, pedidos, favoritos, notificações, seguidas, cupons, configurações e sair.
2. THE Plataforma SHALL permitir ao Cliente criar, editar, excluir e marcar como padrão endereços com rua, número, bairro, cidade, UF, CEP e complemento.
3. IF o CEP informado não tiver 8 dígitos, THEN THE Plataforma SHALL rejeitar o endereço e indicar o formato esperado.
4. THE Plataforma SHALL exibir na seção de pagamentos apenas a forma simulada "Pagamento de teste", sem coletar dados de cartão.
5. THE Plataforma SHALL listar em Favoritos os Comércios favoritados pelo Cliente e permitir remover o favorito.
6. THE Plataforma SHALL listar em Cupons os cupons elegíveis ao Cliente com validade, regra de uso e responsável pelo custo.
7. WHEN o Cliente selecionar "Sair", THE Plataforma SHALL encerrar a sessão e levar o Cliente ao Início.
8. THE Backend SHALL permitir ao Cliente ler e escrever somente os próprios endereços, favoritos, curtidas, salvos, seguidas, comentários, candidaturas e notificações.

### Requirement 13: Notificações

**User Story:** Como Cliente, quero ver minhas notificações, para que eu saiba das mudanças nos meus pedidos e novidades dos comércios seguidos.

#### Acceptance Criteria

1. THE Plataforma SHALL exibir no ícone de notificações o contador de notificações não lidas, limitado à exibição "9+" acima de 9.
2. THE Plataforma SHALL listar notificações do Cliente da mais recente para a mais antiga, com título, texto, horário e estado de leitura.
3. WHEN o Cliente abrir uma notificação, THE Plataforma SHALL marcá-la como lida no Supabase e levar o Cliente ao destino associado.
4. WHEN o Cliente selecionar "Marcar todas como lidas", THE Plataforma SHALL marcar todas as suas notificações como lidas.
5. WHEN o status de um Pedido do Cliente mudar, THE Backend SHALL criar uma notificação para o Cliente.
6. IF a lista de notificações estiver vazia, THEN THE Plataforma SHALL exibir estado vazio com texto explicativo.

### Requirement 14: Modelo de dados Supabase e RLS

**User Story:** Como responsável técnico, quero tabelas com RLS e testes de autorização, para que os dados do cliente e dos comércios estejam isolados e seguros.

#### Acceptance Criteria

1. THE Plataforma SHALL criar as novas tabelas por migrations versionadas em `supabase/migrations`, sem alterar a migration `0001_foundation.sql`.
2. THE Plataforma SHALL estender `businesses` com tipo (`restaurante`, `loja`, `servico`), categoria, cidade, capa, logo, horários, taxa de entrega, tempo estimado, pedido mínimo e avaliação.
3. THE Plataforma SHALL criar tabelas para categorias de cardápio, produtos, grupos de adicionais e opções, posts, curtidas, salvos, seguidores, comentários, vagas, candidaturas, pedidos, itens de pedido, eventos de pedido, endereços, favoritos, notificações, cupons e serviços.
4. THE Plataforma SHALL habilitar RLS em toda tabela criada, sem política `USING (true)` em tabela privada.
5. THE Plataforma SHALL incluir `business_id` em toda tabela de negócio.
6. THE Plataforma SHALL permitir ao público (anon e authenticated) ler apenas registros de Comércios_Ativos publicados, e não ler Comércios pendentes ou suspensos.
7. THE Plataforma SHALL restringir a escrita de curtidas, salvos, seguidas, favoritos, comentários, candidaturas e endereços ao usuário dono do registro (`user_id = auth.uid()`).
8. THE Plataforma SHALL impedir que o Cliente insira ou altere diretamente Pedidos, itens, eventos e totais, permitindo essas operações somente por funções do backend.
9. THE Plataforma SHALL impedir `UPDATE` e `DELETE` do Snapshot_de_Taxas e dos valores monetários de um Pedido após a criação.
10. THE Plataforma SHALL criar índices em chaves estrangeiras e em colunas de filtro e ordenação das listagens.
11. THE Plataforma SHALL usar `security definer` com `search_path` vazio nas funções do backend e revogar `EXECUTE` de `public` nas funções internas.
12. THE Plataforma SHALL fornecer seed de demonstração para Itaú de Minas/MG com Restaurantes, lojas, serviços, cardápios, Posts de todos os tipos, Vagas e cupons, claramente identificado como dados de demonstração.
13. THE Plataforma SHALL fornecer testes SQL de RLS em `supabase/tests`, no padrão de `rls_foundation.sql`, executáveis em PostgreSQL descartável com `local_auth_stub.sql`.
14. THE Plataforma SHALL cobrir nos testes SQL o isolamento entre Clientes, a invisibilidade de Comércios não ativos, a negação de escrita direta em Pedidos, a imutabilidade do snapshot e o recálculo de preços no backend.
15. THE Plataforma SHALL expor ao frontend apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, sem uso de `service_role`.

### Requirement 15: Camada de dados no frontend

**User Story:** Como desenvolvedor, quero uma camada de repositório com hooks de consulta, para que as telas fiquem desacopladas do Supabase e simples de testar.

#### Acceptance Criteria

1. THE Plataforma SHALL acessar o Supabase somente por Repositórios em `src/features/<modulo>`, e não diretamente por componentes de tela.
2. THE Plataforma SHALL expor os dados às telas por hooks TanStack Query com chaves de consulta estáveis e tipadas.
3. THE Plataforma SHALL validar com zod as respostas externas antes de entregá-las às telas.
4. WHEN uma consulta falhar, THE Plataforma SHALL expor estado de erro tipado para exibição de mensagem em pt-BR.
5. THE Plataforma SHALL formatar valores monetários em BRL a partir de centavos inteiros por utilitário único em `src/lib`.
6. THE Plataforma SHALL remover `src/features/preview/VisualPreview.tsx` e seus dados de demonstração estáticos após a migração das telas aos Repositórios.
7. THE Plataforma SHALL manter o `AuthProvider` e a verificação de papéis existentes como única fonte de sessão.

### Requirement 16: Movimento e preservação de estado

**User Story:** Como Cliente, quero uma interface fluida que lembre onde eu estava, para que eu navegue sem perder contexto.

#### Acceptance Criteria

1. WHEN o Cliente rolar a página além de 48 px, THE Plataforma SHALL compactar o Cabeçalho sem causar layout shift, mantendo reservada a altura do Cabeçalho expandido.
2. WHEN o Cliente retornar ao topo da página, THE Plataforma SHALL restaurar o Cabeçalho expandido.
3. WHEN o Cliente voltar de uma página de detalhe para uma listagem, THE Plataforma SHALL restaurar a posição de rolagem, os filtros, a ordenação, a busca e a cidade selecionada.
4. THE Plataforma SHALL usar animações de 150 ms a 350 ms, restritas às propriedades `transform` e `opacity`.
5. WHERE o dispositivo for desktop com ponteiro fino, THE Plataforma SHALL exibir efeitos de hover em cards e botões.
6. WHEN o Cliente tocar em um elemento interativo, THE Plataforma SHALL exibir feedback visual de pressão.
7. WHILE dados estiverem carregando, THE Plataforma SHALL exibir skeletons com as mesmas dimensões do conteúdo final.
8. WHEN uma ação do Cliente for concluída ou falhar, THE Plataforma SHALL exibir toast discreto com texto em pt-BR e `role="status"` ou `role="alert"`.
9. WHERE `prefers-reduced-motion: reduce` estiver ativo, THE Plataforma SHALL desativar animações não essenciais e usar rolagem sem suavização.
10. THE Plataforma SHALL carregar imagens abaixo da dobra com carregamento tardio e dimensões reservadas.

### Requirement 17: Identidade visual

**User Story:** Como Cliente, quero uma identidade acolhedora, premium e regional, para que a Plataforma pareça um aplicativo próprio e não um template genérico.

#### Acceptance Criteria

1. THE Plataforma SHALL obter cores, tipografia e raios exclusivamente dos Tokens, sem valores hexadecimais fixos em componentes.
2. THE Plataforma SHALL usar carvão fosco (#17191B) como cor primária e de texto, branco e neutro claro como fundo, e laranja (#FF5500) apenas em CTA principal, selos, contadores e destaques pontuais, mantendo contraste AA.
3. THE Plataforma SHALL usar a tipografia Inter e ícones Lucide.
4. THE Plataforma SHALL usar fotografias ou ilustrações regionais nos cards e estados vazios, evitando gradientes extensos, partículas, neon e sombras pesadas.
5. THE Plataforma SHALL ler o nome da marca de `src/config/brand.ts`, sem texto de marca fixo em componentes.
6. THE Plataforma SHALL apresentar a interface como aplicativo (barras de navegação, cards, folhas modais), sem layout de página de captura (landing page) nas áreas de uso.

### Requirement 18: Acessibilidade

**User Story:** Como Cliente com necessidades de acessibilidade, quero operar toda a Plataforma por teclado e leitor de tela, para que eu use todos os recursos de forma autônoma.

#### Acceptance Criteria

1. THE Plataforma SHALL permitir operar todas as ações por teclado, com ordem de foco lógica e foco visível.
2. THE Plataforma SHALL manter relação de contraste mínima de 4,5:1 para texto normal e 3:1 para texto grande e componentes de interface.
3. THE Plataforma SHALL dimensionar alvos de toque com no mínimo 44 px por 44 px.
4. THE Plataforma SHALL associar rótulo a todo campo de formulário e nome acessível a todo botão de ícone.
5. THE Plataforma SHALL usar marcos semânticos (`header`, `nav`, `main`) e hierarquia de títulos sem saltos.
6. THE Plataforma SHALL anunciar a Sacola, mudanças de contador e resultados de busca a leitores de tela por regiões `aria-live` polidas.
7. THE Plataforma SHALL dispensar o uso de cor como único indicador de estado, como aberto/fechado e ativo.
8. THE Plataforma SHALL respeitar áreas seguras (`safe-area-inset`) na barra inferior e no botão flutuante do Layout_Mobile.

### Requirement 19: Responsividade e desempenho

**User Story:** Como Cliente, quero que a Plataforma carregue rápido e se organize bem em qualquer tela, para que eu use sem espera em redes móveis.

#### Acceptance Criteria

1. THE Plataforma SHALL aplicar layouts distintos para Layout_Mobile, Layout_Tablet e Layout_Desktop, sem rolagem horizontal da página em viewports a partir de 320 px.
2. THE Plataforma SHALL dividir o código por rota com carregamento tardio (`React.lazy`), de modo que o chunk inicial seja menor que o bundle único atual de 546 kB.
3. WHILE uma rota estiver carregando seu chunk, THE Plataforma SHALL exibir um skeleton da rota.
4. IF o carregamento de um chunk de rota falhar, THEN THE Plataforma SHALL exibir mensagem de erro com ação "Recarregar".
5. THE Plataforma SHALL manter as rotas de autenticação funcionais após a divisão de código.

### Requirement 20: Verificação e qualidade

**User Story:** Como responsável técnico, quero verificação automatizada completa, para que a entrega seja confiável e não quebre o que já funciona.

#### Acceptance Criteria

1. THE Plataforma SHALL passar em `npm run typecheck`, `npm run lint`, `npm test -- --run` e `npm run build` sem erros.
2. THE Plataforma SHALL manter passando os 45 testes existentes de autenticação, permissões e preços.
3. THE Plataforma SHALL incluir testes unitários para Sacola, filtros, ordenação, indicador aberto/fechado, formatação de moeda e validações de formulário.
4. THE Plataforma SHALL incluir testes de componente para navegação adaptativa, modal de Produto, Checkout e estados vazio, de carregamento e de erro.
5. THE Plataforma SHALL incluir teste de paridade entre o Motor_de_Preços em TypeScript e o backend para os subtotais de R$ 28, R$ 50, R$ 56 e R$ 64 nos modos parceiro, próprio e retirada.
6. THE Plataforma SHALL executar os testes SQL de RLS em PostgreSQL descartável e registrar o resultado em `PROGRESSO.md`.
7. WHEN uma fase for concluída, THE Plataforma SHALL atualizar `PROGRESSO.md` e `PROXIMOS_PASSOS.md` e registrar decisões relevantes em `ARQUITETURA.md`.
