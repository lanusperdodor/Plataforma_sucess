import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PostMediaView } from './PostMediaView.tsx'

afterEach(cleanup)
const img = (i: number) => ({ id: `m${i}`, kind: 'image' as const, url: `https://x.supabase.co/storage/v1/object/public/post-images/u/${i}.webp`, width: 800, height: 600, durationS: null })

describe('mídia na publicação', () => {
  it('mostra as fotos com texto alternativo e carregamento preguiçoso', () => {
    render(<PostMediaView media={[img(1), img(2), img(3)]} />)
    const imgs = screen.getAllByRole('img')
    expect(imgs).toHaveLength(3)
    expect(imgs[0]).toHaveAttribute('alt', 'Foto 1 de 3')
    expect(imgs[0]).toHaveAttribute('loading', 'lazy')
  })
  it('mostra o vídeo com controles e sem baixar tudo de início', () => {
    const { container } = render(<PostMediaView media={[{ id: 'v', kind: 'video', url: 'https://x.supabase.co/v.mp4', width: null, height: null, durationS: 42 }]} />)
    const v = container.querySelector('video')!
    expect(v).toHaveAttribute('controls')
    expect(v).toHaveAttribute('preload', 'metadata')
    expect(v).toHaveAttribute('aria-label', 'Vídeo da publicação, 42 segundos')
  })
  it('sem mídia não renderiza nada', () => {
    const { container } = render(<PostMediaView media={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
