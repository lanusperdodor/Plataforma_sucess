import { describe, expect, it } from 'vitest'
import { customerHeadline } from './OrderPage.tsx'

describe('status mostrado ao cliente', () => {
  it('segue o fluxo real do pedido', () => {
    expect(customerHeadline('placed', 'delivery_partner', 'offered')).toBe('Aguardando confirmação do estabelecimento')
    expect(customerHeadline('preparing', 'delivery_partner', 'accepted')).toBe('Pedido aceito! Em preparo.')
    expect(customerHeadline('ready', 'delivery_partner', 'offered')).toBe('Seu pedido está pronto. Aguardando coleta.')
    expect(customerHeadline('ready', 'delivery_partner', 'accepted')).toBe('Entregador encontrado.')
    expect(customerHeadline('out_for_delivery', 'delivery_partner', 'picked_up')).toBe('Seu pedido está a caminho.')
    expect(customerHeadline('delivered', 'delivery_partner', 'delivered')).toBe('Pedido entregue.')
  })
})
