import { Overlay, type OverlayBaseProps } from './Overlay.tsx'

/** Modal centralizado (6.7, 18.1). */
export function Dialog(props: OverlayBaseProps) {
  return <Overlay variant="dialog" {...props} />
}
