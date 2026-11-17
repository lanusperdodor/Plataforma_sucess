import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDownloadButton, AppDownloadStrip } from './AppDownload.tsx'

afterEach(cleanup)
const at = (path: string, el: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>)

describe('Baixar app no topo', () => {
  it('celular: faixa no topo leva para /app', () => {
    at('/', <AppDownloadStrip />)
    expect(screen.getByText('Baixe o app da Tucaí')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Baixar' })).toHaveAttribute('href', '/app')
  })
  it('computador: botão Baixar app leva para /app', () => {
    at('/restaurantes', <AppDownloadButton />)
    expect(screen.getByRole('link', { name: 'Baixar app' })).toHaveAttribute('href', '/app')
  })
  it('some na própria página /app', () => {
    at('/app', <><AppDownloadStrip /><AppDownloadButton /></>)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
