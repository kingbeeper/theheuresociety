import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

# ---------- 1. Aislar el reloj (sin alterar sus píxeles) ----------
import masks
watch, (CX, CY) = masks.daytona()
W, H = watch.size
R = 252

# ---------- 2. Enderezar y escalar ----------
ANGLE = -11.0            # correa vertical
SCALE = 0.80             # radio del bisel ≈ 200 px en la escena 2x
pad = 700
canvas = Image.new('RGBA', (W + 2*pad, H + 2*pad), (0, 0, 0, 0)); canvas.paste(watch, (pad, pad))
c = (CX + pad, CY + pad)
canvas = canvas.rotate(ANGLE, resample=Image.BICUBIC, center=c)
canvas = canvas.resize((round(canvas.width*SCALE), round(canvas.height*SCALE)), Image.LANCZOS)
c = (c[0]*SCALE, c[1]*SCALE)

# ---------- 3. Escena (2x) ----------
scene = Image.open('scene-c.png').convert('RGB')
scene = scene.resize((scene.width*2, scene.height*2), Image.LANCZOS).convert('RGBA')
PILLOW_TOP, PILLOW_BOT, PILLOW_CX = 880, 1600, 880
cy_target = (PILLOW_TOP + PILLOW_BOT) / 2 - 10
ox, oy = round(PILLOW_CX - c[0]), round(cy_target - c[1])

layer = Image.new('RGBA', scene.size, (0, 0, 0, 0)); layer.paste(canvas, (ox, oy), canvas)
A = np.asarray(layer).astype(float)

# La correa "se va" por los bordes curvos del cojín: oscurecer y desvanecer
ys = np.arange(scene.height)[:, None]
fade = np.clip((ys - PILLOW_TOP - 10) / 70, 0, 1) * np.clip((PILLOW_BOT - 10 - ys) / 70, 0, 1)
shade = 0.55 + 0.45 * np.clip((ys - PILLOW_TOP) / 110, 0, 1) * np.clip((PILLOW_BOT - ys) / 110, 0, 1)
case_zone = np.zeros(scene.size[::-1], bool)
yy, xx = np.ogrid[:scene.height, :scene.width]
case_zone = (xx - PILLOW_CX)**2 + (yy - cy_target)**2 < (R*SCALE*1.25)**2
fade = np.where(case_zone, 1, fade); shade = np.where(case_zone, 1, shade)
A[..., 3] *= fade
A[..., :3] *= shade[..., None]
layer = Image.fromarray(A.clip(0, 255).astype(np.uint8))

# ---------- 4. Sombras ----------
a = layer.split()[3]
def shadow(blur, dx, dy, opacity):
    s = Image.new('RGBA', scene.size, (0, 0, 0, 0))
    sh = a.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * opacity))
    s.paste((0, 0, 0, 255), (dx, dy), sh)
    return s
out = scene.copy()
out.alpha_composite(shadow(40, 25, 40, 0.75))
out.alpha_composite(shadow(8, 6, 10, 0.6))
out.alpha_composite(layer)

# ---------- 5. Recorte 4:5 ----------
final = out.crop((96, 50, 1696, 2050)).convert('RGB')
final.save('../../public/watches/rolex-daytona-126519ln-box.jpg', quality=92)
final.resize((480, 600), Image.LANCZOS).save('final-preview.jpg')
print(final.size)
