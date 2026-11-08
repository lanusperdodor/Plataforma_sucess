import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorState } from './ErrorState'
import { Img } from './Img'
import { SkeletonCard } from './Skeleton'

afterEach(cleanup)

describe('ErrorState', () => {
  it('chama onRetry ao clicar em "Tentar novamente"', () => {
    const retry = vi.fn()
    render(<ErrorState onRetry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('Img', () => {
  it('é lazy por padrão e async', () => {
    render(<Img src="/a.jpg" alt="Loja" width={400} height={300} />)
    const img = screen.getByAltText('Loja')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(img).toHaveAttribute('width', '400')
  })

  it('é eager com priority', () => {
    render(<Img src="/a.jpg" alt="Capa" width={400} height={300} priority />)
    expect(screen.getByAltText('Capa')).toHaveAttribute('loading', 'eager')
  })

  it('mostra fallback neutro em erro', () => {
    render(<Img src="/x.jpg" alt="Falha" width={10} height={10} />)
    fireEvent.error(screen.getByAltText('Falha'))
    expect(screen.getByTestId('img-fallback')).toBeInTheDocument()
  })
})

describe('Skeleton', () => {
  it('fica oculto para tecnologias assistivas', () => {
    const { container } = render(<SkeletonCard />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })
})
