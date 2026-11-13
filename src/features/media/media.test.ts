import { describe, expect, it } from 'vitest'
import { checkSelection, sniff } from './media'

const bytes = (...v: (number | string)[]) => new Uint8Array(v.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])))

describe('mídia: tipo real e quantidade', () => {
  it('reconhece pelos primeiros bytes, não pela extensão', () => {
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe('image/jpeg')
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe('image/png')
    expect(sniff(bytes('GIF89a'))?.mime).toBe('image/gif')
    expect(sniff(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))?.mime).toBe('image/webp')
    expect(sniff(bytes(0x1a, 0x45, 0xdf, 0xa3))?.kind).toBe('video')
    expect(sniff(bytes(0, 0, 0, 0x18, 'ftyp', 'isom'))?.mime).toBe('video/mp4')
    expect(sniff(bytes(0, 0, 0, 0x14, 'ftyp', 'qt  '))?.mime).toBe('video/quicktime')
  })
  it('recusa SVG, HTML, PDF, executável e HEIC', () => {
    expect(sniff(bytes('<svg xmlns'))).toBeNull()
    expect(sniff(bytes('<!DOCTYPE html>'))).toBeNull()
    expect(sniff(bytes('%PDF-1.7'))).toBeNull()
    expect(sniff(bytes('MZ', 0x90, 0))).toBeNull()
    expect(sniff(bytes(0x7f, 'ELF'))).toBeNull()
    expect(sniff(bytes(0, 0, 0, 0x18, 'ftyp', 'heic'))).toBeNull()
  })
  it('até 5 fotos ou 1 vídeo', () => {
    const img = { kind: 'image' as const }, vid = { kind: 'video' as const }
    expect(checkSelection([img, img, img, img, img])).toBeNull()
    expect(checkSelection([img, img, img, img, img, img])).toMatch(/5 fotos/)
    expect(checkSelection([vid])).toBeNull()
    expect(checkSelection([vid, vid])).toMatch(/1 vídeo/)
    expect(checkSelection([img, vid])).toMatch(/não os dois/)
  })
})
