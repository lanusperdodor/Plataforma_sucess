import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { foldText, haversineKm } from './geo'

interface Row { code: number; name: string; uf: string; lat: number; lng: number }

function reference(): Row[] {
  const csv = readFileSync(resolve(__dirname, '../../supabase/reference/ibge_municipios_mg_sp.csv'), 'utf8')
  return csv.trim().split('\n').slice(1).map((l) => {
    const [code, name, uf, lat, lng] = l.split(',')
    return { code: Number(code), name: String(name), uf: String(uf), lat: Number(lat), lng: Number(lng) }
  })
}

describe('haversineKm', () => {
  it('valores conhecidos', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2)
    expect(haversineKm(-20.7375, -46.7525, -20.7375, -46.7525)).toBe(0)
    // simétrica
    expect(haversineKm(-20.7375, -46.7525, -20.7193, -46.609)).toBeCloseTo(haversineKm(-20.7193, -46.609, -20.7375, -46.7525), 10)
  })

  it('área de atendimento: 58 municípios de MG/SP a até 100 km de Itaú de Minas (mesmo resultado do banco)', () => {
    const rows = reference()
    expect(rows.filter((r) => r.uf === 'MG')).toHaveLength(853)
    expect(rows.filter((r) => r.uf === 'SP')).toHaveLength(645)
    const hq = rows.find((r) => r.code === 3133758)!
    expect(hq.name).toBe('Itaú de Minas')
    const dist = (r: Row) => Math.round(haversineKm(hq.lat, hq.lng, r.lat, r.lng) * 10) / 10
    const inArea = rows.filter((r) => haversineKm(hq.lat, hq.lng, r.lat, r.lng) <= 100)
    expect(inArea).toHaveLength(58)
    expect(inArea.filter((r) => r.uf === 'MG')).toHaveLength(38)
    expect(inArea.filter((r) => r.uf === 'SP')).toHaveLength(20)
    expect(dist(rows.find((r) => r.code === 3147907)!)).toBe(15.1) // Passos
    expect(dist(rows.find((r) => r.code === 3525409)!)).toBe(99.4) // Jeriquara: dentro
    expect(dist(rows.find((r) => r.code === 3141306)!)).toBe(100.4) // Medeiros: fora
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length)
  })
})

describe('foldText', () => {
  it('ignora acento, caixa, hífen e apóstrofo', () => {
    expect(foldText('  SÃO Sebastião  do Paraíso ')).toBe('sao sebastiao do paraiso')
    expect(foldText("Pingo-d'Água")).toBe('pingo d agua')
  })
})
