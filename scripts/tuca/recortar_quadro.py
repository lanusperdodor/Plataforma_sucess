import sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi

def key_frame(rgb):
    a = rgb.astype(np.float32)
    L = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
    h, w = L.shape
    neutral = sat < 16
    g = neutral & (np.abs(L - 176) <= 9)
    wh = neutral & (np.abs(L - 220) <= 8)
    gy, gx = np.gradient(L)
    edge = (np.abs(gx) > 12) | (np.abs(gy) > 12)
    # bordas retas do xadrez: gradiente quase só horizontal ou só vertical
    axial = edge & ((np.abs(gx) < 4) | (np.abs(gy) < 4))
    k = 35
    p1 = ndi.uniform_filter(g.astype(np.float32), k)
    p2 = ndi.uniform_filter(wh.astype(np.float32), k)
    ef = ndi.uniform_filter(axial.astype(np.float32), k)
    tex = (p1 > 0.12) & (p2 > 0.12) & (p1 + p2 > 0.45) & (ef > 0.06)
    pix = neutral & (L >= 160) & (L <= 232)
    bg = tex & pix
    # o miolo de cada quadrado também é fundo mesmo com a janela na beira do tucano
    bg |= (g | wh) & (ndi.uniform_filter(bg.astype(np.float32), 9) > 0.5)
    fg = ~bg
    # descasca a franja: pixel neutro com cor de quadrado encostado no fundo vira fundo (até 4 px)
    near = neutral & (L >= 150) & (L <= 235)
    for _ in range(4):
        edge_bg = ndi.binary_dilation(~fg, iterations=1)
        fg &= ~(edge_bg & near)
    # restos cinza presos entre penas/bico: manchas neutras pequenas encostadas no fundo
    nl, nn = ndi.label(fg & near)
    if nn:
        ns = ndi.sum(np.ones_like(L), nl, np.arange(1, nn + 1))
        touch = ndi.maximum(ndi.binary_dilation(~fg, iterations=2).astype(np.uint8), nl, np.arange(1, nn + 1))
        drop = np.zeros(nn + 1, bool); drop[1:] = (ns < 6000) & (touch > 0)
        fg &= ~drop[nl]
    fg = ndi.binary_opening(fg, iterations=2)
    holes = ndi.binary_fill_holes(fg) & ~fg
    hl, hn = ndi.label(holes)
    if hn:
        hs = ndi.sum(np.ones_like(L), hl, np.arange(1, hn + 1))
        small = np.zeros(hn + 1, bool); small[1:] = hs < 150
        fg |= small[hl]
    shadow = (np.arange(h)[:, None] > h * 0.86) & (sat < 18) & (L > 70)
    fg &= ~shadow
    fg[int(h * 0.91):, int(w * 0.86):] = False
    fl, fn = ndi.label(fg)
    if fn:
        fs = ndi.sum(np.ones_like(L), fl, np.arange(1, fn + 1))
        big = np.zeros(fn + 1, bool); big[1:] = fs > 1500
        fg = big[fl]
    fg = ndi.binary_erosion(fg, iterations=1)  # tira a borda misturada com o xadrez (evita halo claro no escuro)
    alpha = ndi.gaussian_filter(fg.astype(np.float32), 0.8)
    return np.clip((alpha - 0.15) / 0.7, 0, 1)

if __name__ == '__main__':
    rgb = np.asarray(Image.open(sys.argv[1]).convert('RGB'))
    al = key_frame(rgb)
    Image.fromarray(np.dstack([rgb, (al * 255).astype(np.uint8)])).save(sys.argv[2])
