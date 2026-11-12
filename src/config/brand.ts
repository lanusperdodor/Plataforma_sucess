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
    /** Vídeo original do Tuca (1280×720, 5 s, balão embutido, fundo xadrez gravado). Mantido como fonte. */
    presenterVideo: { src: asset('brand/tuca-apresentador.mp4'), hasBakedBubble: true, enabled: false },
    /**
     * Animação do Tuca já recortada (WebP animado com transparência real, 640×360, 12 quadros/s), gerada do vídeo
     * por scripts/tuca. Sem xadrez e com o branco do tucano igual nos modos claro e escuro.
     */
    presenterAnimation: { src: asset('brand/tuca-animado.webp'), poster: asset('brand/tuca-animado-quadro.webp'), hasBakedBubble: true, enabled: true },
  },
  locale: 'pt-BR',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  initialRegion: { city: 'Itaú de Minas', state: 'MG', discoveryRadiusKm: 200 },
} as const