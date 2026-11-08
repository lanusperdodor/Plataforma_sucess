-- =====================================================================================
-- SEED DE DEMONSTRAÇÃO: Itaú de Minas/MG  (parte 1: catálogo)
--
-- ATENÇÃO: DADOS FICTÍCIOS, SOMENTE PARA DESENVOLVIMENTO E PRÉVIA.
--   * NÃO aplicar em produção. Não é uma migration (fica fora de supabase/migrations/).
--   * Todas as linhas que possuem a coluna is_demo são gravadas com is_demo = true.
--   * Nomes de estabelecimentos levam o sufixo "(demo)"; avaliações usam nomes genéricos.
--   * Não cria promoções, selos ou cupons (virão de campanhas reais na migration 0004).
--   * Não cria usuários reais: o dono fictício usa e-mail @demo.invalid e não tem senha.
--
-- Idempotente: UUIDs determinísticos com prefixo reconhecível 'de0de0' (ver pg_temp.demo_id)
-- e "on conflict do nothing". Pode ser aplicado várias vezes no mesmo banco.
--
-- Dono fictício (auth.users):
--   * No PostgreSQL de teste (supabase/tests/local_auth_stub.sql) o INSERT abaixo basta.
--   * No Supabase REAL o schema auth exige outras colunas e o fluxo normal é a API do Auth.
--     Crie o usuário fictício (demo-owner@demo.invalid) pelo painel ou CLI
--     (ex.: "supabase auth admin create-user" / Dashboard > Authentication > Add user) e
--     troque DEMO_OWNER_ID abaixo pelo id gerado, ou ajuste o INSERT às colunas exigidas.
--
-- COMO REMOVER (execute manualmente; ordem importa, pois businesses.owner_id não tem cascade):
--   delete from public.businesses where is_demo;   -- cascata: horários, cardápio, produtos,
--                                                  -- adicionais, serviços, avaliações, membros
--   delete from public.categories where is_demo;
--   delete from public.cities     where is_demo;
--   delete from auth.users        where email = 'demo-owner@demo.invalid';
-- =====================================================================================

begin;

-- ID determinístico: prefixo 'de0de0' + 26 hex de md5(chave). Existe só nesta sessão.
create or replace function pg_temp.demo_id(_key text) returns uuid
language sql immutable as $$ select ('de0de0' || substr(md5('demo-itau:' || _key), 7))::uuid $$;

-- ---------- dono fictício ----------
-- (o gatilho on_auth_user_created cria profile e papel customer)
insert into auth.users (id, email)
values (pg_temp.demo_id('owner'), 'demo-owner@demo.invalid')
on conflict do nothing;

-- ---------- cidade ----------
insert into public.cities (id, name, state, slug, center_lat, center_lng, is_active, is_demo)
values (pg_temp.demo_id('city:itau-de-minas'), 'Itaú de Minas', 'MG', 'itau-de-minas',
        -20.738900, -46.759700, true, true)
on conflict do nothing;

-- ---------- categorias (ícones Lucide) ----------
insert into public.categories (id, slug, label, kind, icon, sort_order, is_demo)
select pg_temp.demo_id('cat:' || v.slug), v.slug, v.label, v.kind, v.icon, v.ord, true
from (values
  ('lanches',   'Lanches',   'restaurante', 'Sandwich',        1),
  ('pizzas',    'Pizzas',    'restaurante', 'Pizza',           2),
  ('marmitas',  'Marmitas',  'restaurante', 'UtensilsCrossed', 3),
  ('acai',      'Açaí',      'restaurante', 'IceCreamBowl',    4),
  ('farmacia',  'Farmácia',  'loja',        'Pill',            5),
  ('roupas',    'Roupas',    'loja',        'Shirt',           6),
  ('calcados',  'Calçados',  'loja',        'Footprints',      7),
  ('beleza',    'Beleza',    'servico',     'Scissors',        8),
  ('servicos',  'Serviços',  'servico',     'Wrench',          9),
  ('vagas',     'Vagas',     'vaga',        'Briefcase',      10)
) as v(slug, label, kind, icon, ord)
on conflict do nothing;

-- ---------- estabelecimentos ----------
-- 6 restaurantes + 3 lojas + 3 prestadores de serviço, todos ativos.
-- Coordenadas ao redor do centro da cidade; distance_estimate_km é estimativa aproximada.
insert into public.businesses (
  id, name, slug, owner_id, status, business_type, category_id, city_id, description,
  address_line, lat, lng, distance_estimate_km, delivery_offer, own_delivery_fee_cents,
  accepts_pickup, estimated_min_minutes, estimated_max_minutes, min_order_cents, price_tier,
  popularity_score, is_featured, is_demo)
select pg_temp.demo_id('biz:' || v.k), v.name, v.slug, pg_temp.demo_id('owner'), 'active',
       v.btype::public.business_type, pg_temp.demo_id('cat:' || v.cat),
       pg_temp.demo_id('city:itau-de-minas'), v.descr, v.addr, v.lat, v.lng, v.dist,
       v.offer::public.delivery_offer, v.fee, v.pickup, v.tmin, v.tmax, v.minorder, v.tier,
       v.pop, v.feat, true
from (values
  -- k, name, slug, btype, cat, descr, addr, lat, lng, dist, offer, fee, pickup, tmin, tmax, minorder, tier, pop, feat
  ('lanchonete',   'Lanchonete Exemplo (demo)',   'lanchonete-exemplo-demo',   'restaurante', 'lanches',
   'Estabelecimento fictício de demonstração.', 'Rua Exemplo, 100 (demo)',
   -20.738000, -46.759000, 0.2, 'partner', 0,   true,  25, 40, 1500, 1, 90, true),
  ('pizzaria',     'Pizzaria Modelo (demo)',      'pizzaria-modelo-demo',      'restaurante', 'pizzas',
   'Estabelecimento fictício de demonstração (atende à noite, atravessa a meia-noite).', 'Av. Modelo, 250 (demo)',
   -20.741500, -46.762000, 0.6, 'own',     600, true,  35, 55, 3000, 2, 80, false),
  ('marmitaria',   'Marmitaria Teste (demo)',     'marmitaria-teste-demo',     'restaurante', 'marmitas',
   'Estabelecimento fictício de demonstração (almoço em dias úteis).', 'Rua Teste, 45 (demo)',
   -20.736500, -46.757000, 0.5, 'own',     400, false, 30, 45, 1800, 1, 70, false),
  ('acai',         'Açaí Fictício (demo)',        'acai-ficticio-demo',        'restaurante', 'acai',
   'Estabelecimento fictício de demonstração.', 'Praça Fictícia, 12 (demo)',
   -20.739800, -46.756500, 0.4, 'partner', 0,   false, 20, 35, 1200, 2, 60, false),
  ('hamburgueria', 'Hamburgueria Amostra (demo)', 'hamburgueria-amostra-demo', 'restaurante', 'lanches',
   'Estabelecimento fictício de demonstração (noite até a meia-noite).', 'Rua Amostra, 300 (demo)',
   -20.743000, -46.764000, 1.1, 'none',    0,   true,  25, 40, 2000, 3, 85, false),
  ('sorveteria',   'Sorveteria Quase Fechada (demo)', 'sorveteria-quase-fechada-demo', 'restaurante', 'acai',
   'Estabelecimento fictício de demonstração (praticamente sempre fechado).', 'Rua Silêncio, 1 (demo)',
   -20.735000, -46.761000, 0.9, 'none',    0,   true,  15, 30, 0,    1, 10, false),
  ('farmacia',     'Farmácia Exemplo (demo)',     'farmacia-exemplo-demo',     'loja',        'farmacia',
   'Loja fictícia de demonstração.', 'Rua da Amostra, 10 (demo)',
   -20.738500, -46.760500, 0.1, 'partner', 0,   true,  30, 50, 0,    2, 75, false),
  ('roupas',       'Moda Modelo (demo)',          'moda-modelo-demo',          'loja',        'roupas',
   'Loja fictícia de demonstração.', 'Rua Moda, 77 (demo)',
   -20.740500, -46.758000, 0.3, 'own',     800, true,  60, 120, 5000, 2, 50, false),
  ('calcados',     'Calçados Teste (demo)',       'calcados-teste-demo',       'loja',        'calcados',
   'Loja fictícia de demonstração.', 'Av. Passos, 500 (demo)',
   -20.742000, -46.755500, 0.8, 'none',    0,   true,  null, null, 0,   2, 40, false),
  ('beleza',       'Salão Exemplo (demo)',        'salao-exemplo-demo',        'servico',     'beleza',
   'Prestador fictício de demonstração.', 'Rua Beleza, 8 (demo)',
   -20.739000, -46.758500, 0.2, 'none',    0,   false, null, null, 0,   2, 55, false),
  ('eletricista',  'Eletricista Modelo (demo)',   'eletricista-modelo-demo',   'servico',     'servicos',
   'Prestador fictício de demonstração.', 'Atendimento a domicílio (demo)',
   -20.737500, -46.762500, 0.7, 'none',    0,   false, null, null, 0,   2, 45, false),
  ('diarista',     'Limpeza Teste (demo)',        'limpeza-teste-demo',        'servico',     'servicos',
   'Prestador fictício de demonstração.', 'Atendimento a domicílio (demo)',
   -20.741000, -46.757500, 0.6, 'none',    0,   false, null, null, 0,   1, 35, false)
) as v(k, name, slug, btype, cat, descr, addr, lat, lng, dist, offer, fee, pickup,
       tmin, tmax, minorder, tier, pop, feat)
on conflict do nothing;

-- ---------- dono como business_members owner ----------
insert into public.business_members (business_id, user_id, member_role)
select pg_temp.demo_id('biz:' || k), pg_temp.demo_id('owner'), 'owner'
from unnest(array['lanchonete','pizzaria','marmitaria','acai','hamburgueria','sorveteria',
                  'farmacia','roupas','calcados','beleza','eletricista','diarista']) as k
on conflict do nothing;

-- ---------- horários (weekday 0 = domingo; closes < opens atravessa a meia-noite) ----------
insert into public.business_hours (id, business_id, weekday, opens, closes)
select pg_temp.demo_id('hr:' || v.k || ':' || wd), pg_temp.demo_id('biz:' || v.k),
       wd, v.opens::time, v.closes::time
from (values
  ('lanchonete',   array[0,1,2,3,4,5,6], '10:00', '22:00'),
  ('pizzaria',     array[0,1,2,3,4,5,6], '18:00', '01:00'),  -- janela noturna: atravessa a meia-noite
  ('marmitaria',   array[1,2,3,4,5],     '11:00', '14:30'),
  ('acai',         array[0,1,2,3,4,5,6], '13:00', '23:00'),
  ('hamburgueria', array[0,1,2,3,4,5,6], '18:00', '24:00'),
  ('sorveteria',   array[1],             '06:00', '06:30'),  -- fechado na maior parte do tempo
  ('farmacia',     array[0,1,2,3,4,5,6], '08:00', '20:00'),
  ('roupas',       array[1,2,3,4,5,6],   '09:00', '18:00'),
  ('calcados',     array[1,2,3,4,5,6],   '09:00', '18:00'),
  ('beleza',       array[2,3,4,5,6],     '09:00', '18:00'),
  ('eletricista',  array[1,2,3,4,5],     '08:00', '17:00'),
  ('diarista',     array[1,2,3,4,5],     '08:00', '17:00')
) as v(k, wds, opens, closes), unnest(v.wds) as wd
on conflict do nothing;

-- ---------- categorias do cardápio ----------
insert into public.menu_categories (id, business_id, name, sort_order, is_demo)
select pg_temp.demo_id('mc:' || v.k || ':' || v.mk), pg_temp.demo_id('biz:' || v.k), v.name, v.ord, true
from (values
  ('lanchonete',   'lanches',  'Lanches',  1), ('lanchonete',   'bebidas', 'Bebidas', 2),
  ('pizzaria',     'pizzas',   'Pizzas',   1), ('pizzaria',     'bebidas', 'Bebidas', 2),
  ('marmitaria',   'marmitas', 'Marmitas', 1), ('marmitaria',   'bebidas', 'Bebidas', 2),
  ('acai',         'acai',     'Açaí',     1), ('acai',         'cremes',  'Cremes',  2),
  ('hamburgueria', 'burgers',  'Burgers',  1), ('hamburgueria', 'porcoes', 'Porções', 2),
  ('sorveteria',   'sorvetes', 'Sorvetes', 1)
) as v(k, mk, name, ord)
on conflict do nothing;

-- ---------- produtos (preço em centavos; image_url null = sem foto) ----------
insert into public.products (id, business_id, category_id, name, description, price_cents,
                             image_url, is_available, is_popular, sort_order, is_demo)
select pg_temp.demo_id('pr:' || v.k || ':' || v.pk), pg_temp.demo_id('biz:' || v.k),
       pg_temp.demo_id('mc:' || v.k || ':' || v.mk), v.name, v.descr, v.price,
       null, true, v.pop, v.ord, true
from (values
  -- k, mk, pk, name, descr, price, pop, ord
  ('lanchonete',   'lanches',  'x-salada',  'X-Salada',          'Pão, hambúrguer, queijo e salada.', 1800, true,  1),
  ('lanchonete',   'lanches',  'x-bacon',   'X-Bacon',           'Pão, hambúrguer, queijo e bacon.',  2200, false, 2),
  ('lanchonete',   'lanches',  'misto',     'Misto Quente',      'Pão, presunto e queijo.',           1200, false, 3),
  ('lanchonete',   'bebidas',  'refri',     'Refrigerante Lata', null,                                 600, false, 1),
  ('lanchonete',   'bebidas',  'suco',      'Suco Natural',      'Sabor do dia.',                      900, false, 2),
  ('pizzaria',     'pizzas',   'mussarela', 'Pizza Mussarela',   'Molho, mussarela e orégano.',       3800, true,  1),
  ('pizzaria',     'pizzas',   'calabresa', 'Pizza Calabresa',   'Calabresa e cebola.',               4200, false, 2),
  ('pizzaria',     'pizzas',   'portuguesa','Pizza Portuguesa',  'Presunto, ovo, cebola e azeitona.', 4600, false, 3),
  ('pizzaria',     'bebidas',  'refri2l',   'Refrigerante 2L',   null,                                1200, false, 1),
  ('marmitaria',   'marmitas', 'pequena',   'Marmita Pequena',   'Arroz, feijão, mistura e salada.',  1800, false, 1),
  ('marmitaria',   'marmitas', 'media',     'Marmita Média',     'Arroz, feijão, mistura e salada.',  2200, true,  2),
  ('marmitaria',   'marmitas', 'grande',    'Marmita Grande',    'Arroz, feijão, mistura e salada.',  2800, false, 3),
  ('marmitaria',   'bebidas',  'suco',      'Suco Copo',         null,                                 600, false, 1),
  ('acai',         'acai',     'acai',      'Açaí no Copo',      'Açaí batido com guaraná.',          1500, true,  1),
  ('acai',         'acai',     'acai500',   'Açaí 500 ml',       'Açaí batido com guaraná.',          2100, false, 2),
  ('acai',         'cremes',   'cupuacu',   'Creme de Cupuaçu',  null,                                1400, false, 1),
  ('hamburgueria', 'burgers',  'classico',  'Burger Clássico',   'Pão brioche, carne 150 g e queijo.',2600, true,  1),
  ('hamburgueria', 'burgers',  'duplo',     'Burger Duplo',      'Duas carnes, queijo e molho.',      3400, false, 2),
  ('hamburgueria', 'porcoes',  'batata',    'Batata Frita',      'Porção individual.',                1800, false, 1),
  ('sorveteria',   'sorvetes', 'casquinha', 'Casquinha',         null,                                 600, false, 1),
  ('sorveteria',   'sorvetes', 'taca',      'Taça de Sorvete',   'Três bolas com calda.',             1200, false, 2),
  ('sorveteria',   'sorvetes', 'picole',    'Picolé',            null,                                 500, false, 3)
) as v(k, mk, pk, name, descr, price, pop, ord)
on conflict do nothing;

-- ---------- grupos de adicionais ----------
-- Obrigatório: min_select >= 1. Opcional: min_select = 0 com max_select > 1.
insert into public.option_groups (id, business_id, product_id, name, min_select, max_select, sort_order)
select pg_temp.demo_id('og:' || v.k || ':' || v.pk || ':' || v.gk), pg_temp.demo_id('biz:' || v.k),
       pg_temp.demo_id('pr:' || v.k || ':' || v.pk), v.name, v.mn, v.mx, v.ord
from (values
  -- k, pk, gk, name, min, max, ord
  ('pizzaria',     'mussarela', 'tamanho',  'Tamanho (obrigatório)',   1, 1, 1),
  ('pizzaria',     'mussarela', 'extras',   'Adicionais (opcional)',   0, 3, 2),
  ('marmitaria',   'media',     'proteina', 'Proteína (obrigatório)',  1, 1, 1),
  ('marmitaria',   'media',     'extras',   'Adicionais (opcional)',   0, 2, 2),
  ('acai',         'acai',      'tamanho',  'Tamanho (obrigatório)',   1, 1, 1),
  ('acai',         'acai',      'acomp',    'Acompanhamentos',         0, 3, 2),
  ('hamburgueria', 'classico',  'ponto',    'Ponto da carne (obrigatório)', 1, 1, 1),
  ('hamburgueria', 'classico',  'extras',   'Adicionais (opcional)',   0, 3, 2),
  ('sorveteria',   'taca',      'calda',    'Calda (obrigatório)',     1, 1, 1)
) as v(k, pk, gk, name, mn, mx, ord)
on conflict do nothing;

-- ---------- opções ----------
insert into public.options (id, business_id, group_id, name, price_delta_cents, is_available, sort_order)
select pg_temp.demo_id('op:' || v.k || ':' || v.pk || ':' || v.gk || ':' || v.ord), pg_temp.demo_id('biz:' || v.k),
       pg_temp.demo_id('og:' || v.k || ':' || v.pk || ':' || v.gk), v.name, v.delta, true, v.ord
from (values
  -- k, pk, gk, name, delta, ord
  ('pizzaria',     'mussarela', 'tamanho',  'Média',            0,    1),
  ('pizzaria',     'mussarela', 'tamanho',  'Grande',           1200, 2),
  ('pizzaria',     'mussarela', 'extras',   'Bacon',            500,  1),
  ('pizzaria',     'mussarela', 'extras',   'Cebola',           300,  2),
  ('pizzaria',     'mussarela', 'extras',   'Azeitona',         300,  3),
  ('marmitaria',   'media',     'proteina', 'Frango grelhado',  0,    1),
  ('marmitaria',   'media',     'proteina', 'Bife acebolado',   300,  2),
  ('marmitaria',   'media',     'proteina', 'Linguiça',         0,    3),
  ('marmitaria',   'media',     'extras',   'Ovo frito',        200,  1),
  ('marmitaria',   'media',     'extras',   'Farofa extra',     150,  2),
  ('acai',         'acai',      'tamanho',  '300 ml',           0,    1),
  ('acai',         'acai',      'tamanho',  '500 ml',           600,  2),
  ('acai',         'acai',      'acomp',    'Granola',          0,    1),
  ('acai',         'acai',      'acomp',    'Leite em pó',      200,  2),
  ('acai',         'acai',      'acomp',    'Banana',           100,  3),
  ('acai',         'acai',      'acomp',    'Morango',          200,  4),
  ('hamburgueria', 'classico',  'ponto',    'Ao ponto',         0,    1),
  ('hamburgueria', 'classico',  'ponto',    'Bem passado',      0,    2),
  ('hamburgueria', 'classico',  'extras',   'Queijo extra',     300,  1),
  ('hamburgueria', 'classico',  'extras',   'Bacon',            400,  2),
  ('hamburgueria', 'classico',  'extras',   'Ovo',              200,  3),
  ('sorveteria',   'taca',      'calda',    'Chocolate',        0,    1),
  ('sorveteria',   'taca',      'calda',    'Morango',          0,    2)
) as v(k, pk, gk, name, delta, ord)
on conflict do nothing;

-- ---------- serviços (um por prestador) ----------
insert into public.services (id, business_id, name, category_id, city_id, description, status, is_demo)
select pg_temp.demo_id('sv:' || v.k), pg_temp.demo_id('biz:' || v.k), v.name,
       pg_temp.demo_id('cat:' || v.cat), pg_temp.demo_id('city:itau-de-minas'), v.descr, 'published', true
from (values
  ('beleza',      'Corte e escova (demo)',      'beleza',   'Serviço fictício de demonstração.'),
  ('eletricista', 'Reparos elétricos (demo)',   'servicos', 'Serviço fictício de demonstração.'),
  ('diarista',    'Limpeza residencial (demo)', 'servicos', 'Serviço fictício de demonstração.')
) as v(k, name, cat, descr)
on conflict do nothing;

-- ---------- avaliações (nomes genéricos; user_id nulo; o gatilho recalcula rating_avg/count) ----------
insert into public.reviews (id, business_id, rating, comment, author_name, is_demo)
select pg_temp.demo_id('rv:' || v.k || ':' || v.n), pg_temp.demo_id('biz:' || v.k),
       v.rating, v.comment, v.author, true
from (values
  ('lanchonete',   1, 5, 'Avaliação fictícia de demonstração.', 'Cliente Demo A'),
  ('lanchonete',   2, 4, 'Avaliação fictícia de demonstração.', 'Cliente Demo B'),
  ('lanchonete',   3, 5, null,                                   'Cliente Demo C'),
  ('pizzaria',     1, 5, 'Avaliação fictícia de demonstração.', 'Cliente Demo D'),
  ('pizzaria',     2, 4, 'Avaliação fictícia de demonstração.', 'Cliente Demo E'),
  ('marmitaria',   1, 4, 'Avaliação fictícia de demonstração.', 'Cliente Demo F'),
  ('marmitaria',   2, 3, null,                                   'Cliente Demo G'),
  ('acai',         1, 5, 'Avaliação fictícia de demonstração.', 'Cliente Demo H'),
  ('hamburgueria', 1, 4, 'Avaliação fictícia de demonstração.', 'Cliente Demo I'),
  ('hamburgueria', 2, 5, 'Avaliação fictícia de demonstração.', 'Cliente Demo J'),
  ('farmacia',     1, 4, 'Avaliação fictícia de demonstração.', 'Cliente Demo K'),
  ('roupas',       1, 3, 'Avaliação fictícia de demonstração.', 'Cliente Demo L'),
  ('beleza',       1, 5, 'Avaliação fictícia de demonstração.', 'Cliente Demo M')
) as v(k, n, rating, comment, author)
on conflict do nothing;

commit;
