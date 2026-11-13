# Upload de fotos, vídeo e avatar (0045)

| Tipo | Limite | Onde |
|---|---|---|
| Avatar | 5 MB (JPG, PNG, WebP), reduzido para 512 px | Perfil do Conectuaí → "Enviar foto" |
| Imagem | 10 MB cada, até **5** por publicação (JPG, PNG, WebP, GIF) | Publicar → "Fotos ou vídeo" |
| Vídeo | **50 MB** e **60 s**, 1 por publicação (MP4, WebM, MOV) | Publicar → "Fotos ou vídeo" |

**No servidor**
* Storage: um bucket por tipo com tamanho máximo e tipos permitidos (`avatars`, `post-images`, `post-videos`). Sem SVG/HTML.
* Cada pessoa só grava/apaga na própria pasta (`<id>/<uuid>.<ext>`); não existe regra de UPDATE (o arquivo não é trocado).
* A mídia só entra na publicação por `post_attach_media`: dono da publicação, até 1 hora após publicar, até 5 fotos OU 1 vídeo,
  e **tamanho e tipo reais lidos do Storage**. Duração do vídeo: medida no aparelho e conferida (≤ 60 s); o Storage limita o tamanho.
* Leitura: quem vê a publicação vê a mídia (bloqueios e ocultação pela moderação valem igual). Precisa estar logado, como as publicações.
* Moderação: denúncia da publicação (já existente); Master → Moderação mostra as fotos/vídeo e permite remover cada um com motivo (auditado).
* Avatar enviado pela Tucaí só é aceito da pasta da própria pessoa.

**No aparelho**
* Tipo conferido pelos primeiros bytes (não pela extensão); HEIC, SVG, HTML, PDF e executáveis são recusados.
* Fotos reduzidas (lado maior 1600 px) e convertidas para WebP — isso também remove os dados EXIF (localização). GIF fica igual.

**Proteção contra arquivo malicioso:** arquivos servidos pelo domínio do Storage (separado do site), com o tipo fixado no envio,
só tipos de mídia permitidos e CSP do site sem `object`/`frame`. Não há antivírus no servidor: para isso seria preciso um serviço
externo (fica como próximo passo, se você quiser).

**Pendências honestas**
* A duração do vídeo não é medida no servidor (exigiria processar o vídeo). O limite de 50 MB vale sempre.
* Vídeo não é recomprimido (exigiria processamento no servidor). Fotos sim.
* Mídia removida pela moderação sai da Tucaí na hora e o banco tenta apagar o arquivo do Storage (se a versão do Storage não
  permitir apagar pela tabela, o arquivo fica para a limpeza pelo painel do Supabase). Se a pessoa apagar a publicação, os arquivos
  ficam no Storage até uma limpeza periódica (sem aparecer em lugar nenhum da Tucaí).
