"""Interior de la tapa con el mismo marco, latón y terciopelo de la base de la caja."""
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

scene = np.asarray(Image.open('trio-b.png').convert('RGB')).astype(float)
OUT = (187, 190, 1863, 1128)        # borde exterior de la caja
VEL = (256, 257, 1787, 1057)        # zona de terciopelo (dentro del filo de latón)

# 1. Muestra de terciopelo limpio: parte superior del primer divisor, "aplanada" (sin gradiente de luz)
band = scene[300:1000, 745:795].copy()
light = ndi.gaussian_filter(band, sigma=(40, 40, 0))
flat = band / np.maximum(light, 1) * band.reshape(-1, 3).mean(0)

# 2. Síntesis por parches aleatorios con mezcla suave (sin repeticiones visibles)
vh, vw = VEL[3] - VEL[1], VEL[2] - VEL[0]
rng = np.random.default_rng(7)
P, step = 40, 24
win = np.outer(np.hanning(P), np.hanning(P))[..., None] + 1e-3
acc = np.zeros((vh + P, vw + P, 3)); wsum = np.zeros((vh + P, vw + P, 1))
for y in range(0, vh + 1, step):
    for x in range(0, vw + 1, step):
        sy = rng.integers(0, flat.shape[0] - P); sx = rng.integers(0, flat.shape[1] - P)
        patch = flat[sy:sy+P, sx:sx+P]
        if rng.random() < 0.5: patch = patch[:, ::-1]
        if rng.random() < 0.5: patch = patch[::-1]
        acc[y:y+P, x:x+P] += patch * win; wsum[y:y+P, x:x+P] += win
vel = (acc / np.maximum(wsum, 1e-6))[:vh, :vw]
# la mezcla suaviza el grano: se recupera con un poco de enfoque
vel = vel + 0.6 * (vel - ndi.gaussian_filter(vel, sigma=(1.2, 1.2, 0)))

# 3. Igualar el tono al terciopelo del suelo de la base y añadir la luz de la escena
target = scene[1005:1050, 300:700].reshape(-1, 3).mean(0) * 1.15
vel = vel / vel.reshape(-1, 3).mean(0) * target
yy, xx = np.mgrid[0:vh, 0:vw]
grad = 1.08 - 0.16 * (yy / vh) - 0.08 * (xx / vw)                 # luz desde arriba a la izquierda
edge = np.minimum.reduce([yy, xx, vh - 1 - yy, vw - 1 - xx]).astype(float)
inset = 0.55 + 0.45 * np.clip(edge / 45, 0, 1) ** 0.6           # sombra junto al filo de latón
vel = vel * (grad * inset)[..., None]

# 4. Montar: marco y latón reales de la caja + panel de terciopelo
lid = scene.copy()
lid[VEL[1]:VEL[3], VEL[0]:VEL[2]] = vel
lid = Image.fromarray(lid.clip(0, 255).astype(np.uint8)).crop(OUT)
lid.save('../../public/brand/box-lid-inner.jpg', quality=90)
lid.resize((lid.width // 2, lid.height // 2)).save('lid-inner-preview.jpg')
print(lid.size)
