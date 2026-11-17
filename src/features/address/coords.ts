/**
 * Lê coordenadas coladas pela pessoa: "-20.737, -46.752", "-20,737 -46,752", ou um link do Google Maps / OpenStreetMap
 * (…/@-20.737,-46.752,17z, ?q=-20.737,-46.752, ?ll=…, #map=17/-20.737/-46.752). Só aceita pontos dentro do Brasil.
 */
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const s = input.trim()
  if (!s) return null
  const pairs: [string, string][] = []
  const at = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (at) pairs.push([at[1]!, at[2]!])
  const q = s.match(/[?&](?:q|ll|query|center|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i)
  if (q) pairs.push([q[1]!, q[2]!])
  const osm = s.match(/map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/)
  if (osm) pairs.push([osm[1]!, osm[2]!])
  // texto puro: "lat, lng" com ponto decimal, ou "lat lng"/"lat; lng" com vírgula decimal
  const dot = s.match(/^(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)$/)
  if (dot) pairs.push([dot[1]!, dot[2]!])
  const comma = s.match(/^(-?\d{1,2},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)$/)
  if (comma) pairs.push([comma[1]!.replace(',', '.'), comma[2]!.replace(',', '.')])
  for (const [a, b] of pairs) {
    const lat = Number(a), lng = Number(b)
    if (lat >= -34 && lat <= 6 && lng >= -74 && lng <= -28) return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }
  }
  return null
}
