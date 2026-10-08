"""Caras de la tapa del estuche, hechas con los materiales de la propia imagen del estuche.
Interior: marco de cuero + ante liso (sin cojines). Exterior: marco + cuero de cocodrilo."""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

# Interior (dentro del marco) de cada estuche: izq, arriba, der, abajo (px desde cada borde)
FRAMES = {"4": (88, 80, 80, 95), "6": (95, 85, 90, 110), "12": (95, 90, 80, 110)}

def quilt(sample, h, w, P=40, step=24, seed=3, flip=True):
    """Rellena h×w con parches aleatorios de `sample`, mezclados sin costuras."""
    rng = np.random.default_rng(seed)
    win = np.outer(np.hanning(P), np.hanning(P))[..., None] + 1e-3
    acc = np.zeros((h + P, w + P, 3)); ws = np.zeros((h + P, w + P, 1))
    for y in range(0, h + 1, step):
        for x in range(0, w + 1, step):
            sy = rng.integers(0, sample.shape[0] - P); sx = rng.integers(0, sample.shape[1] - P)
            p = sample[sy:sy + P, sx:sx + P]
            if flip and rng.random() < .5: p = p[:, ::-1]
            if flip and rng.random() < .5: p = p[::-1]
            acc[y:y + P, x:x + P] += p * win; ws[y:y + P, x:x + P] += win
    out = (acc / np.maximum(ws, 1e-6))[:h, :w]
    return out + 0.6 * (out - ndi.gaussian_filter(out, sigma=(1.2, 1.2, 0)))

def shade(panel):
    """Luz suave desde arriba a la izquierda y sombra junto al marco, como en la bandeja."""
    h, w = panel.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    grad = 1.06 - 0.12 * (yy / h) - 0.06 * (xx / w)
    edge = np.minimum.reduce([yy, xx, h - 1 - yy, w - 1 - xx]).astype(float)
    inset = 0.6 + 0.4 * np.clip(edge / 40, 0, 1) ** 0.7
    return panel * (grad * inset)[..., None]

suede_src = np.asarray(Image.open("public/cases/case-4.jpg").convert("RGB")).astype(float)[770:835, 300:2000]
light = ndi.gaussian_filter(suede_src, sigma=(25, 60, 0))
suede_flat = suede_src / np.maximum(light, 1) * suede_src.reshape(-1, 3).mean(0)

croc_path = sys.argv[1] if len(sys.argv) > 1 else None
croc = np.asarray(Image.open(croc_path).convert("RGB")).astype(float) if croc_path else None

for n, (l, t, r, b) in FRAMES.items():
    base = np.asarray(Image.open(f"public/cases/case-{n}.jpg").convert("RGB")).astype(float)
    H, W = base.shape[:2]
    h, w = H - t - b, W - l - r

    inner = base.copy()
    inner[t:t + h, l:l + w] = shade(quilt(suede_flat, h, w, seed=int(n)))
    Image.fromarray(inner.clip(0, 255).astype(np.uint8)).save(f"public/cases/case-{n}-lid-inner.jpg", quality=88, optimize=True)

    if croc is not None:
        # El cuero de cocodrilo se escala para que las escamas tengan el tamaño de las del marco
        scale = W / 2400
        tex = Image.fromarray(croc.astype(np.uint8))
        tex = tex.resize((round(tex.width * scale), round(tex.height * scale)), Image.LANCZOS)
        tiled = Image.new("RGB", (w, h))
        for yy in range(0, h, tex.height):
            for xx in range(0, w, tex.width):
                tiled.paste(tex, (xx, yy))
        panel = np.asarray(tiled).astype(float)
        panel = panel / panel.reshape(-1, 3).mean(0) * base[:t, :].reshape(-1, 3).mean(0)  # mismo tono que el marco
        outer = base.copy()
        outer[t:t + h, l:l + w] = shade(panel) * 1.02
        Image.fromarray(outer.clip(0, 255).astype(np.uint8)).save(f"public/cases/case-{n}-lid-outer.jpg", quality=88, optimize=True)
    print(n, "listo")
