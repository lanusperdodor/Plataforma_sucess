import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { CityCombobox } from './CityCombobox.tsx'

const cities = [
  { id: '1', name: 'Itaú de Minas', state: 'MG' }, { id: '2', name: 'Passos', state: 'MG' },
  { id: '3', name: 'São Sebastião do Paraíso', state: 'MG' }, { id: '4', name: 'Franca', state: 'SP' },
]
function Host() {
  const [v, setV] = useState('')
  return <><CityCombobox id="c" label="Cidade" cities={cities} value={v} onChange={setV} /><output>{v}</output></>
}
afterEach(cleanup)

describe('busca de cidade digitando', () => {
  it('filtra sem exigir acento e escolhe com o mouse', () => {
    render(<Host />)
    const input = screen.getByRole('combobox', { name: 'Cidade' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'sao sebas' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.mouseDown(screen.getByRole('option', { name: /São Sebastião do Paraíso - MG/ }))
    expect(document.querySelector('output')).toHaveTextContent('3')
    expect(input).toHaveValue('São Sebastião do Paraíso - MG')
  })
  it('teclado: digita, seta para baixo e Enter', () => {
    render(<Host />)
    const input = screen.getByRole('combobox', { name: 'Cidade' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mg' } })
    expect(screen.getAllByRole('option')).toHaveLength(3)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(document.querySelector('output')).toHaveTextContent('2')
    expect(input).toHaveValue('Passos - MG')
  })
  it('sem resultado avisa', () => {
    render(<Host />)
    const input = screen.getByRole('combobox', { name: 'Cidade' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'manaus' } })
    expect(screen.getByText('Nenhuma cidade encontrada.')).toBeInTheDocument()
  })
})
