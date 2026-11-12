# Cobertura nacional, publicações patrocinadas e modo manutenção

> **Nada disto foi aplicado no banco remoto nem publicado.** Migrations 0024–0030 aguardam autorização.

## Ordem de aplicação (quando autorizado)

1. `supabase/admin/apply_all_migrations.sql` no SQL Editor (idempotente; aplica 0001–0030, pula as já aplicadas).
2. `supabase/admin/municipios_ibge.sql` — importa os 5.571 municípios (upsert, idempotente), liga as cidades já
   atendidas ao código IBGE (as 58 atuais foram ligadas no teste local) e cria as 6 regiões de exemplo **como rascunho**.
   Gerado por `node scripts/ibge/gerar_municipios_sql.mjs` (base pública que compila códigos/nomes do IBGE e as
   coordenadas das sedes). Com acesso à API oficial do IBGE, rode `IBGE_VALIDAR=1 node scripts/ibge/gerar_municipios_sql.mjs`
   para conferir códigos e nomes contra `servicodados.ibge.gov.br` (neste ambiente a API oficial estava bloqueada pela rede).
3. Deploy do Worker (inclui `/api/health`).

## Cobertura nacional e regiões (Administração → Regiões)

* Estrutura: Brasil → UF (27) → região comercial → município (código IBGE). Municípios não ficam no código.
* Região = município central + raio em km (linha reta, haversine). Município pode estar em várias regiões; tem **uma**
  região principal (ativa > outra > administrativa; mais perto vence).
* Município fora de todo raio → **cobertura administrativa da UF**, contado como **lacuna** (aba Lacunas).
* Gerador (aba Gerador): sugere centros entre os municípios descobertos, até 100 por execução; cria como rascunho.
  Teste local com a base real: 351 sugestões + 6 iniciais = **100% dos 5.571 municípios** em algum raio de 100 km,
  cada lote de 100 em < 1 s.
* Separação exibida no painel: municípios cadastrados · dentro de raio · em regiões ativas · lacunas · cidades atendidas ·
  cidades com loja operando. O raio de entrega continua sendo de cada estabelecimento.
* Nada é ativado sozinho. Região com campanha paga em andamento não pode mudar centro/raio, ser pausada/desativada
  nem perder municípios.

## Publicações patrocinadas

* Conecta → menu da publicação do estabelecimento → **Turbinar publicação** (proprietário/gerente) → Tucaí Gestão → Anúncios.
* Mínimo: R$ 10 por campanha e R$ 5/dia por região (configurável em Administração → Anúncios). Diário = total ÷ dias.
  Preço final aparece antes de contratar. Cobrança fixa pelo período e regiões, sem promessa de alcance.
* Pagamento: a campanha gera uma cobrança e abre o checkout existente do Mercado Pago. A baixa (webhook com valor
  conferido, sem duplicidade, ou registro manual do Master) marca a campanha como paga.
* **Ativa somente com pagamento confirmado + aprovação do Master.** O período começa na ativação; expira sozinha.
* Feed: cidade escolhida pela pessoa → regiões ativas da campanha. Primeiro patrocinado no topo, depois 1 a cada N
  publicações; teto de campanhas diferentes por pessoa/dia. Etiqueta "Patrocinado" sempre visível.
* Métricas: impressão (50% visível) e clique únicos por pessoa/campanha/dia, com chave em hash (sem id da pessoa);
  clique só conta com impressão; equipe da própria loja não conta.
* Recusa de campanha já paga: marcada "reembolso pendente" — o reembolso é feito pelo Master no Mercado Pago (não automático).

## Modo manutenção (Administração → Configurações)

* Estados: **NORMAL → PREPARANDO MANUTENÇÃO → EM MANUTENÇÃO → NORMAL**. Exige Master com MFA nesta sessão, motivo e
  confirmação digitada (MANUTENCAO / NORMAL). Tudo auditado com quem, quando, motivo e operações em andamento.
* Bloqueio no banco (gatilho em ~40 tabelas + checkout): vale para RPCs e para escrita direta pela API.
  * Preparando: sem pedidos, comandas, caixas, campanhas, publicações ou alterações novas; pedidos já feitos seguem
    (aceite, preparo, entregador assume, coleta, código, entrega); comandas abertas podem ser fechadas.
  * Em manutenção: além disso, ninguém assume corrida nova nem aceita pedido; entregas em rota terminam; comandas e
    caixas abertos podem ser fechados (com pagamento registrado).
  * Sempre liberado: Master (MFA); processos sem usuário (webhook de pagamento via Worker, varreduras); notificações e
    auditoria geradas por operações permitidas. Nada é cancelado, apagado ou interrompido no meio da gravação.
* Página pública (todos menos Master e /admin): TUCAÍ, "Estamos em manutenção!", previsão de retorno se configurada.
* Retorno ao normal mostra as verificações de integridade (pedido em rota sem coleta, comanda com pagamento diferente
  do total, caixa aberto > 24 h, campanha vencida ativa).
* Saúde: `GET /api/health` → `{ ok, worker, db, mode, ms }` (503 se o banco não responder).
* Recuperação independente: `supabase/admin/manutencao_recuperar.sql` no SQL Editor (volta ao normal e audita).

## Testes executados (local, PostgreSQL 16 descartável — nunca o banco remoto)

* `rls_regioes.sql`: importação idempotente, busca sem acento, haversine, raio, sobreposição, região principal única,
  lacuna administrativa, permissões (cliente/visitante/Master), inclusão/retirada manual lembrada, gerador 100%, auditoria.
* `rls_publicidade.sql`: preço mínimo, região inativa, permissão (atendente/cliente), idempotência da operação, uma
  campanha por publicação, cobrança pagável pelo checkout, fora do feed sem pagamento/aprovação, trava da região,
  ativação, distribuição regional, impressões/cliques únicos, equipe não conta, cancelamento/recusa anulam a cobrança,
  expiração automática, métricas do Master.
* `rls_manutencao.sql`: cliente durante manutenção, lojista com pedido em andamento, entregador com entrega ativa
  (coleta + código + entrega concluídos em manutenção), funcionário fechando comanda e caixa, webhook confirmando
  pagamento (e reenvio sem duplicar), acesso direto à API bloqueado, Master sem MFA/operador barrados, Master operando,
  retorno sem perda (pedidos, entregas, cobranças preservados; integridade zerada), recuperação manual (simula falha do app).
* Não testado aqui: reinício real do Worker/Cloudflare e carga concorrente em produção.
