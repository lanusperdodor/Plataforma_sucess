import glob, numpy as np
from PIL import Image
from recortar_quadro import key_frame
for f in sorted(glob.glob('frames/*.png')):
    rgb = np.asarray(Image.open(f).convert('RGB'))
    al = key_frame(rgb)
    im = Image.fromarray(np.dstack([rgb, (al * 255).astype(np.uint8)])).resize((640, 360), Image.LANCZOS)
    im.save(f.replace('frames/', 'out/'))
