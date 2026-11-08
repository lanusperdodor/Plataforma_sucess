/** Identidade centralizada. Trocar aqui (e em tokens.css) renomeia a plataforma inteira. */
export const BRAND = {
  name: 'Tucaí',
  shortName: 'Tucaí',
  slogan: 'Tudo junto. Tudo aí.',
  mascot: 'Tuca',
  /** Arquivos públicos em /public/brand (servidos sem passar pelo bundle). */
  assets: {
    logoHorizontal: '/brand/logo-horizontal.svg',
    icon: '/brand/icone.svg',
    presenter: '/brand/tuca-apresentador-600.png',
    presenter2x: '/brand/tuca-apresentador.png',
    /** Vídeo do Tuca (1280×720, 5 s, balão já embutido). O xadrez gravado no fundo é removido em tempo real (checkerKey). */
    presenterVideo: { src: '/brand/tuca-apresentador.mp4', hasBakedBubble: true, enabled: true },
  },
  locale: 'pt-BR',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  initialRegion: { city: 'Itaú de Minas', state: 'MG', discoveryRadiusKm: 200 },
} as const