import { Overlay, type OverlayBaseProps } from './Overlay.tsx'

export interface SheetProps extends OverlayBaseProps {
  /** 'bottom' (padrão, mobile) ou 'right' (lateral). */
  side?: 'bottom' | 'right'
}

/** Folha inferior (mobile) ou lateral (6.7, 18.1). */
export function Sheet({ side = 'bottom', ...props }: SheetProps) {
  return <Overlay variant={side === 'right' ? 'sheet-right' : 'sheet-bottom'} {...props} />
}
