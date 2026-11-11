import { useId, useState } from 'react'

/**
 * Gráficos do painel (SVG puro, sem biblioteca): uma série por gráfico, um eixo,
 * barras finas com topo arredondado, grade discreta, valor exato ao passar o mouse
 * ou focar pelo teclado, e tabela equivalente para leitores de tela.
 */

const BAR = 'var(--color-accent)' // #c2410c: contraste ≥ 3:1 sobre o fundo claro

export interface Datum {
  label: string
  /** Rótulo completo para tooltip e tabela (ex.: "novembro de 2026"). */
  fullLabel?: string
  value: number
}

/** Escala "bonita" para o eixo: 0 até um teto arredondado, com 4 divisões. */
export function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(max))
  const n = max / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}

function DataTable({ data, format, caption }: { data: Datum[]; format: (v: number) => string; caption: string }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-ink-muted">Ver tabela</summary>
      <table className="mt-2 w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label} className="border-t border-line">
              <th scope="row" className="py-1 font-normal text-ink-muted">{d.fullLabel ?? d.label}</th>
              <td className="py-1 text-right font-semibold text-ink">{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** Colunas verticais (série temporal). */
export function ColumnChart({ title, data, format, empty }: { title: string; data: Datum[]; format: (v: number) => string; empty: string }) {
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  const W = 640
  const H = 220
  const pad = { top: 16, right: 8, bottom: 28, left: 64 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const slot = innerW / Math.max(1, data.length)
  const barW = Math.min(28, slot * 0.6)
  const y = (v: number) => pad.top + innerH - (v / max) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const allZero = data.every((d) => d.value === 0)
  const a = active !== null ? data[active] : null

  return (
    <figure className="m-0" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="mb-2 text-sm font-semibold text-ink">{title}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${title}. ${allZero ? empty : 'Use Ver tabela para os valores.'}`} onMouseLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-line" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--color-ink-muted)] text-[12px]">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.left + slot * i + (slot - barW) / 2
            const top = y(d.value)
            const h = pad.top + innerH - top
            const r = Math.min(4, h, barW / 2)
            return (
              <g key={d.label}>
                {/* área de toque maior que a barra */}
                <rect
                  x={pad.left + slot * i}
                  y={pad.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  role="presentation"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none focus-visible:fill-[var(--color-muted)]"
                />
                {h > 0 && (
                  <path
                    d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                    fill={BAR}
                    opacity={active === null || active === i ? 1 : 0.45}
                    pointerEvents="none"
                  />
                )}
                <text x={pad.left + slot * i + slot / 2} y={H - 8} textAnchor="middle" className="fill-[var(--color-ink-muted)] text-[12px]">{d.label}</text>
              </g>
            )
          })}
          <line x1={pad.left} x2={W - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="currentColor" className="text-ink-muted" strokeWidth={1} />
        </svg>
        {a && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-lg border border-line bg-surface px-2 py-1 text-xs shadow-[var(--shadow-card)]"
            style={{ left: `${((pad.left + slot * active! + slot / 2) / W) * 100}%`, transform: 'translateX(-50%)' }}
          >
            <span className="block text-ink-muted">{a.fullLabel ?? a.label}</span>
            <span className="font-semibold text-ink">{format(a.value)}</span>
          </div>
        )}
        {allZero && <p className="absolute inset-x-0 top-1/3 text-center text-sm text-ink-muted">{empty}</p>}
      </div>
      <DataTable data={data} format={format} caption={title} />
    </figure>
  )
}

/** Barras horizontais (comparar categorias), com o valor escrito ao lado. */
export function BarList({ title, data, format, empty }: { title: string; data: Datum[]; format: (v: number) => string; empty: string }) {
  const max = Math.max(0, ...data.map((d) => d.value))
  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-sm font-semibold text-ink">{title}</figcaption>
      {max === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((d) => (
            <li key={d.label} className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-2 text-sm" title={`${d.label}: ${format(d.value)}`}>
              <span className="truncate text-ink-muted">{d.label}</span>
              <span className="h-3 rounded-r bg-muted">
                <span className="block h-3 rounded-r" style={{ width: `${(d.value / max) * 100}%`, background: BAR }} />
              </span>
              <span className="font-semibold text-ink">{format(d.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}
