import type { CSSProperties } from 'react'

export interface SkeletonProps {
  className?: string
  style?: CSSProperties
}

/** Bloco base: dimensões vêm sempre de className/style para evitar layout shift. */
export function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      style={style}
      className={`skeleton-shimmer rounded-lg bg-line ${className}`}
    />
  )
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-[var(--shadow-card)] ${className}`}
    >
      <Skeleton className="aspect-[4/3] w-full rounded-card" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

export function SkeletonList({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-3 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-[var(--shadow-card)]"
        >
          <Skeleton className="size-14 shrink-0 rounded-card" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
