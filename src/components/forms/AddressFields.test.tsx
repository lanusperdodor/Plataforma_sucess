import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyAddress, formatAddress, maskCep, validateAddress, type AddressParts } from '../../features/address/address.ts'
import { AddressFields } from './AddressFields.tsx'

afterEach(cleanup)
function Host({ lookup }: { lookup: Parameters<typeof AddressFields>[0]['lookup'] }) {
  const [v, setV] = useState<AddressParts>(emptyAddress())
  return <><AddressFields idPrefix="t" value={v} onChange={setV} lookup={lookup} /><output data-testid="txt">{formatAddress(v)}</output></>
}

describe('endereço em campos separados', () => {
  it('digitar o CEP preenche cidade, UF, rua e bairro', async () => {
    const lookup = vi.fn().mockResolvedValue({ cep: '37975000', street: 'Rua das Flores', district: 'Centro', city: 'Itaú de Minas', uf: 'MG' })
    render(<Host lookup={lookup} />)
    fireEvent.change(screen.getByLabelText('CEP'), { target: { value: '37975000' } })
    expect(screen.getByLabelText('CEP')).toHaveValue('37975-000')
    expect(await screen.findByDisplayValue('Itaú de Minas')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('UF')).toHaveValue('MG')
    expect(screen.getByLabelText('Rua')).toHaveValue('Rua das Flores')
    expect(screen.getByLabelText('Bairro')).toHaveValue('Centro')
    expect(lookup).toHaveBeenCalledWith('37975000')
    fireEvent.change(screen.getByLabelText('Número'), { target: { value: '12' } })
    expect(screen.getByTestId('txt')).toHaveTextContent('Rua das Flores, 12 - Centro - Itaú de Minas/MG, CEP 37975-000')
  })
  it('CEP geral da cidade: só cidade/UF, pede rua e bairro', async () => {
    render(<Host lookup={vi.fn().mockResolvedValue({ cep: '37975000', street: '', district: '', city: 'Itaú de Minas', uf: 'MG' })} />)
    fireEvent.change(screen.getByLabelText('CEP'), { target: { value: '37975-000' } })
    expect(await screen.findByText(/CEP geral da cidade/)).toBeInTheDocument()
    expect(screen.getByLabelText('Rua')).toHaveValue('')
  })
  it('CEP não encontrado deixa digitar a cidade', async () => {
    render(<Host lookup={vi.fn().mockResolvedValue(null)} />)
    fireEvent.change(screen.getByLabelText('CEP'), { target: { value: '00000000' } })
    expect(await screen.findByText(/CEP não encontrado/)).toBeInTheDocument()
    expect(screen.getByLabelText('Cidade')).not.toHaveAttribute('readonly')
  })
  it('"Sem número" e validação', () => {
    render(<Host lookup={vi.fn().mockResolvedValue(null)} />)
    fireEvent.click(screen.getByLabelText('Sem número'))
    expect(screen.getByLabelText('Número')).toBeDisabled()
    expect(maskCep('3797')).toBe('3797')
    const e = validateAddress({ ...emptyAddress(), cep: '123', uf: 'XX' })
    expect(Object.keys(e).sort()).toEqual(['cep', 'city', 'district', 'number', 'street', 'uf'])
    expect(validateAddress({ cep: '37975000', street: 'Rua A', number: 'S/N', complement: '', district: 'Centro', city: 'Itaú', uf: 'mg' })).toEqual({})
  })
})
