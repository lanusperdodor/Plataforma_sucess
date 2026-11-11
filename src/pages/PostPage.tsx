import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { NotFoundState } from '../components/feedback/NotFoundState.tsx'
import { SkeletonCard } from '../components/feedback/Skeleton.tsx'
import { Page } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { getPost } from '../features/conecta/repository.ts'
import { PostCard } from './conecta/components.tsx'

/** Publicação do Conectuaí com comentários abertos (link compartilhável). */
export function PostPage() {
  const { postId = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const q = useQuery({ queryKey: ['conecta', 'post', postId, me ?? ''], queryFn: () => getPost(postId, me), enabled: !!postId })
  return (
    <Page>
      <Link to="/conectuai" className="pressable inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink"><ArrowLeft aria-hidden="true" className="size-4" />Conectuaí</Link>
      <h1 className="sr-only">Publicação no Conectuaí</h1>
      <div className="mx-auto w-full max-w-2xl">
        {q.isLoading ? (
          <SkeletonCard />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data ? (
          <PostCard post={q.data} startOpen />
        ) : (
          <NotFoundState title="Publicação indisponível" description="Ela pode ter sido excluída, ocultada ou ser de um perfil fechado." />
        )}
      </div>
    </Page>
  )
}
