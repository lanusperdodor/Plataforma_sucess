export const colors = {
  bg: '#0C0C11',
  surface: '#15151D',
  surface2: '#1D1D28',
  border: '#2A2A39',
  primary: '#8B80F9',
  primaryStrong: '#7468F0',
  primarySoft: 'rgba(139,128,249,0.14)',
  text: '#F5F5F3',
  muted: '#9C9CAB',
  faint: '#6C6C7C',
  success: '#4ADE80',
  successSoft: 'rgba(74,222,128,0.13)',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.13)',
  warn: '#FBBF24',
  warnSoft: 'rgba(251,191,36,0.12)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

export const font = {
  h1: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
  /** Texto no idioma estudado: maior, para Hangul e caracteres chineses ficarem legíveis. */
  target: { fontSize: 26, fontWeight: '700' as const, lineHeight: 36 },
} as const;
