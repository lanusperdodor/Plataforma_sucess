/** Raio médio da Terra (IUGG), o mesmo de public.haversine_km no banco. */
export const EARTH_RADIUS_KM = 6371.0088

const rad = (deg: number) => (deg * Math.PI) / 180

/** Distância de grande círculo (Haversine), em km. Mesma fórmula da migration 0010. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Normaliza para busca: minúsculas, sem acento, hífen/apóstrofo viram espaço (igual a private.fold). */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
