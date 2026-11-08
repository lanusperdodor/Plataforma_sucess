import { ImageOff } from 'lucide-react'
import { useState, type ImgHTMLAttributes } from 'react'

export interface ImgProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'width' | 'height' | 'loading'> {
  /** Obrigatório; use "" apenas para imagens puramente decorativas. */
  alt: string
  width: number
  height: number
  /** Imagem acima da dobra: carrega eager. */
  priority?: boolean
}

export function Img({ alt, width, height, priority = false, className = '', style, onError, ...rest }: ImgProps) {
  const [failed, setFailed] = useState(false)
  const box = { aspectRatio: `${width} / ${height}`, ...style }

  if (failed) {
    return (
      <div
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        data-testid="img-fallback"
        style={box}
        className={`flex w-full items-center justify-center rounded-card bg-muted text-ink-muted ${className}`}
      >
        <ImageOff aria-hidden="true" className="size-6" />
      </div>
    )
  }

  return (
    <img
      {...rest}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      style={box}
      className={`bg-muted ${className}`}
      onError={(e) => {
        setFailed(true)
        onError?.(e)
      }}
    />
  )
}
