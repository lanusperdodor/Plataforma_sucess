import { act, cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetScrollReadyForTests, useScrollReady, useScrollRestoration } from './useScrollRestoration.ts'

let nav: NavigateFunction
let scrollY = 0
let docHeight = 5000
const scrollTo = vi.fn()

function Harness({ ready = true }: { ready?: boolean }) {
  useScrollRestoration()
  useScrollReady(ready)
  nav = useNavigate()
  return null
}

function scrollBy(y: number) {
  scrollY = y
  window.dispatchEvent(new Event('scroll'))
}

beforeEach(() => {
  scrollY = 0
  docHeight = 5000
  scrollTo.mockReset()
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => docHeight,
  })
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetScrollReadyForTests()
})

function mount(ready = true) {
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <Harness ready={ready} />
    </MemoryRouter>,
  )
}

describe('useScrollRestoration', () => {
  it('define scrollRestoration como manual', () => {
    mount()
    expect(window.history.scrollRestoration).toBe('manual')
  })

  it('rola ao topo em PUSH e salva a posição ao sair', () => {
    mount()
    scrollBy(500)
    act(() => nav('/b'))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    expect(sessionStorage.getItem('scroll:default')).toBe('500')
  })

  it('restaura a posição em POP', async () => {
    mount()
    scrollBy(500)
    act(() => nav('/b'))
    scrollBy(0)
    scrollTo.mockClear()
    act(() => nav(-1))
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 500))
  })

  it('aguarda o sinal ready antes de restaurar', async () => {
    const view = mount(false)
    scrollBy(500)
    act(() => nav('/b'))
    scrollTo.mockClear()
    act(() => nav(-1))
    await new Promise((r) => setTimeout(r, 80))
    expect(scrollTo).not.toHaveBeenCalledWith(0, 500)
    view.rerender(
      <MemoryRouter initialEntries={['/a']}>
        <Harness ready />
      </MemoryRouter>,
    )
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 500))
  })
})
