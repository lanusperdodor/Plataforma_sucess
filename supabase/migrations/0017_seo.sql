-- 0017_seo: dados públicos, só leitura, para títulos por página e sitemap.xml.
--  * Só estabelecimentos ativos e reais: fora demonstração (is_demo) e dados de teste do Painel Master.
--  * Cidades só aparecem com operação real (ao menos 1 estabelecimento indexável ou vaga aberta).
--  * Nada privado: sem contatos, sem dados de pessoas, sem pedidos.
--  * lastmod = data real de atualização do registro.

create or replace function private.test_business_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select unnest(business_ids) from private.test_data_runs where removed_at is null
$$;
revoke all on function private.test_business_ids() from public, anon, authenticated;

-- estabelecimentos indexáveis (base de tudo)
create or replace function private.indexable_businesses()
returns table (id uuid, slug text, business_type public.business_type, name text, description text, city_id uuid, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id, b.slug, b.business_type, b.name, b.description, b.city_id, b.updated_at
    from public.businesses b
   where b.status = 'active' and not b.is_demo
     and b.id not in (select private.test_business_ids())
$$;
revoke all on function private.indexable_businesses() from public, anon, authenticated;

create or replace function public.seo_business(_slug text)
returns table (name text, business_type public.business_type, description text, city_name text, city_state text, city_slug text,
               updated_at timestamptz, indexable boolean, address_line text, phone text, logo_url text, cover_url text)
language sql stable security definer set search_path = '' as $$
  select b.name, b.business_type, b.description, c.name, c.state, c.slug, b.updated_at,
         b.id not in (select private.test_business_ids()), b.address_line, b.phone, b.logo_url, b.cover_url
    from public.businesses b left join public.cities c on c.id = b.city_id and c.is_active
   where b.slug = _slug and b.status = 'active' and not b.is_demo
$$;

create or replace function public.seo_city(_slug text)
returns table (name text, state text, slug text, restaurantes integer, lojas integer, servicos integer, vagas integer)
language sql stable security definer set search_path = '' as $$
  select c.name, c.state, c.slug,
         (select count(*)::int from private.indexable_businesses() b where b.city_id = c.id and b.business_type = 'restaurante'),
         (select count(*)::int from private.indexable_businesses() b where b.city_id = c.id and b.business_type = 'loja'),
         (select count(*)::int from private.indexable_businesses() b where b.city_id = c.id and b.business_type = 'servico'),
         (select count(*)::int from public.jobs j join private.indexable_businesses() b on b.id = j.business_id
           where j.city_id = c.id and j.status = 'open' and j.expires_at > now())
    from public.cities c
   where c.slug = _slug and c.is_active
$$;

create or replace function public.seo_job(_id uuid)
returns table (title text, business_name text, city_name text, city_state text, indexable boolean,
               description text, employment_type public.job_employment, work_mode public.job_work_mode,
               salary_min_cents integer, salary_max_cents integer, created_at timestamptz, expires_at timestamptz,
               business_slug text, business_type public.business_type, address_line text)
language sql stable security definer set search_path = '' as $$
  select j.title, b.name, c.name, c.state, true, j.description, j.employment_type, j.work_mode,
         j.salary_min_cents, j.salary_max_cents, j.created_at, j.expires_at, b.slug, b.business_type, bb.address_line
    from public.jobs j
    join private.indexable_businesses() b on b.id = j.business_id
    join public.businesses bb on bb.id = b.id
    left join public.cities c on c.id = j.city_id
   where j.id = _id and j.status = 'open' and j.expires_at > now()
$$;

-- todas as URLs indexáveis com conteúdo real
create or replace function public.sitemap_entries()
returns table (path text, lastmod timestamptz)
language sql stable security definer set search_path = '' as $$
  with b as (select * from private.indexable_businesses()),
       j as (select j.id, j.city_id, coalesce(j.updated_at, j.created_at) as updated_at
               from public.jobs j join b on b.id = j.business_id
              where j.status = 'open' and j.expires_at > now()),
       sec as (select case b.business_type when 'restaurante' then 'restaurantes' when 'loja' then 'lojas' else 'servicos' end as section,
                      b.slug, b.city_id, b.updated_at from b),
       cities as (select c.id, c.slug from public.cities c where c.is_active
                   and (exists (select 1 from b where b.city_id = c.id) or exists (select 1 from j where j.city_id = c.id)))
  select '/' || s.section || '/' || s.slug, s.updated_at from sec s
  union all
  select '/' || s.section, max(s.updated_at) from sec s group by s.section
  union all
  select '/vagas/' || j.id, j.updated_at from j
  union all
  select '/vagas', max(j.updated_at) from j having count(*) > 0
  union all
  select '/cidades/' || c.slug,
         greatest((select max(updated_at) from b where b.city_id = c.id), (select max(updated_at) from j where j.city_id = c.id))
    from cities c
  union all
  select '/cidades/' || c.slug || '/' || s.section, max(s.updated_at) from cities c join sec s on s.city_id = c.id group by c.slug, s.section
  union all
  select '/cidades/' || c.slug || '/vagas', max(j.updated_at) from cities c join j on j.city_id = c.id group by c.slug
$$;

do $$
declare f text;
begin
  foreach f in array array['public.seo_business(text)', 'public.seo_city(text)', 'public.seo_job(uuid)', 'public.sitemap_entries()'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
