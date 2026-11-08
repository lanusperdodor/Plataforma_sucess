import type { City } from '../catalog/schemas'

export interface UserLocation {
  source: 'city-center-estimate' | 'gps'
  lat: number
  lng: number
}

/**
 * Localização usada para estimar distâncias. Hoje: centro da cidade (estimativa).
 *
 * Para plugar GPS depois: após consentimento explícito do usuário (botão "Usar minha
 * localização"), chamar `navigator.geolocation.getCurrentPosition` e devolver
 * `{ source: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude }`,
 * caindo neste fallback se negado/indisponível. Nunca pedir permissão automaticamente.
 */
export function currentLocationEstimate(city: Pick<City, 'centerLat' | 'centerLng'>): UserLocation | null {
  if (city.centerLat == null || city.centerLng == null) return null
  return { source: 'city-center-estimate', lat: city.centerLat, lng: city.centerLng }
}
