"""Exterior de la tapa con el mismo marco, latón y cuero de la base (el monograma se pone en la web)."""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

scene = np.asarray(Image.open('trio-b.png').convert('RGB')).astype(float)
OUT = (187, 190, 1863, 1128)        # borde exterior de la caja
PANEL = (256, 257, 1787, 1057)      # dentro del filo de latón

# 1. Muestra de cuero del marco superior, sin el gradiente de luz del bisel
band = scene[198:230, 300:1750].copy()
light = ndi.gaussian_filter(band, sigma=(30, 60, 0))
flat = band / np.maximum(light, 1) * band.reshape(-1, 3).mean(0)

# 2. Síntesis por parches aleatorios (sin girarlos, para respetar la dirección del grano)
ph, pw = PANEL[3] - PANEL[1], PANEL[2] - PANEL[0]
rng = np.random.default_rng(11)
P, step = 28, 16
win = np.outer(np.hanning(P), np.hanning(P))[..., None] + 1e-3
acc = np.zeros((ph + P, pw + P, 3)); wsum = np.zeros((ph + P, pw + P, 1))
for y in range(0, ph + 1, step):
    for x in range(0, pw + 1, step):
        sy = rng.integers(0, flat.shape[0] - P); sx = rng.integers(0, flat.shape[1] - P)
        acc[y:y+P, x:x+P] += flat[sy:sy+P, sx:sx+P] * win; wsum[y:y+P, x:x+P] += win
leather = (acc / np.maximum(wsum, 1e-6))[:ph, :pw]
leather = leather + 0.8 * (leather - ndi.gaussian_filter(leather, sigma=(1.0, 1.0, 0)))

# 3. Tono del cuero del marco, luz desde arriba a la izquierda y un leve acolchado
target = scene[205:228, 300:1750].reshape(-1, 3).mean(0)
leather = leather / leather.reshape(-1, 3).mean(0) * target
yy, xx = np.mgrid[0:ph, 0:pw]
grad = 1.12 - 0.18 * (yy / ph) - 0.10 * (xx / pw)
edge = np.minimum.reduce([yy, xx, ph - 1 - yy, pw - 1 - xx]).astype(float)
pad = 0.62 + 0.38 * np.clip(edge / 70, 0, 1) ** 0.7
leather = leather * (grad * pad)[..., None]

lid = scene.copy()
lid[PANEL[1]:PANEL[3], PANEL[0]:PANEL[2]] = leather
lid = Image.fromarray(lid.clip(0, 255).astype(np.uint8)).crop(OUT)
lid.save('../../public/brand/box-lid-outer.jpg', quality=90)
lid.resize((lid.width // 2, lid.height // 2)).save('lid-outer-preview.jpg')
print(lid.size)
