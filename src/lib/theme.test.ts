import { afterEach, describe, expect, it } from 'vitest'
import { getThemePreference, resolveTheme, setThemePreference } from './theme.ts'

afterEach(() => setThemePreference('system'))

describe('tema claro/escuro', () => {
  it('guarda a escolha e aplica no documento', () => {
    setThemePreference('dark')
    expect(getThemePreference()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    setThemePreference('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    setThemePreference('system')
    expect(getThemePreference()).toBe('system')
    expect(['light', 'dark']).toContain(resolveTheme())
  })
})
