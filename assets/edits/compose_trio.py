"""Monta tres relojes reales (sin alterar) en la caja de tres espacios generada por IA."""
import numpy as np
from PIL import Image, ImageFilter
import masks

scene = Image.open('trio-b.png').convert('RGBA')
SW, SH = scene.size
PILLOW_TOP, PILLOW_BOT = 326, 995

# (función de máscara, ángulo, escala, centro x del cojín, centro y del reloj)
WATCHES = [
    (masks.daytona,      -11.0, 0.68,  521, 660),
    (masks.royal_oak,    -14.7, 0.60, 1017, 622),
    (masks.land_dweller,   0.0, 0.55, 1517, 652),
]

ys = np.arange(SH)[:, None]
edge_fade = np.clip((ys - PILLOW_TOP - 4) / 55, 0, 1) * np.clip((PILLOW_BOT - 4 - ys) / 55, 0, 1)
edge_shade = 0.55 + 0.45 * np.clip((ys - PILLOW_TOP) / 110, 0, 1) * np.clip((PILLOW_BOT - ys) / 110, 0, 1)

out = scene.copy()
for fn, angle, scale, px, py in WATCHES:
    img, (cx, cy) = fn()
    pad = 900
    cv = Image.new('RGBA', (img.width + 2*pad, img.height + 2*pad), (0, 0, 0, 0)); cv.paste(img, (pad, pad))
    c = (cx + pad, cy + pad)
    cv = cv.rotate(angle, resample=Image.BICUBIC, center=c)
    cv = cv.resize((round(cv.width*scale), round(cv.height*scale)), Image.LANCZOS)
    c = (c[0]*scale, c[1]*scale)
    layer = Image.new('RGBA', scene.size, (0, 0, 0, 0))
    layer.paste(cv, (round(px - c[0]), round(py - c[1])), cv)

    # El brazalete "abraza" el cojín: se oscurece y desvanece en los bordes (la caja del reloj no se toca)
    yy, xx = np.ogrid[:SH, :SW]
    case_zone = (xx - px)**2 + (yy - py)**2 < (200)**2
    A = np.asarray(layer).astype(float)
    A[..., 3] *= np.where(case_zone, 1, edge_fade)
    A[..., :3] *= np.where(case_zone, 1, edge_shade)[..., None]
    layer = Image.fromarray(A.clip(0, 255).astype(np.uint8))

    a = layer.split()[3]
    for blur, dx, dy, op in [(28, 16, 26, 0.75), (6, 4, 7, 0.6)]:
        sh = Image.new('RGBA', scene.size, (0, 0, 0, 0))
        sh.paste((0, 0, 0, 255), (dx, dy), a.filter(ImageFilter.GaussianBlur(blur)).point(lambda v, o=op: int(v*o)))
        out.alpha_composite(sh)
    out.alpha_composite(layer)

final = out.crop((130, 120, 1870, 1280)).convert('RGB')   # 3:2
final.save('../../public/watches/collection-trio.jpg', quality=92)

# Versión con espacio arriba para la tapa abierta: se prolonga el ante verde (solo fondo)
EXT = 270
top = out.crop((0, 0, SW, 180)).convert('RGB')
strip = Image.new('RGB', (SW, EXT))
y, flip = EXT, True
while y > 0:
    piece = top.transpose(Image.FLIP_TOP_BOTTOM) if flip else top
    h = min(piece.height, y)
    strip.paste(piece.crop((0, piece.height - h, SW, piece.height)), (0, y - h))
    y -= h; flip = not flip
strip = strip.filter(ImageFilter.GaussianBlur(1.2))
g = np.linspace(0.55, 1.0, EXT)[:, None, None]          # más oscuro hacia arriba
strip = Image.fromarray((np.asarray(strip).astype(float) * g).clip(0, 255).astype(np.uint8))
tall = Image.new('RGB', (SW, SH + EXT)); tall.paste(strip, (0, 0)); tall.paste(out.convert('RGB'), (0, EXT))
tall = tall.crop((130, 0, 1870, 1280 + EXT))
tall.save('../../public/watches/collection-trio-tall.jpg', quality=92)
print('tall', tall.size)
print(final.size)
