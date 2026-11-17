/** A Tucaí já está aberta como app (instalada pelo site ou pelo app nativo)? Aí não faz sentido oferecer "Baixar app". */
export function runningAsApp(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as { standalone?: boolean }).standalone === true
    || /TucaiApp\//.test(navigator.userAgent)
}
