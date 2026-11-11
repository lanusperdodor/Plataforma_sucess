/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Somente builds da prévia estática: JSON das cidades ativas lido do banco no momento do build. */
  readonly VITE_PREVIEW_CITIES?: string
  /** '1' só no build da prévia estática (artefato sem rede). */
  readonly VITE_STATIC_PREVIEW?: string
}
