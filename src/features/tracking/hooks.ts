import { useEffect, useRef } from 'react'
import { trackViewItemList, type TrackItem } from './tracker'

/** view_item_list uma vez por conjunto de itens exibido (sem repetir em re-render). */
export function useTrackItemList(listId: string, listName: string, items: TrackItem[]): void {
  const last = useRef('')
  const key = `${listId}:${items.map((i) => i.id).join(',')}`
  useEffect(() => {
    if (items.length === 0 || last.current === key) return
    last.current = key
    trackViewItemList(listId, listName, items)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- a chave já representa a lista
}
