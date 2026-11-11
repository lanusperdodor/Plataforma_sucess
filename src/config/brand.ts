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
  /**
   * Sede e raios (espelho de public.regional_settings, que é a fonte no servidor):
   * serviceRadiusKm = cidades que a plataforma pode operar (MG/SP, IBGE + Haversine);
   * discoveryRadiusKm = até onde o cliente enxerga cidades ativas. A área de entrega é de cada loja.
   */
  initialRegion: { city: 'Itaú de Minas', state: 'MG', ibgeCode: 3133758, serviceRadiusKm: 100, discoveryRadiusKm: 200 },
} as const