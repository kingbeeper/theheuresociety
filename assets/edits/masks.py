"""Aísla cada reloj de su foto sin modificar sus píxeles: solo calcula el canal alfa."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

W_DIR = '../../public/watches/'

def _poly(size, pts):
    m = Image.new('L', size, 0); ImageDraw.Draw(m).polygon(pts, fill=255); return np.asarray(m) > 0

def _circle(size, cx, cy, r):
    m = Image.new('L', size, 0); ImageDraw.Draw(m).ellipse((cx-r, cy-r, cx+r, cy+r), fill=255); return np.asarray(m) > 0

def _finish(img, m, erode=3, blur=1.0):
    lab, n = ndi.label(m); sizes = ndi.sum(m, lab, range(1, n+1)); m = lab == (1 + int(np.argmax(sizes)))
    m = ndi.binary_fill_holes(ndi.binary_closing(ndi.binary_fill_holes(m), iterations=4))
    a = Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.MinFilter(erode)).filter(ImageFilter.GaussianBlur(blur))
    out = img.convert('RGBA'); out.putalpha(a); return out

def daytona():
    img = Image.open(W_DIR + 'rolex-daytona-126519ln.jpg').convert('RGB'); W, H = img.size
    src = np.asarray(img).astype(float); S = np.asarray(img.convert('HSV')).astype(float)[..., 1]
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    ok = ((g - np.maximum(r, b)) <= 8) & (S < 80) & ((r - b) <= 35)
    P = lambda pts: _poly((W, H), pts)
    geo = (P([(234,0),(455,0),(500,300),(270,322)]) | P([(222,320),(270,290),(512,255),(556,258),(566,350),(205,470)])
         | P([(636,388),(660,368),(690,362),(760,470),(765,700),(700,720),(640,700)]) | P([(335,800),(660,760),(655,905),(350,900)])
         | P([(394,860),(645,850),(680,1125),(463,1140)]))
    # Borde pulido de la caja entre la 1 y las 2: se incluye entero (refleja la tarjeta)
    edge = P([(560,330),(578,345),(603,368),(628,392),(640,402),(645,440),(600,460),(555,420)])
    m = _circle((W, H), 445, 592, 252) | edge | (geo & ok)
    m = ndi.binary_opening(m, iterations=2)
    return _finish(img, m), (445, 592)

def royal_oak():
    img = Image.open(W_DIR + 'ap-royal-oak-chronograph-26240st.jpg').convert('RGB'); W, H = img.size
    rb = np.asarray(Image.open('ap-cutout.png').convert('RGBA'))[..., 3] > 110
    src = np.asarray(img).astype(float); S = np.asarray(img.convert('HSV')).astype(float)[..., 1]
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    skin = ((r - b) > 30) & (S > 55)
    geo = _poly((W, H), [(115,365),(425,285),(480,310),(550,430),(610,500),(690,500),(700,600),(770,640),(775,770),
                         (705,800),(705,835),(775,840),(775,915),(712,930),(715,1370),(705,1410),(450,1480),(430,1460),
                         (310,1180),(290,1140),(140,960),(95,900),(90,560),(110,540)])
    m = rb & geo
    m = ndi.binary_opening(m, iterations=2)
    out = _finish(img, m)
    a = np.asarray(out)[..., 3] * geo
    out.putalpha(Image.fromarray(a.astype(np.uint8)))
    return out, (405, 815)

def land_dweller():
    img = Image.open(W_DIR + 'rolex-land-dweller-127235.jpg').convert('RGB'); W, H = img.size
    rb = np.asarray(Image.open('ld-cutout.png').convert('RGBA'))[..., 3] > 110
    P = lambda pts: _poly((W, H), pts)
    geo = (P([(388,415),(776,415),(776,600),(812,612),(812,690),(868,805),(895,900),(895,1120),(890,1170),(850,1300),
              (797,1348),(795,1820),(389,1820),(387,1350),(355,1345),(300,1170),(300,825),(380,690),(388,690)])
         | _circle((W, H), 590, 1008, 330) | P([(885,945),(975,945),(975,1060),(885,1060)]))
    geo = ndi.binary_dilation(geo, iterations=4)
    m = rb & geo
    return _finish(img, m), (590, 1008)

if __name__ == '__main__':
    for name, fn in [('daytona', daytona), ('royal-oak', royal_oak), ('land-dweller', land_dweller)]:
        im, _ = fn()
        bg = Image.new('RGBA', im.size, (255, 0, 255, 255)); bg.alpha_composite(im)
        bg.convert('RGB').save(f'mask-{name}.jpg')
