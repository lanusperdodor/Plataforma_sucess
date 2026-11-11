# Multicidades — área de atendimento por raio (IBGE + Haversine)

## Regras

| Conceito | Valor | Onde | O que controla |
|---|---|---|---|
| Sede | Itaú de Minas/MG (IBGE 3133758) | `public.regional_settings.hq_ibge_code` | Origem das distâncias |
| Área de atendimento | 100 km, MG e SP | `regional_settings.service_radius_km`, `eligible_states` | Quais cidades podem ser cadastradas e ativadas |
| Raio regional de descoberta | 200 km | `regional_settings.discovery_radius_km`, `public.discover_cities()` | Até onde o cliente enxerga cidades **ativas** próximas |
| Área de entrega | por estabelecimento | `businesses.delivery_radius_km` + `lat/lng` da loja, `public.business_delivers_to()` | Até onde **aquela loja** entrega |

Cidade ativa não significa que alguma loja entrega lá; descoberta não amplia a entrega.

## Base de municípios

- Fonte: [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) (`csv/municipios.csv`): 5.570 municípios + DF, com código IBGE e coordenadas da sede municipal. A API de localidades do IBGE não publica coordenadas.
- `scripts/ibge-municipios.mjs` valida a base inteira (7 dígitos + dígito verificador do IBGE, com as 9 exceções oficiais; prefixo da UF; sem duplicatas; MG = 853 e SP = 645; coordenadas dentro dos limites do estado) e gera:
  - `supabase/reference/ibge_municipios_mg_sp.csv` (1.498 municípios, versionado);
  - `supabase/migrations/0009_ibge_municipios_mg_sp.sql` (tabela `private.ibge_municipalities`).
- `npm run ibge:check` confere se o SQL corresponde ao CSV versionado. Para atualizar a base: baixe o CSV de novo e rode `node scripts/ibge-municipios.mjs <arquivo>`.

## Resultado (100 km de Itaú de Minas)

58 municípios: 38 em MG e 20 em SP. Limites: Jeriquara/SP a 99,4 km (dentro), Medeiros/MG a 100,4 km (fora). O mesmo número é conferido no banco (`rls_multicidades.sql`, com uma fórmula independente, a lei dos cossenos) e no front (`src/lib/geo.test.ts`).

## Situação das cidades

`planned` (planejada) → `active` (ativa) → `suspended` (suspensa, exige motivo) → `active` ou `planned`.

- Itaú de Minas começa ativa; as demais entram planejadas.
- Para ativar, a cidade precisa ter código IBGE, coordenadas e estar dentro da área de atendimento (o servidor confere).
- Cidade suspensa ou planejada não aparece no seletor, e as lojas dela saem do catálogo público.
- Toda mudança de situação fica na auditoria (`city.status`), com limite de frequência (`admin.city`).
- `is_active` continua existindo e é mantida em sincronia com `status` por gatilho + CHECK.

## Painel Master (Cidades)

- Cobertura: sede, raios, cidades elegíveis e contagem por situação.
- Avisos: municípios do raio que faltam (botão "Cadastrar como planejadas"), cidades antigas sem código IBGE (vincular por código; o servidor confere nome e UF), cidades fora da área e centros que divergem mais de 5 km da sede IBGE.
- Busca por nome (sem acento) ou código IBGE; filtros por UF, situação e distância da sede.
- Ações: Ativar, Suspender (com motivo), Reativar, Voltar a planejada. Cadastro manual livre foi removido (`admin_save_city`).

## Aplicando no banco existente (manual, com autorização)

As migrations **não** foram aplicadas no Supabase remoto. Num banco que já tem as 0001–0008, aplique na ordem `0009_ibge_municipios_mg_sp.sql` e depois `0010_multicidades_raio.sql`. O `apply_all_migrations.sql` é só para banco vazio.

O que a 0010 faz com os dados existentes:

- Vincula ao IBGE apenas as cidades cujo nome e UF batem exatamente com a base (sem considerar acento ou maiúsculas); não renomeia nada.
- Preenche coordenadas só onde estavam vazias; coordenadas já definidas são mantidas (as divergentes aparecem no painel).
- Mapeia a situação sem perder informação: ativa → `active`; inativa que já teve loja → `suspended`; inativa sem loja → `planned`.
- Cidades ativas fora da área ou sem código IBGE ficam como estão e aparecem no painel para decisão.
- Se alguma cidade existente tiver o mesmo slug de um município elegível sem corresponder a ele, a migration aborta com a lista, para revisão.
- Lojas ativas em cidades não ativas saem do catálogo público (antes já não eram alcançáveis pelo seletor).

Antes de aplicar, rode `select id, name, state, is_active from public.cities order by state, name;` no banco remoto e confira o resultado com a lista acima.
