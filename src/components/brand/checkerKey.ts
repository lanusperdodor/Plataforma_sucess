/**
 * Remove o "xadrez de transparência" gravado como imagem no vídeo do Tuca (o arquivo não tem
 * canal alfa). Flood fill a partir das bordas sobre pixels cinza-neutros (fundo ~178/~220 e a
 * sombra do chão). Regiões fechadas pelo contorno escuro (peito, balão) não são alcançadas.
 */
export interface KeyOptions {
  lo?: number
  hi?: number
  neutral?: number
  /** A partir desta linha (faixa do chão com sombra) aceita fundo mais escuro (floorLo). */
  floorY?: number
  floorLo?: number
  /** Retângulos sempre transparentes (ex.: marca d'água). */
  clear?: readonly { x: number; y: number; w: number; h: number }[]
}

export function keyCheckerboard(px: Uint8ClampedArray, w: number, h: number, o: KeyOptions = {}): void {
  const lo = o.lo ?? 140
  const hi = o.hi ?? 238
  const neutral = o.neutral ?? 18
  const floorY = o.floorY ?? h
  const floorLo = o.floorLo ?? 80
  const n = w * h
  const bg = new Uint8Array(n)
  const stack = new Int32Array(n)
  let top = 0
  const isBg = (i: number) => {
    const p = i * 4
    const r = px[p]!
    const g = px[p + 1]!
    const b = px[p + 2]!
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    return mx - mn <= neutral && mn >= (i >= floorY * w ? floorLo : lo) && mx <= hi
  }
  const push = (i: number) => {
    if (bg[i] === 0 && isBg(i)) {
      bg[i] = 1
      stack[top++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (top > 0) {
    const i = stack[--top]!
    const x = i % w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (i >= w) push(i - w)
    if (i < n - w) push(i + w)
  }
  // Bolsões fechados (ex.: entre bico e asa): componentes não alcançados que têm os DOIS tons
  // do xadrez (~178 e ~220) em boa proporção são fundo. Peito/balão (brancos) não se encaixam.
  const seen = new Uint8Array(n)
  const comp: number[] = []
  for (let s = 0; s < n; s++) {
    if (bg[s] === 1 || seen[s] === 1 || !isBg(s)) continue
    comp.length = 0
    let dark = 0
    let light = 0
    seen[s] = 1
    stack[top++] = s
    while (top > 0) {
      const i = stack[--top]!
      comp.push(i)
      const v = px[i * 4]!
      if (v >= 165 && v <= 192) dark++
      else if (v >= 206 && v <= 232) light++
      const x = i % w
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]
      for (const j of nb) {
        if (j >= 0 && seen[j] === 0 && bg[j] === 0 && isBg(j)) {
          seen[j] = 1
          stack[top++] = j
        }
      }
    }
    const total = comp.length
    if (total >= 12 && dark / total > 0.2 && light / total > 0.2) for (const i of comp) bg[i] = 1
  }
  for (const r of o.clear ?? []) {
    for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++)
      for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) bg[y * w + x] = 1
  }
  for (let i = 0; i < n; i++) {
    if (bg[i] === 1) {
      px[i * 4 + 3] = 0
      continue
    }
    const x = i % w
    const edge =
      (x > 0 && bg[i - 1] === 1) || (x < w - 1 && bg[i + 1] === 1) || (i >= w && bg[i - w] === 1) || (i < n - w && bg[i + w] === 1)
    if (edge) {
      const p = i * 4
      if ((px[p]! + px[p + 1]! + px[p + 2]!) / 3 > 120) px[p + 3] = 120 // suaviza a borda clara
    }
  }
}