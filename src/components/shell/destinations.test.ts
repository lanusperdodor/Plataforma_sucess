import { describe, expect, it } from 'vitest'
import { NAV_DESTINATIONS, SECONDARY_DESTINATIONS, audienceOf, destinationsFor, resolveActiveDestination, visibleGroups } from './destinations.ts'

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
    ['/conectuai', 'conectuai'],
    ['/conectuai/post/1', 'conectuai'],
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
  it('tem 5 destinos primários e os atalhos de descoberta', () => {
    expect(NAV_DESTINATIONS.map((d) => d.id)).toEqual(['inicio', 'explorar', 'conectuai', 'pedidos', 'perfil'])
    expect(SECONDARY_DESTINATIONS.map((d) => d.label)).toEqual(['Restaurantes', 'Lojas', 'Serviços', 'Vagas'])
  })
})

describe('visibilidade por perfil', () => {
  const labels = (a: Parameters<typeof visibleGroups>[0]) => visibleGroups(a).flatMap((g) => g.items.map((i) => i.label))
  it('visitante não vê áreas pessoais nem de trabalho', () => {
    const l = labels(audienceOf(false, null))
    expect(l).toEqual(['Restaurantes', 'Lojas', 'Serviços', 'Vagas', 'Seja entregador', 'Cadastrar negócio'])
  })
  it('cliente vê a própria conta', () => {
    const l = labels(audienceOf(true, { userId: 'u', roles: ['customer'], memberships: [] }))
    expect(l).toContain('Notificações')
    expect(l).not.toContain('Painel Master')
    expect(l).not.toContain('Meu estabelecimento')
  })
  it('comerciante, entregador e equipe veem só a própria área', () => {
    const merchant = labels(audienceOf(true, { userId: 'u', roles: ['customer'], memberships: [{ businessId: 'b', role: 'owner' }] }))
    expect(merchant).toContain('Meu estabelecimento')
    expect(merchant).not.toContain('Cadastrar negócio')
    const courier = labels(audienceOf(true, { userId: 'u', roles: ['customer', 'courier_partner'], memberships: [] }))
    expect(courier).toContain('Área do entregador')
    expect(courier).not.toContain('Seja entregador')
    const admin = labels(audienceOf(true, { userId: 'u', roles: ['customer', 'platform_operator'], memberships: [] }))
    expect(admin).toContain('Painel Master')
  })
})

describe('navegação por perfil ativo', () => {
  const a = { signedIn: true, merchant: true, courier: true, admin: true }
  it('cliente vê compras; loja vê pedidos recebidos; entregador só operação; Master sem "Pedidos" de compra', () => {
    expect(destinationsFor({ kind: 'cliente' }).map((d) => d.id)).toContain('pedidos')
    expect(destinationsFor({ kind: 'loja', businessId: 'b1' }).map((d) => d.to)).toEqual(['/', '/painel/b1/pedidos', '/painel/b1', '/perfil'])
    expect(destinationsFor({ kind: 'entregador' }).map((d) => d.id)).toEqual(['entregas', 'notificacoes', 'perfil'])
    expect(destinationsFor({ kind: 'master' }).map((d) => d.id)).not.toContain('pedidos')
    expect(visibleGroups(a, { kind: 'entregador' }).map((g) => g.id)).toEqual(['conta', 'trabalho'])
  })
})
