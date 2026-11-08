import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from './Toast.tsx'
import { useToast } from './toast-context.ts'

function Trigger() {
  const t = useToast()
  return (
    <>
      <button onClick={() => t.success('Salvo')}>ok</button>
      <button onClick={() => t.error('Falhou')}>err</button>
      <button onClick={() => t.info('Aviso')}>info</button>
    </>
  )
}

const setup = () =>
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  )
const click = (name: string) => fireEvent.click(screen.getByText(name))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Toast', () => {
  it('usa role=status para sucesso/info e role=alert para erro', () => {
    setup()
    click('ok')
    click('err')
    expect(screen.getByRole('status')).toHaveTextContent('Salvo')
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou')
  })

  it('mantém no máximo 3 toasts, descartando o mais antigo', () => {
    setup()
    click('ok')
    click('info')
    click('err')
    click('ok')
    expect(screen.getAllByRole('button', { name: 'Fechar notificação' })).toHaveLength(3)
    expect(screen.getAllByText('Salvo')).toHaveLength(1)
  })

  it('fecha sozinho após 5 s (sucesso) e 8 s (erro)', () => {
    setup()
    click('ok')
    click('err')
    act(() => void vi.advanceTimersByTime(5000))
    expect(screen.queryByText('Salvo')).toBeNull()
    expect(screen.getByText('Falhou')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(3000))
    expect(screen.queryByText('Falhou')).toBeNull()
  })

  it('pausa em hover e retoma o tempo restante', () => {
    setup()
    click('ok')
    const toast = screen.getByRole('status')
    act(() => void vi.advanceTimersByTime(3000))
    fireEvent.mouseEnter(toast)
    act(() => void vi.advanceTimersByTime(10000))
    expect(screen.getByText('Salvo')).toBeInTheDocument()
    fireEvent.mouseLeave(toast)
    act(() => void vi.advanceTimersByTime(1900))
    expect(screen.getByText('Salvo')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(200))
    expect(screen.queryByText('Salvo')).toBeNull()
  })

  it('pausa em foco e o botão fechar remove o toast', () => {
    setup()
    click('err')
    const close = screen.getByRole('button', { name: 'Fechar notificação' })
    fireEvent.focus(close)
    act(() => void vi.advanceTimersByTime(20000))
    expect(screen.getByText('Falhou')).toBeInTheDocument()
    fireEvent.click(close)
    expect(screen.queryByText('Falhou')).toBeNull()
  })
})
