import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Category } from '../../features/catalog/schemas'
import { CategoryRail } from './CategoryRail'
import { Section } from './Section'

afterEach(cleanup)

const cat = (slug: string, label: string, icon: string | null): Category => ({
  id: slug,
  slug,
  label,
  kind: 'restaurante',
  icon,
  sortOrder: 1,
  isDemo: false,
})

describe('Section', () => {
  it('mostra título, subtítulo e "Ver mais"', () => {
    render(
      <MemoryRouter>
        <Section title="Em destaque" subtitle="Perto de você" moreTo="/restaurantes">
          <p>conteúdo</p>
        </Section>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Em destaque' })).toBeInTheDocument()
    expect(screen.getByText('Perto de você')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver mais/ })).toHaveAttribute('href', '/restaurantes')
  })

  it('mostra estado vazio ou oculta com hideWhenEmpty', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <Section title="Novidades" empty emptyTitle="Sem novidades" />
      </MemoryRouter>,
    )
    expect(screen.getByText('Sem novidades')).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <Section title="Novidades" empty hideWhenEmpty />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CategoryRail', () => {
  it('renderiza links com destino e aria-current na ativa, com ícone desconhecido tolerado', () => {
    render(
      <MemoryRouter>
        <CategoryRail
          categories={[cat('lanches', 'Lanches', 'Sandwich'), cat('outros', 'Outros', 'IconeInexistente')]}
          hrefFor={(c) => `/restaurantes?cat=${c.slug}`}
          activeSlug="lanches"
        />
      </MemoryRouter>,
    )
    const active = screen.getByRole('link', { name: 'Lanches' })
    expect(active).toHaveAttribute('href', '/restaurantes?cat=lanches')
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Outros' })).not.toHaveAttribute('aria-current')
  })
})
