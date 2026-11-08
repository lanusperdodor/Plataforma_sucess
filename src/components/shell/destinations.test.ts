import { describe, expect, it } from 'vitest'
import { NAV_DESTINATIONS, SECONDARY_DESTINATIONS, resolveActiveDestination } from './destinations.ts'

describe('resolveActiveDestination', () => {
  it.each([
    ['/', 'inicio'],
    ['/explorar', 'explorar'],
    ['/restaurantes', 'explorar'],
    ['/restaurantes/abc-123', 'explorar'],
    ['/lojas', 'explorar'],
    ['/lojas/x/produto', 'explorar'],
    ['/servicos', 'explorar'],
    ['/vagas/42', 'explorar'],
    ['/busca', 'explorar'],
    ['/comunidade', 'comunidade'],
    ['/comunidade/post/1', 'comunidade'],
    ['/pedidos', 'pedidos'],
    ['/pedidos/9', 'pedidos'],
    ['/perfil', 'perfil'],
    ['/perfil/enderecos', 'perfil'],
    ['/conta', 'perfil'],
    ['/notificacoes', 'perfil'],
    ['/pedidos/', 'pedidos'],
  ])('%s -> %s', (path, id) => {
    expect(resolveActiveDestination(path)).toBe(id)
  })

  it('não casa prefixos parciais nem rotas desconhecidas', () => {
    expect(resolveActiveDestination('/lojasx')).toBeNull()
    expect(resolveActiveDestination('/qualquer')).toBeNull()
  })
})

describe('destinos', () => {
  it('tem 5 destinos primários e 5 secundários', () => {
    expect(NAV_DESTINATIONS.map((d) => d.id)).toEqual(['inicio', 'explorar', 'comunidade', 'pedidos', 'perfil'])
    expect(SECONDARY_DESTINATIONS.map((d) => d.label)).toEqual([
      'Restaurantes',
      'Lojas',
      'Serviços',
      'Vagas',
      'Notificações',
    ])
  })
})
