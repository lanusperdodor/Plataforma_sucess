import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog.tsx'
import { Sheet } from './Sheet.tsx'

/** **Validates: Requirements 6.7, 18.1** */
function Harness({ side, closeOnBackdrop }: { side?: 'bottom' | 'right'; closeOnBackdrop?: boolean }) {
  const [open, setOpen] = useState(false)
  const Cmp = side ? Sheet : Dialog
  return (
    <>
      <button onClick={() => setOpen(true)}>abrir</button>
      <Cmp
        open={open}
        onClose={() => setOpen(false)}
        title="Meu título"
        closeOnBackdrop={closeOnBackdrop}
        {...(side ? { side } : {})}
      >
        <button>primeiro</button>
        <button>segundo</button>
      </Cmp>
    </>
  )
}

beforeEach(() => {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
})
afterEach(() => {
  document.getElementById('root')?.remove()
  document.body.style.overflow = ''
})

function mount(props = {}) {
  const root = document.getElementById('root')!
  const utils = render(<Harness {...props} />, { container: root.appendChild(document.createElement('div')) })
  const opener = screen.getByText('abrir')
  opener.focus()
  fireEvent.click(opener)
  return { ...utils, opener }
}

describe('Dialog/Sheet', () => {
  it('expõe role, aria-modal e título associado, via portal no body', () => {
    mount()
    const dlg = screen.getByRole('dialog', { name: 'Meu título' })
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.parentElement?.closest('#root')).toBeNull()
  })

  it('foca o primeiro elemento focável, aplica inert e trava a rolagem', () => {
    mount()
    expect(document.activeElement).toBe(screen.getByText('primeiro'))
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('cicla o foco com Tab e Shift+Tab', () => {
    mount()
    const [a, b] = [screen.getByText('primeiro'), screen.getByText('segundo')]
    b.focus()
    fireEvent.keyDown(b, { key: 'Tab' })
    expect(document.activeElement).toBe(a)
    fireEvent.keyDown(a, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(b)
  })

  it('Esc fecha, devolve o foco ao disparador e restaura inert/rolagem', () => {
    const { opener } = mount()
    fireEvent.keyDown(screen.getByText('primeiro'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('clique no backdrop fecha; desativável por prop', () => {
    mount()
    fireEvent.click(screen.getByTestId('overlay-backdrop'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('não fecha pelo backdrop quando closeOnBackdrop=false', () => {
    mount({ closeOnBackdrop: false })
    fireEvent.click(screen.getByTestId('overlay-backdrop'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('Sheet renderiza nas variantes bottom e right', () => {
    const { unmount } = mount({ side: 'bottom' })
    expect(screen.getByRole('dialog').className).toContain('overlay-panel-bottom')
    unmount()
    mount({ side: 'right' })
    expect(screen.getByRole('dialog').className).toContain('overlay-panel-right')
  })

  it('chama onClose uma vez por Esc', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="x">
        <button>ok</button>
      </Dialog>,
    )
    fireEvent.keyDown(screen.getByText('ok'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
