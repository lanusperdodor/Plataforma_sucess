/**
 * Versão nova publicada com a aba aberta: os arquivos antigos de cada tela deixam de existir no servidor e a navegação
 * falha ("não foi possível carregar esta tela"). Aqui o app recarrega SOZINHO uma vez para pegar a versão nova.
 * Se falhar de novo em pouco tempo (sem internet de verdade), aí sim mostra a mensagem com o botão.
 */
const RELOAD_KEY = 'tucai:recarga-versao'
const WINDOW_MS = 60_000

/** Recarrega se não recarregou há pouco. Devolve true quando a página vai recarregar. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // sem armazenamento: recarrega mesmo assim (no pior caso, o boot-guard mostra o botão)
  }
  window.location.reload()
  return true
}

/** Registrado uma vez na inicialização: falha ao pré-carregar um arquivo da versão antiga → recarrega. */
export function installStaleBuildRecovery() {
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForNewVersion()) e.preventDefault()
  })
}
