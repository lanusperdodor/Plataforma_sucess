import { describe, expect, it } from 'vitest'
import type { City } from '../catalog/schemas'
import { filterCities, statesOf } from './filterCities'

const c = (name: string, state: string, ibgeCode: number | null, distanceFromHqKm: number | null): City => ({
  id: name, name, state, slug: name, centerLat: null, centerLng: null, ibgeCode, distanceFromHqKm,
})
const cities = [
  c('Itaú de Minas', 'MG', 3133758, 0),
  c('Passos', 'MG', 3147907, 15.1),
  c('São Sebastião do Paraíso', 'MG', 3164704, 31.2),
  c('Franca', 'SP', 3516200, 68),
  c('Cidade antiga', 'MG', null, null),
]
const names = (l: City[]) => l.map((x) => x.name)

describe('filterCities', () => {
  it('busca por nome sem acento/caixa e por código IBGE', () => {
    expect(names(filterCities(cities, { query: 'sao sebastiao' }))).toEqual(['São Sebastião do Paraíso'])
    expect(names(filterCities(cities, { query: 'ITAU' }))).toEqual(['Itaú de Minas'])
    expect(names(filterCities(cities, { query: '3516200' }))).toEqual(['Franca'])
    expect(filterCities(cities, {})).toHaveLength(5)
  })
  it('filtra por UF', () => {
    expect(names(filterCities(cities, { state: 'sp' }))).toEqual(['Franca'])
  })
  it('filtro regional por distância exclui cidades sem distância conhecida', () => {
    expect(names(filterCities(cities, { maxDistanceKm: 25 }))).toEqual(['Itaú de Minas', 'Passos'])
    expect(names(filterCities(cities, { maxDistanceKm: 100, state: 'MG' }))).toEqual(['Itaú de Minas', 'Passos', 'São Sebastião do Paraíso'])
  })
  it('lista as UFs', () => {
    expect(statesOf(cities)).toEqual(['MG', 'SP'])
  })
})
