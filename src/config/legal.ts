/**
 * Dados institucionais da Tucaí exibidos nas páginas legais.
 * NÃO preencher com valores inventados: cada campo nulo aparece como "pendente" e
 * precisa ser informado pela Tucaí antes da publicação definitiva (ver docs/CONFORMIDADE.md).
 */
export const LEGAL = {
  controllerName: null as string | null, // razão social
  cnpj: null as string | null,
  address: null as string | null,
  privacyContactEmail: null as string | null, // canal do encarregado (DPO) / privacidade
  dpoName: null as string | null,
  supportContact: null as string | null,
  /** Versão das minutas; mude a cada alteração relevante. */
  documentsVersion: '2026-11-11',
} as const

export const PENDING = 'Pendente — informação a ser fornecida pela Tucaí antes da publicação definitiva.'

export function legalValue(v: string | null): string {
  return v ?? PENDING
}
