# Animação do Tuca

O vídeo original (`public/brand/tuca-apresentador.mp4`) tem o fundo xadrez gravado nos quadros.
A animação usada no site (`public/brand/tuca-animado.webp`) é gerada uma vez, com fundo transparente de verdade:

```bash
mkdir -p frames out
ffmpeg -i ../../public/brand/tuca-apresentador.mp4 -vf fps=12 frames/f%03d.png
python3 recortar_todos.py   # precisa de numpy, scipy e Pillow
ffmpeg -framerate 12 -i out/f%03d.png -c:v libwebp_anim -lossless 0 -quality 80 -compression_level 6 -loop 0 -pix_fmt yuva420p tuca-animado.webp
```

O recorte reconhece o xadrez pela textura (quadrados cinza/branco alternados com bordas retas), e não só pela cor.
Por isso o branco do peito fica inteiro e os espaços fechados (entre bico, asa e balão) também ficam transparentes.
A sombra do chão e a marca d'água são removidas. O primeiro quadro vira `tuca-animado-quadro.webp`.
