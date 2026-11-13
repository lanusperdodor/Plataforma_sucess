/**
 * Upload de mídia (0045): avatar, fotos e vídeo das publicações.
 * Limites aprovados: avatar 5 MB · imagem 10 MB · até 5 imagens por publicação · vídeo 50 MB e 60 s (1 por publicação).
 * Aqui: conferência do tipo REAL pelos primeiros bytes (não pela extensão), compressão das fotos (que também remove
 * dados de localização do arquivo) e envio para a pasta da própria pessoa no Storage. O servidor confere tudo de novo
 * (buckets com limite e tipos permitidos, regras por pasta e a função post_attach_media).
 */

export const LIMITS = {
  avatarBytes: 5 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  videoBytes: 50 * 1024 * 1024,
  videoSeconds: 60,
  imagesPerPost: 5,
} as const

export type MediaKind = 'image' | 'video'
export type Sniffed = { kind: MediaKind; mime: string; ext: string }

/** Tipo real pelos primeiros bytes. null = não permitido (SVG, HTML, PDF, executável, etc.). */
export function sniff(bytes: Uint8Array): Sniffed | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => bytes[i + j] === x)
  const ascii = (i: number, s: string) => [...s].every((c, j) => bytes[i + j] === c.charCodeAt(0))
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' }
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'image', mime: 'image/png', ext: 'png' }
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { kind: 'image', mime: 'image/gif', ext: 'gif' }
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', mime: 'image/webp', ext: 'webp' }
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', mime: 'video/webm', ext: 'webm' }
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', ext: 'mov' }
    // HEIC/AVIF também usam ftyp: não são vídeo e não são aceitos (o navegador nem sempre mostra)
    if (/^(heic|heix|hevc|mif1|msf1|avif|avis)$/.test(brand)) return null
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' }
  }
  return null
}

async function head(file: Blob, n = 16): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer())
}

const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`

/** Duração do vídeo medida no aparelho (o servidor confere o valor e o tamanho). */
export function videoDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const done = () => URL.revokeObjectURL(url)
    v.onloadedmetadata = () => {
      done()
      if (Number.isFinite(v.duration)) resolve(v.duration)
      else reject(new Error('Não foi possível ler a duração do vídeo.'))
    }
    v.onerror = () => { done(); reject(new Error('Vídeo inválido ou em formato não suportado.')) }
    v.src = url
  })
}

/** Reduz a foto (lado maior) e converte para WebP. Recriar a imagem remove os dados EXIF (como a localização). */
export async function compressImage(file: Blob, maxSide: number, maxBytes: number): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const width = Math.max(1, Math.round(bmp.width * scale))
  const height = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Seu navegador não conseguiu preparar a foto.')
  ctx.drawImage(bmp, 0, 0, width, height)
  bmp.close?.()
  for (const q of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', q))
    if (blob && blob.size <= maxBytes) return { blob, width, height }
  }
  throw new Error(`A foto continua acima de ${mb(maxBytes)} depois de comprimida.`)
}

export interface PreparedMedia { kind: MediaKind; blob: Blob; mime: string; ext: string; width?: number; height?: number; durationS?: number; name: string }

/** Confere e prepara um arquivo para publicação. Lança erro com mensagem para a pessoa. */
export async function prepareForPost(file: File): Promise<PreparedMedia> {
  const t = sniff(await head(file))
  if (!t) throw new Error(`"${file.name}": tipo não permitido. Envie JPG, PNG, WebP, GIF, MP4, WebM ou MOV.`)
  if (t.kind === 'video') {
    if (file.size > LIMITS.videoBytes) throw new Error(`"${file.name}": vídeo acima de ${mb(LIMITS.videoBytes)}.`)
    const d = await videoDuration(file)
    if (d > LIMITS.videoSeconds) throw new Error(`"${file.name}": vídeo com mais de ${LIMITS.videoSeconds} segundos.`)
    return { kind: 'video', blob: file, mime: t.mime, ext: t.ext, durationS: Math.round(d * 100) / 100, name: file.name }
  }
  // GIF fica como está (animação); as outras fotos são comprimidas
  if (t.mime === 'image/gif') {
    if (file.size > LIMITS.imageBytes) throw new Error(`"${file.name}": GIF acima de ${mb(LIMITS.imageBytes)}.`)
    return { kind: 'image', blob: file, mime: t.mime, ext: t.ext, name: file.name }
  }
  if (file.size > 40 * 1024 * 1024) throw new Error(`"${file.name}": foto grande demais.`)
  const c = await compressImage(file, 1600, LIMITS.imageBytes)
  return { kind: 'image', blob: c.blob, mime: 'image/webp', ext: 'webp', width: c.width, height: c.height, name: file.name }
}

/** Regras de quantidade: até 5 imagens OU 1 vídeo. */
export function checkSelection(items: Pick<PreparedMedia, 'kind'>[]): string | null {
  const imgs = items.filter((i) => i.kind === 'image').length
  const vids = items.filter((i) => i.kind === 'video').length
  if (vids > 1) return 'Só 1 vídeo por publicação.'
  if (vids > 0 && imgs > 0) return 'Envie fotos ou um vídeo, não os dois juntos.'
  if (imgs > LIMITS.imagesPerPost) return `No máximo ${LIMITS.imagesPerPost} fotos por publicação.`
  return null
}

