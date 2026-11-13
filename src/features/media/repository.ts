/** Envio e leitura de mídia no Supabase Storage (0045). As regras de arquivo ficam em media.ts. */
import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { LIMITS, checkSelection, compressImage, sniff, type MediaKind, type PreparedMedia } from './media'

async function head(file: Blob, n = 16): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer())
}

function newId(): string {
  return crypto.randomUUID()
}

async function put(bucket: string, path: string, blob: Blob, contentType: string): Promise<void> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType, upsert: false, cacheControl: '31536000' })
  if (error) {
    const msg = /exceeded|too large|payload/i.test(error.message) ? 'Arquivo acima do limite permitido.'
      : /mime|type/i.test(error.message) ? 'Tipo de arquivo não permitido.'
      : /not found|bucket/i.test(error.message) ? 'O envio de arquivos ainda não está ativado. Atualize o banco (migração 0045).'
      : 'Não foi possível enviar o arquivo. Tente de novo.'
    throw new RepositoryError('validation', msg, undefined, { cause: error })
  }
}

export const publicUrl = (bucket: string, path: string) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl

/** Envia as mídias preparadas e anexa à publicação (o servidor confere dono, tipo, quantidade e tamanho real). */
export async function uploadAndAttach(postId: string, userId: string, items: PreparedMedia[]): Promise<void> {
  if (items.length === 0) return
  const err = checkSelection(items)
  if (err) throw new RepositoryError('validation', err)
  const sent: { kind: MediaKind; path: string; size: number; width?: number; height?: number; duration_s?: number }[] = []
  for (const it of items) {
    const path = `${userId}/${newId()}.${it.ext}`
    await put(it.kind === 'image' ? 'post-images' : 'post-videos', path, it.blob, it.mime)
    sent.push({ kind: it.kind, path, size: it.blob.size, width: it.width, height: it.height, duration_s: it.durationS })
  }
  const { error } = await supabase.rpc('post_attach_media', { _post: postId, _items: sent })
  if (error) throw mapPostgrestError(error)
}

/** Foto de perfil: confere, reduz para 512 px e envia; devolve o endereço público para salvar no perfil. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const t = sniff(await head(file))
  if (!t || t.kind !== 'image' || t.mime === 'image/gif') throw new RepositoryError('validation', 'Envie uma foto JPG, PNG ou WebP.')
  if (file.size > 40 * 1024 * 1024) throw new RepositoryError('validation', 'Foto grande demais.')
  const c = await compressImage(file, 512, LIMITS.avatarBytes)
  const path = `${userId}/${newId()}.webp`
  await put('avatars', path, c.blob, 'image/webp')
  return publicUrl('avatars', path)
}

// ---------- leitura da mídia das publicações ----------
const mediaRow = z.object({
  id: z.string(), post_id: z.string(), kind: z.enum(['image', 'video']), bucket: z.string(), path: z.string(),
  width: z.number().nullable(), height: z.number().nullable(), duration_s: z.coerce.number().nullable(), position: z.number(),
})
export interface PostMedia { id: string; kind: MediaKind; url: string; width: number | null; height: number | null; durationS: number | null }

/** Mídias por publicação. Sem a 0045 no banco, devolve vazio (as publicações seguem normais). */
export async function mediaForPosts(postIds: string[]): Promise<Map<string, PostMedia[]>> {
  const out = new Map<string, PostMedia[]>()
  if (!isSupabaseConfigured || postIds.length === 0) return out
  try {
    const { data, error } = await supabase.from('post_media').select('id,post_id,kind,bucket,path,width,height,duration_s,position').in('post_id', postIds).order('position')
    if (error) return out
    const rows = z.array(mediaRow).safeParse(data)
    if (!rows.success) return out
    for (const r of rows.data) {
      const list = out.get(r.post_id) ?? []
      list.push({ id: r.id, kind: r.kind, url: publicUrl(r.bucket, r.path), width: r.width, height: r.height, durationS: r.duration_s })
      out.set(r.post_id, list)
    }
  } catch { /* sem mídia */ }
  return out
}

/** Moderação (Master): remove uma foto ou o vídeo de uma publicação, com motivo (auditado). */
export async function adminRemovePostMedia(mediaId: string, reason: string): Promise<void> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { error } = await supabase.rpc('admin_remove_post_media', { _media: mediaId, _reason: reason.trim() })
  if (error) throw mapPostgrestError(error)
}
