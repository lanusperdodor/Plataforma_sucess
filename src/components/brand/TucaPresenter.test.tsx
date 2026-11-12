import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STATIC_PRESENTER, TucaPresenter } from './TucaPresenter.tsx'

afterEach(cleanup)

describe('TucaPresenter', () => {
  it('mostra um único Tuca de corpo inteiro com o balão de apresentação', () => {
    render(<TucaPresenter media={STATIC_PRESENTER} />)
    expect(screen.getAllByTestId('tuca-presenter')).toHaveLength(1)
    const img = screen.getByRole('img', { name: /Tuca, o tucano mascote do Tucaí/ })
    expect(img).toHaveAttribute('src', '/brand/tuca-apresentador-600.png')
    expect(img).toHaveAttribute('width', '600')
    expect(img).toHaveAttribute('height', '637')
    expect(img.className).toContain('object-contain')
    expect(img).not.toHaveAttribute('loading', 'lazy')
    expect(screen.getByText('Oi! Eu sou o Tuca.')).toBeInTheDocument()
    expect(screen.getByText(/Bem-vindo ao/)).toHaveTextContent('Bem-vindo ao Tucaí!')
  })

  it('aceita GIF sem duplicar o balão e usa imagem estática com movimento reduzido', () => {
    const { container } = render(
      <TucaPresenter media={{ kind: 'gif', src: '/brand/tuca.gif', staticSrc: '/brand/tuca-apresentador-600.png' }} />,
    )
    expect(screen.getAllByText('Oi! Eu sou o Tuca.')).toHaveLength(1)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/tuca.gif')
    const source = container.querySelector('source')
    expect(source).toHaveAttribute('media', '(prefers-reduced-motion: reduce)')
    expect(source).toHaveAttribute('srcset', '/brand/tuca-apresentador-600.png')
  })

  it('vídeo: mudo, em loop, inline, com pôster, pausa acessível e sem balão duplicado', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { container } = render(
      <TucaPresenter media={{ kind: 'video', src: '/brand/tuca.mp4', poster: '/brand/tuca-apresentador-600.png', hasBakedBubble: true }} />,
    )
    const video = container.querySelector('video')!
    expect(video.muted).toBe(true)
    expect(video).toHaveAttribute('loop')
    expect(video).toHaveAttribute('playsinline')
    // o vídeo só recebe a fonte depois do carregamento da página (não disputa a rede com o app)
    expect(video).not.toHaveAttribute('src')
    await waitFor(() => expect(video).toHaveAttribute('src', '/brand/tuca.mp4'))
    await waitFor(() => expect(play).toHaveBeenCalled())
    // balão embutido no vídeo: o texto fica só para leitores de tela, sem balão visual
    expect(container.querySelector('.tuca-bubble')).toBeNull()
    expect(screen.getByText(/Oi! Eu sou o Tuca\. Bem-vindo ao Tucaí!/)).toHaveClass('sr-only')
    Object.defineProperty(video, 'paused', { value: false, configurable: true })
    fireEvent.play(video)
    fireEvent.click(screen.getByRole('button', { name: 'Pausar animação do Tuca' }))
    expect(pause).toHaveBeenCalled()
    play.mockRestore()
    pause.mockRestore()
  })

  it('padrão: animação já recortada (sem recorte no navegador), quadro parado primeiro e sem botão de pausa', async () => {
    const OrigImage = window.Image
    class FakeImage { onload: (() => void) | null = null; set src(_v: string) { globalThis.setTimeout(() => this.onload?.(), 0) } }
    window.Image = FakeImage as unknown as typeof Image
    const { container } = render(<TucaPresenter />)
    const img = screen.getByRole('img', { name: /Tuca, o tucano mascote/ })
    expect(img).toHaveAttribute('data-testid', 'tuca-animation')
    expect(img).toHaveAttribute('src', '/brand/tuca-animado-quadro.webp')
    expect(container.querySelector('canvas, video')).toBeNull()
    expect(container.querySelector('.tuca-bubble')).toBeNull()
    await waitFor(() => expect(img).toHaveAttribute('src', '/brand/tuca-animado.webp'))
    expect(screen.queryByRole('button', { name: /animação do Tuca/ })).toBeNull()
    window.Image = OrigImage
  })

  it('com movimento reduzido mostra o PNG estático com o balão (sem vídeo)', () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    const { container } = render(<TucaPresenter />)
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/tuca-apresentador-600.png')
    expect(screen.getByText('Oi! Eu sou o Tuca.')).toBeInTheDocument()
    window.matchMedia = original
  })

  it('a flutuação é desligada com movimento reduzido', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.tuca-float,\s*\.tuca-bubble\s*{\s*animation: none/)
  })
})