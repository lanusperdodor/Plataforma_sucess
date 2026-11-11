/** Caminho de arquivo público respeitando o base do build ('/' no site, './' na prévia estática). */
const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`

/** Identidade centralizada. Trocar aqui (e em tokens.css) renomeia a plataforma inteira. */
export const BRAND = {
  name: 'Tucaí',
  shortName: 'Tucaí',
  slogan: 'Tudo junto. Tudo aí.',
  mascot: 'Tuca',
  /** Arquivos públicos em /public/brand (servidos sem passar pelo bundle). */
  assets: {
    logoHorizontal: asset('brand/logo-horizontal.svg'),
    icon: asset('brand/icone.svg'),
    presenter: asset('brand/tuca-apresentador-600.png'),
    presenter2x: asset('brand/tuca-apresentador.png'),
    /** Vídeo do Tuca (1280×720, 5 s, balão já embutido). O xadrez gravado no fundo é removido em tempo real (checkerKey). */
    presenterVideo: { src: asset('brand/tuca-apresentador.mp4'), hasBakedBubble: true, enabled: true },
  },
  locale: 'pt-BR',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  initialRegion: { city: 'Itaú de Minas', state: 'MG', discoveryRadiusKm: 200 },
} as const