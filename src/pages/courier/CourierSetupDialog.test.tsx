import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourierSetupDialog } from './CourierSetupDialog.tsx'
import { COURIER_PREFS_KEY, readCourierPrefs } from '../../features/courier/setupPrefs.ts'

afterEach(() => { cleanup(); localStorage.removeItem(COURIER_PREFS_KEY) })
const show = (mode: 'online' | 'ajustes', onAccept = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <CourierSetupDialog open mode={mode} onClose={vi.fn()} onAccept={onAccept} />
  </MemoryRouter></QueryClientProvider>)
  return onAccept
}

describe('pop-up do entregador', () => {
  it('marca e desmarca opções; só aceita com os termos; aceita tudo de uma vez e lembra as escolhas', async () => {
    const onAccept = show('online')
    fireEvent.click(screen.getByRole('checkbox', { name: /Manter a tela ligada/ }))
    const ok = screen.getByRole('button', { name: 'Aceitar e ficar online' })
    expect(ok).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Aceito os termos de parceria' }))
    fireEvent.click(ok)
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledWith({ prefs: { sound: true, gps: true, awake: false, push: true }, position: null }))
    expect(readCourierPrefs()).toEqual({ sound: true, gps: true, awake: false, push: true })
  })
  it('ajustes: sem termos, botão Salvar', async () => {
    const onAccept = show('ajustes')
    expect(screen.queryByRole('checkbox', { name: 'Aceito os termos de parceria' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalled())
  })
})
