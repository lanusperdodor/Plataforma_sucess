import type { PostMedia } from '../../features/media/repository.ts'

/** Fotos (grade) ou vídeo da publicação. Carregamento preguiçoso e espaço reservado para não "pular" a tela. */
export function PostMediaView({ media }: { media: PostMedia[] }) {
  if (media.length === 0) return null
  const video = media.find((m) => m.kind === 'video')
  if (video) {
    return (
      <video controls preload="metadata" playsInline className="max-h-[70vh] w-full rounded-2xl bg-ink/5" src={video.url}
        aria-label={`Vídeo da publicação${video.durationS ? `, ${Math.round(video.durationS)} segundos` : ''}`} />
    )
  }
  const imgs = media.filter((m) => m.kind === 'image')
  const cols = imgs.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
  return (
    <div className={`grid gap-1 overflow-hidden rounded-2xl ${cols}`}>
      {imgs.map((m, i) => (
        <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
          className={`block bg-muted ${imgs.length === 3 && i === 0 ? 'row-span-2' : ''} ${imgs.length === 5 && i === 0 ? 'col-span-2' : ''}`}>
          <img src={m.url} alt={`Foto ${i + 1} de ${imgs.length}`} loading="lazy" decoding="async"
            width={m.width ?? undefined} height={m.height ?? undefined}
            className={`h-full w-full object-cover ${imgs.length === 1 ? 'max-h-[70vh]' : 'aspect-square'}`} />
        </a>
      ))}
    </div>
  )
}
