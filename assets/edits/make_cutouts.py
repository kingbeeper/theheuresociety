"""Recortes normalizados para el estuche interactivo.
Lienzo 600x1200 transparente; la caja del reloj centrada; 1 mm = 9,3 px (un reloj
de 40 mm ocupa 372 px de ancho), así todos guardan su tamaño real entre sí."""
from PIL import Image
import masks

W, H = 600, 1200
PX_PER_MM = 9.3

# (función de máscara, ángulo para enderezar, radio de la caja en px del original, diámetro real en mm, nombre)
WATCHES = [
    (masks.daytona,      -11.0, 252, 40, "rolex-daytona-126519ln"),
    (masks.royal_oak,    -14.7, 292, 41, "ap-royal-oak-chronograph-26240st"),
    (masks.land_dweller,   0.0, 295, 40, "rolex-land-dweller-127235"),
]

for fn, angle, src_r, mm, name in WATCHES:
    img, (cx, cy) = fn()
    scale = (mm / 2 * PX_PER_MM) / src_r
    pad = 1200
    cv = Image.new("RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
    cv.paste(img, (pad, pad))
    c = (cx + pad, cy + pad)
    cv = cv.rotate(angle, resample=Image.BICUBIC, center=c)
    cv = cv.resize((round(cv.width * scale), round(cv.height * scale)), Image.LANCZOS)
    c = (c[0] * scale, c[1] * scale)
    left, top = round(c[0] - W / 2), round(c[1] - H / 2)
    out = cv.crop((left, top, left + W, top + H))
    out.save(f"../../public/watches/cutouts/{name}.png", optimize=True)
    print(name, out.getbbox())
