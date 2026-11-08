import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { CITY_KEY, getStoredCityId, setStoredCityId, useCity } from './cityStore'
import { currentLocationEstimate } from './location'

describe('cityStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setStoredCityId(null)
  })

  it('persiste a cidade em city:v1 e notifica o hook', () => {
    const { result } = renderHook(() => useCity())
    expect(result.current[0]).toBeNull()
    act(() => result.current[1]('c2'))
    expect(result.current[0]).toBe('c2')
    expect(window.localStorage.getItem(CITY_KEY)).toBe('"c2"')
    expect(getStoredCityId()).toBe('c2')
  })

  it('valor inválido resulta em vazio e é descartado', () => {
    window.localStorage.setItem(CITY_KEY, '{nao-json')
    expect(getStoredCityId()).toBeNull()
    window.localStorage.setItem(CITY_KEY, JSON.stringify(42))
    expect(getStoredCityId()).toBeNull()
    expect(window.localStorage.getItem(CITY_KEY)).toBeNull()
  })

  it('currentLocationEstimate devolve o centro da cidade como estimativa', () => {
    expect(currentLocationEstimate({ centerLat: -1, centerLng: -2 })).toEqual({
      source: 'city-center-estimate',
      lat: -1,
      lng: -2,
    })
    expect(currentLocationEstimate({ centerLat: null, centerLng: null })).toBeNull()
  })
})
