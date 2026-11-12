# Tucaí — Homologação e prontidão comercial

Data da avaliação: 11/11/2026. Branch `feat/fundacao-fase-1`, migração nova `0022_homologacao.sql`.

## Classificação

| Ambiente | Situação | Por quê |
|---|---|---|
| **Produção hoje** (banco publicado) | **NÃO PRONTA** | O banco está na migração 0015. Faltam as 0016–0022: login por usuário, SEO, financeiro, pagamentos, aba Logins, isolamento de teste, despacho com prazo, painel de pedidos do Master. Os 2 estabelecimentos "[Teste]" aparecem para qualquer visitante (confirmado no site publicado). |
| **Depois de rodar `apply_all_migrations.sql` (22 migrações)** | **PRONTA PARA HOMOLOGAÇÃO** | O fluxo completo, do cliente ao Master, funciona no banco com papéis e RLS reais. Teste e produção ficam isolados, e o despacho tem aceite atômico, recusa, expiração, redistribuição e alerta. Um teste automatizado cobre o cenário obrigatório e as falhas. |
| **Piloto com clientes reais** | Ainda não | Faltam: rodar o roteiro na interface com evidência no ambiente publicado, ativar o MFA dos administradores, decidir a forma de pagamento do piloto e configurar o envio de e-mails de recuperação de senha. |

## Pedido do Mercadinho que "não apareceu" (investigação de 12/11/2026)

Causas encontradas (verificadas no banco publicado, só leitura):
1. **Existem dois "[Teste] Mercadinho Teste"** na mesma cidade (lotes `6e9b5d` e `94090e`, criados em horários diferentes). Cada lojista só vê o próprio. Se o cliente comprou no Mercadinho de um lote e o lojista entrou com o login do outro lote, o pedido existe, mas não aparece para ele. A 0023 passa a acrescentar o código do lote ao nome ("· lote 6e9b5d") e a 0022 deixa de criar lotes duplicados na mesma cidade. Para confirmar qual Mercadinho recebeu o pedido, rode `supabase/admin/diagnostico_pedidos.sql` (só leitura).
2. **O Mercadinho usa entrega própria.** Esses pedidos, como os de retirada, nunca vão para entregadores parceiros. Isso está correto pela regra. Para testar o entregador, use a "[Teste] Lanchonete do Tuca" (entregador parceiro), aceite, prepare e marque como pronto. As telas agora explicam isso no checkout, no painel da loja e na área do entregador.
3. **O banco publicado está na 0015.** As migrações 0016–0023 não foram aplicadas, então tempo real, alertas, aba Pedidos do Master, financeiro novo e pagamentos não existem lá. É a mesma causa do "Banco de dados desatualizado" no Financeiro e em Pagamentos: as funções `admin_finance_summary` e `admin_payment_gateway_get` respondem 404 no projeto publicado.

O teste automatizado reproduz o caso do Mercadinho e passa:
- o pedido é gravado com a loja, o cliente, a modalidade e os valores certos;
- o lojista correto vê o pedido e outra loja não vê;
- o Master vê o pedido;
- a entrega própria não vira oferta;
- a loja leva o pedido até o fim e o cliente vê "entregue".

## Painel Master (0023)

| Área | O que mudou | Testes |
|---|---|---|
| Logins | Detalhes da conta (papéis, vínculos, entregador, pedidos, auditoria da conta). **Enviar recuperação de senha**: link do Supabase Auth, registrado na auditoria. **Senha temporária**: conta de teste pelo suporte; conta real só pelo Master com MFA; troca obrigatória no primeiro acesso; a senha nunca vai para logs | SQL + interface |
| Equipe | Convite por e-mail (sem senha, link seguro); conta existente é vinculada sem duplicar; permissões granulares; Master exige MFA e a confirmação "CONCEDER MASTER"; o último Master não pode ser removido; entregador e lojista só pelos próprios cadastros | SQL + interface |
| Financeiro | Relatório por período, cidade e estabelecimento: confirmado, previsto, recebido, devido aos entregadores (repasse sem registro), cancelamentos; histórico paginado; exportação CSV | SQL + interface |
| Pagamentos | Transações reais (cobranças) com filtros, origem (Mercado Pago × manual), ID do provedor e eventos; nada é marcado como pago sem confirmação do provedor ou baixa manual registrada; estornos dependem do aviso do provedor (ainda não integrado) | SQL + interface |
| Auditoria | 20 por página no banco, Anterior/Próxima, página e total, filtros por data, ação e usuário | SQL + interface |
| Entregadores | A tela abria filtrada em "Pendentes" e escondia os aprovados (os 2 entregadores de teste estão aprovados). Agora abre em "Todos", com busca, situação, online/offline, entregas reais e histórico | SQL + interface |
| Estabelecimentos | Cards responsivos (1/2/3–4 por linha), imagem, cidade, tipo, status; filtros por situação, cidade, categoria e tipo; detalhes com aprovar, recusar, suspender e reativar | SQL + interface |
| Cidades | Busca no banco sem acento e sem diferenciar maiúsculas, filtro MG/SP, limite de resultados, espera de 250 ms entre teclas, botão de limpar, aviso de "sem resultados"; coluna `ibge_code` única (sem inventar códigos) | SQL + interface |
| Privacidade, Configurações, Segurança | Sem mudança funcional; testes existentes seguem passando | — |
| Conta e tema | Menu de conta único no site e no Master: inicial, primeiro nome real, perfil ativo e atalhos. Sem sessão: "Entrar / Criar conta". Modo claro, escuro ou automático | Interface |

## Etapa 1 — Auditoria (bloqueios encontrados)

| # | Bloqueio | Gravidade | Situação |
|---|---|---|---|
| 1 | Banco publicado parado na 0015 (0016–0021 nunca aplicadas) | Crítica | **Pendente: rodar o SQL** |
| 2 | Estabelecimentos de teste visíveis na busca pública de produção e vagas de teste públicas | Crítica | Corrigido na 0022 |
| 3 | Conta de teste podia comprar em loja real e cliente real em loja de teste; entregador real recebia oferta de teste | Crítica | Corrigido na 0022 |
| 4 | Oferta de entrega sem prazo, sem recusa, sem redistribuição e sem alerta quando ninguém aceita | Alta | Corrigido na 0022 |
| 5 | Master sem tela de pedidos, sem histórico, sem tratar ocorrências | Alta | Corrigido (aba Pedidos) |
| 6 | Papel "cozinha" podia aceitar, recusar e cancelar pedidos | Média | Corrigido (só preparo) |
| 7 | Sem tempo estimado de preparo | Média | Corrigido (aceite com previsão) |
| 8 | Painéis atualizavam só por consulta periódica (15–30 s) | Média | Tempo real (Supabase Realtime) + consulta periódica de reserva |
| 9 | Login levava todos para "Minha conta" (sem redirecionamento por perfil) | Média | Corrigido |
| 10 | Contas de teste só para 5 perfis | Média | 9 perfis, sem duplicar |
| 11 | Pedidos de teste entrariam no financeiro da plataforma | Média | Corrigido (excluídos) |
| 12 | Pagamento de pedidos só na entrega (dinheiro, Pix ou maquininha); sem pagamento online | Decisão | Ver "Pagamentos" |
| 13 | Taxa de entrega fixa (R$ 4 / 2 / 5 / 1); não varia com a distância | Decisão | Sem serviço de mapas contratado |
| 14 | MFA dos administradores desligado por padrão | Alta (antes do piloto) | Ativar em Painel → Segurança |
| 15 | Apenas 1 projeto Supabase (não há homologação separada) | Alta | Isolamento lógico feito; projeto separado recomendado |
| 16 | Fotos dos produtos: só por link https (sem upload) | Baixa | O restaurante de teste fica sem fotos (nada inventado) |
| 17 | Suporte: sem sistema de chamados (contato por WhatsApp e aba Logins) | Baixa | Pendente |

O que já existia e funciona:
- pedidos com preço calculado no servidor (0011);
- idempotência contra clique duplo;
- aceite atômico do entregador (0012);
- código de 4 dígitos na entrega;
- RLS por cliente, estabelecimento e entregador;
- limite de requisições (rate limiting);
- auditoria;
- cadastro e aprovação de estabelecimentos e entregadores;
- recuperação de senha;
- sessão persistente;
- logout.

## O que foi implementado (0022 + interface)

**Isolamento entre teste e produção:**
- Estabelecimentos e pedidos de teste são marcados (`is_test`). Só a plataforma consegue mudar essa marca.
- Só contas de teste e a equipe veem estabelecimentos e vagas de teste.
- Uma conta de teste só compra em loja de teste. Um cliente real não compra em loja de teste.
- Ofertas de teste só chegam a entregadores de teste.
- Pedidos de teste ficam fora do financeiro.

**Despacho:**
- Cada oferta tem prazo de 5 min.
- O entregador pode recusar. Se todos os aptos recusarem, a rodada termina na hora.
- A oferta expira e volta para todos (até 3 rodadas). Depois disso, o restaurante e o Master recebem um alerta.
- Se o entregador aceitar e não coletar em 40 min, também há alerta.
- O entregador pode liberar a entrega antes da coleta.
- O Master pode redistribuir a entrega.
- O entregador pode compartilhar a localização, se quiser. Ela é apagada quando ele fica indisponível.
- Com pg_cron habilitado, a varredura das ofertas roda a cada minuto. Sem ele, roda quando os painéis são abertos.

**Restaurante e cozinha:**
- O pedido é aceito com tempo de preparo, e o cliente vê a previsão.
- A cozinha só inicia e conclui o preparo.

**Master (aba Pedidos):**
- Filtros: em andamento, com alerta, concluídos, cancelados.
- Detalhe do pedido com itens, valores, envolvidos, entrega, histórico e quem fez cada passo.
- Cancelar e redistribuir exigem a permissão `orders.manage` e ficam na Auditoria.

**Contas de homologação:**
- A aba Logins → Dados de teste cria os perfis: dono do restaurante, funcionário, cozinha, lojista, prestador de serviços, 2 entregadores independentes, 2 clientes e operador administrativo. O Master é a sua conta.
- Se já houver lote na cidade, só cria os perfis que faltam. A senha aparece uma única vez e nunca é gravada.

**Tempo real:** pedidos e notificações são publicados no Supabase Realtime, que respeita a RLS. A interface atualiza sem recarregar e recarrega o estado quando a conexão volta.

**Redirecionamento por perfil:**
- equipe da plataforma → `/admin`;
- dono → painel;
- atendimento e cozinha → pedidos;
- entregador → área do entregador.

## Testes e evidências

| Suíte | Resultado | Evidência |
|---|---|---|
| SQL (PostgreSQL 16 descartável, RLS e papéis reais): 17 suítes | **Aprovada** | `npm run test:sql` (`E2E_HOMOLOGACAO_OK` + 16 suítes de segurança) |
| Teste de ponta a ponta no banco (`supabase/tests/e2e_homologacao.sql`) | **Aprovado**, os 15 passos | Saída `E2E passo 1 … 15` |
| Interface (Vitest): 71 arquivos, 357 testes | **Aprovada** | `npx vitest run` |
| Pacote SQL aplicado 2 vezes num banco vazio | **Aprovado** (22 aplicadas; a 2ª execução não muda nada) | — |
| Roteiro Playwright, etapa pública, no site publicado | **Reprovado** (esperado até rodar o SQL): 2 "[Teste]" visíveis ao visitante | `scripts/e2e-homologacao.mjs` |
| Roteiro Playwright com login (cliente, restaurante, cozinha, entregador, Master) | **Não executado** | Exige o banco publicado com a 0022 e as credenciais de homologação em variáveis de ambiente |

**Cenário obrigatório validado no banco:**
1. Login do cliente de teste.
2. Escolha do restaurante de homologação.
3. Dois produtos no pedido, com adicionais.
4. Pedido feito com pagamento na entrega (sem cobrança online).
5. O restaurante recebe e é notificado.
6. O funcionário confirma com 20 min de preparo.
7. A cozinha prepara.
8. O pedido fica pronto e a oferta é criada com prazo.
9. Os entregadores de teste são notificados; o entregador real não vê a oferta.
10. O entregador 1 aceita; o 2 tenta e é recusado.
11. A coleta é feita e o cliente vê "saiu para entrega".
12. A entrega é concluída com o código do cliente; um código errado não conclui.
13. O cliente vê "entregue".
14. O Master e o operador veem o histórico, com quem fez cada passo.
15. Conferidos no banco:
    - valores: R$ 58,00 em produtos; R$ 4 de taxa; total R$ 62; comissão de 2% (R$ 1,16); restaurante R$ 2; entregador R$ 5; plataforma R$ 1;
    - a sequência de eventos;
    - a auditoria;
    - o pedido fora do financeiro.

**Falhas testadas:**
- restaurante recusa (com motivo obrigatório);
- cliente cancela antes do aceite;
- entregador recusa;
- todos recusam e a rodada termina na hora;
- oferta expira e é redistribuída;
- alerta para o restaurante e o Master;
- Master redistribui;
- Master cancela com motivo e a entrega é cancelada junto;
- entregador libera e a oferta volta para os outros;
- dois entregadores na mesma corrida;
- clique duplo;
- localização apagada ao ficar offline;
- sessão perdida;
- acessos não autorizados (cliente × cliente, estabelecimento × estabelecimento, entregador × entregador, cliente no painel Master, operador sem permissão de cancelar).

**Limites:**
- A concorrência real (duas transações ao mesmo tempo) é garantida pelo `UPDATE` condicional único. O teste simula a segunda tentativa em sequência.
- "Conexão cai" e "recarregar a página" são cobertos assim:
  - o estado mora no banco;
  - a interface recarrega ao reconectar (teste do tempo real);
  - o roteiro Playwright recarrega a página.
- "Pagamento falha" não se aplica aos pedidos: não há pagamento online.

## Pendências de configuração (precisam de você)

1. **Rodar `supabase/admin/apply_all_migrations.sql`** no SQL Editor do Supabase. Pode rodar mais de uma vez: ele pula o que já foi aplicado.
2. **Ativar o MFA dos administradores:** cadastre o seu fator TOTP e marque "Exigir MFA" em Painel → Segurança.
3. **E-mail de recuperação de senha:** configurar o SMTP próprio em Supabase → Authentication. O envio padrão do Supabase tem limite baixo.
4. **Pagamentos dos pedidos:** decidir se o piloto segue com pagamento na entrega ou se vamos integrar o checkout do Mercado Pago aos pedidos. Para a segunda opção, preciso das credenciais de **teste** (sandbox) do Mercado Pago. As mensalidades já usam o Mercado Pago (aba Pagamentos), com o segredo `PAYMENTS_INTEGRATION_KEY` no Cloudflare.
5. **Ambiente separado (recomendado):** um segundo projeto Supabase só para homologação, com o seu `VITE_SUPABASE_URL` em um Worker de homologação.
6. **pg_cron (opcional):** habilite em Database → Extensions antes de rodar o SQL para a varredura de ofertas rodar a cada minuto.
7. **Rodar o roteiro na interface** depois do passo 1:
   - crie as contas na aba Logins → Dados de teste;
   - defina `E2E_BASE_URL`, `E2E_PASSWORD`, `E2E_CLIENTE`, `E2E_DONO`, `E2E_COZINHA`, `E2E_ENTREGADOR` e `E2E_RESTAURANTE_SLUG`;
   - rode `node scripts/e2e-homologacao.mjs`;
   - as capturas e o `relatorio.json` ficam em `e2e-evidence/`.

## Checklist de prontidão comercial

| Item | Situação |
|---|---|
| Solicitação de cadastro do estabelecimento | Pronto (`/cadastrar-negocio`) |
| Aprovação pelo Master | Pronto (Estabelecimentos) |
| Acesso do proprietário e funcionários (atendente, cozinha, gerente) | Pronto; papéis com permissões no banco |
| Configuração da loja, horários e cardápio com adicionais | Pronto (painel); fotos só por link |
| Configuração de entrega (parceira, própria, retirada) | Pronto; taxa parceira fixa, sem distância |
| Recebimento de pedidos em tempo real | Pronto após o SQL (Realtime) |
| Despacho para entregadores independentes | Pronto após o SQL |
| Acompanhamento operacional pelo Master | Pronto após o SQL (aba Pedidos) |
| Relatórios do estabelecimento | Pronto (Vendas) |
| Financeiro da plataforma e mensalidades | Pronto; Mercado Pago depende da sua configuração |
| Pagamento online dos pedidos | **Não implementado** (decisão pendente) |
| MFA administrativo | **Desligado**; ativar antes do piloto |
| Suporte | Contato por WhatsApp; troca de senha e usuário pela aba Logins; sem chamados |
| Evidência na interface no ambiente publicado | **Pendente** (roteiro pronto) |

## Tucaí Gestão, cobertura nacional, anúncios e manutenção (pendente de aplicação)

Ver `docs/EXPANSAO_ANUNCIOS_MANUTENCAO.md` (ordem de aplicação, regras e testes) e `docs/RASTREAMENTO.md`
(arquitetura do rastreamento — só documentação). Suítes locais: 24 SQL + 415 testes de interface passando.
