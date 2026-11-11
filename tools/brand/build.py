#!/usr/bin/env python3
"""Build the brand assets: the mark, the favicon set, the wordmark and the og
image candidates.

  python3 tools/brand/build.py mark            docs/assets/{favicon.svg, favicon-32.png,
                                               apple-touch-icon.png, wordmark.svg}
  python3 tools/brand/build.py og [a b b2 c]   out/brand/og-<v>.jpg, 1200x630, under 200 KB
  python3 tools/brand/build.py install <v>     copy out/brand/og-<v>.jpg to docs/assets/og.jpg

The og candidates (docs/assets/og.jpg is c):
  a   drawing sheet: an aerial frame with the design line, chainage stakes
      and a title block
  b   film frame: the hairpin on the seed-7 viaduct, letterboxed 2.39:1
  b2  film frame: the same viaduct across the valley
  c   the road profile as the HUD draws it, through the eleven worlds

Frames are rendered by the game itself (tools/brand/capture.html in headless
Chrome), graded here with PIL so the world goes quiet and the car keeps its
own orange, then laid out in HTML and rendered at 2x. Needs Chrome, Pillow,
fontTools, rsvg-convert, and the fonts Adwaita Sans, Adwaita Mono, Noto Sans
CJK SC and Noto Serif CJK SC.
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from base64 import b64decode
from html import unescape

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WORK = os.path.join(ROOT, 'out', 'brand')
ASSETS = os.path.join(ROOT, 'docs', 'assets')
CHROME = os.environ.get('CHROME') or ('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
                                      if sys.platform == 'darwin' else '/usr/bin/google-chrome-stable')
PORT = 8179

INK, DARK, ACCENT = '#ece9e2', '#14171c', '#ff6a3d'
QUOTE = '道行之而成。'
SOURCE = '《庄子·齐物论》'
WORLDS = ['山间', '丘陵', '河谷', '沿海', '沙漠', '城市', '太空', '地底', '地狱', '天堂', '深海']

# The mark: the HUD's road profile reduced to one stroke, two rises with a
# level stretch between, and the car as the one orange dot on it.
MARK_ROAD = 'M3 26C9 26 9 18 16 18S23 10 29 10'
# On the tile the same road is centred and runs in and out past the edges.
TILE_ROAD = 'M-2 24H3C9 24 9 16 16 16S23 8 29 8H34'

SHOTS = {
    'a': 'seed=7&s=6700&run=600&cam=drone&w=2400&h=1260',
    'b': 'seed=7&s=7250&run=600&rig=custom&off=8,30,180&look=0,-4,0&fov=22&w=2400&h=1004',
    'b2': 'seed=7&s=7250&run=600&rig=custom&off=110,24,-30&look=0,-8,40&fov=30&w=2400&h=1004',
}


def env():
    e = dict(os.environ)
    e.pop('DISPLAY', None)  # headless WebGL fails on Linux while DISPLAY is set
    return e


def chrome(args, timeout):
    prof = tempfile.mkdtemp(prefix='continuum-brand-')
    try:
        return subprocess.run([CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                               '--user-data-dir=' + prof, *args], env=env(), stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=timeout).stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def font(family):
    return subprocess.run(['fc-match', '-f', '%{file}', family], capture_output=True, text=True, check=True).stdout


# ------------------------------------------------------------------ mark, favicon, wordmark

def tile(rx):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2027"/><stop offset="1" stop-color="#0f1216"/></linearGradient>
<clipPath id="c"><rect width="32" height="32" rx="{rx}"/></clipPath>
<mask id="m"><rect width="32" height="32" fill="#fff"/><circle cx="16" cy="16" r="4.9"/></mask></defs>
<rect width="32" height="32" rx="{rx}" fill="url(#g)"/>
<g clip-path="url(#c)"><path d="{TILE_ROAD}" fill="none" stroke="{INK}" stroke-width="3.2" mask="url(#m)"/></g>
<circle cx="16" cy="16" r="3.5" fill="{ACCENT}"/>
</svg>
'''


def outline(tt, gs, text, size, x, baseline, tracking):
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    s = size / tt['head'].unitsPerEm
    cmap = tt.getBestCmap()
    out = []
    for i, ch in enumerate(text):
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs)
        g.draw(TransformPen(pen, (s, 0, 0, -s, x, baseline)))
        out.append(pen.getCommands())
        x += g.width * s + (tracking * size if i < len(text) - 1 else 0)
    return ' '.join(out), x


def wordmark():
    from fontTools.ttLib import TTCollection, TTFont
    W = 40.0  # CONTINUUM; everything else is sized from it, as in the page's #brand
    lat = TTFont(font('Adwaita Sans'))
    lgs = lat.getGlyphSet(location={'wght': 500, 'opsz': 20})
    cjk = next(f for f in TTCollection(font('Noto Sans CJK SC')).fonts if 'SC' in f['name'].getDebugName(1)
               and 'Mono' not in f['name'].getDebugName(1))
    cap = lat['OS/2'].sCapHeight / lat['head'].unitsPerEm * W
    m, pad = 1.65 * W, 2.0
    base = pad + m / 2 + cap / 2  # caps centred on the mark
    word, x1 = outline(lat, lgs, 'CONTINUUM', W, pad + m + 0.69 * W, base, 0.34)
    zh, x2 = outline(cjk, cjk.getGlyphSet(), '无限遛弯', 0.87 * W, x1 + 0.62 * W, base + 0.03 * W, 0.18)
    width, height, k = x2 + pad, m + 2 * pad, m / 32
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {height:.1f}" width="{width:.0f}" height="{height:.0f}" role="img" aria-label="Continuum 无限遛弯">
<style>.ink{{fill:{INK}}}.road{{stroke:{INK}}}.dim{{fill:{INK};fill-opacity:.56}}
@media (prefers-color-scheme: light){{.ink{{fill:{DARK}}}.road{{stroke:{DARK}}}.dim{{fill:{DARK};fill-opacity:.62}}}}</style>
<defs><mask id="gap" maskUnits="userSpaceOnUse" x="-4" y="-4" width="40" height="40"><rect x="-4" y="-4" width="40" height="40" fill="#fff"/><circle cx="16" cy="18" r="4.1"/></mask></defs>
<g transform="translate({pad} {pad}) scale({k:.4f})" mask="url(#gap)"><path class="road" d="{MARK_ROAD}" fill="none" stroke-width="2.6" stroke-linecap="round"/></g>
<circle cx="{pad + 16 * k:.2f}" cy="{pad + 18 * k:.2f}" r="{3.3 * k:.2f}" fill="{ACCENT}"/>
<path class="ink" d="{word}"/>
<path class="dim" d="{zh}"/>
</svg>
'''


def build_mark():
    os.makedirs(WORK, exist_ok=True)
    fav = os.path.join(ASSETS, 'favicon.svg')
    open(fav, 'w').write(tile(7))
    touch = os.path.join(WORK, 'apple-touch-icon.svg')  # iOS rounds the corners itself
    open(touch, 'w').write(tile(0))
    subprocess.run(['rsvg-convert', '-w', '32', '-h', '32', '-o', os.path.join(ASSETS, 'favicon-32.png'), fav], check=True)
    subprocess.run(['rsvg-convert', '-w', '180', '-h', '180', '-o', os.path.join(ASSETS, 'apple-touch-icon.png'), touch], check=True)
    open(os.path.join(ASSETS, 'wordmark.svg'), 'w').write(wordmark())
    print('mark: favicon.svg favicon-32.png apple-touch-icon.png wordmark.svg')


# ------------------------------------------------------------------ frames

def serve():
    p = subprocess.Popen(['node', os.path.join(ROOT, 'tools', 'serve.mjs'), str(PORT), ROOT],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{PORT}/', timeout=1)
            return p
        except OSError:
            time.sleep(0.1)
    p.kill()
    raise SystemExit('server did not start')


def capture(name):
    dom = chrome(['--enable-unsafe-swiftshader', '--window-size=1280,720', '--virtual-time-budget=240000',
                  '--dump-dom', f'http://127.0.0.1:{PORT}/tools/brand/capture.html?{SHOTS[name]}'], timeout=600)
    get = lambda i: (m := re.search(f'<script type="text/plain" id="{i}">(.*?)</script>', dom, re.S)) and m.group(1)
    if not get('frame'):
        raise SystemExit(f'capture {name} failed: {(get("err") or dom[-400:])[:600]}')
    open(os.path.join(WORK, f'frame-{name}.png'), 'wb').write(b64decode(get('frame').split(',', 1)[1]))
    meta = json.loads(unescape(get('meta')))
    json.dump(meta, open(os.path.join(WORK, f'frame-{name}.json'), 'w'))
    print(f'frame {name}: {meta["W"]}x{meta["H"]} at K{int(meta["sCar"]) // 1000}+{int(meta["sCar"]) % 1000:03d}, {meta["kmh"]} km/h')


def car_key(img, car, radius):
    """The car's own orange (body, thrusters), only near the car."""
    h, s, v = img.convert('HSV').split()
    m = ImageChops.multiply(ImageChops.multiply(h.point(lambda x: 255 if x <= 22 or x >= 246 else 0),
                                                s.point(lambda x: 255 if x > 105 else 0)),
                            v.point(lambda x: 255 if x > 45 else 0))
    win = Image.new('L', img.size, 0)
    x, y = int(car[0]), int(car[1])
    win.paste(255, (max(0, x - radius), max(0, y - radius), min(img.width, x + radius), min(img.height, y + radius)))
    return ImageChops.multiply(m, win).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2))


def grade(img, car, sat, bright, contrast, cool, vignette, radius):
    """Quiet the world down and cool it a touch; the car keeps its colour."""
    g = ImageEnhance.Brightness(ImageEnhance.Contrast(ImageEnhance.Color(img).enhance(sat)).enhance(contrast)).enhance(bright)
    g = Image.blend(g, ImageChops.multiply(g, Image.new('RGB', img.size, (196, 212, 228))), cool)
    g = Image.composite(ImageEnhance.Contrast(img).enhance(1.04), g, car_key(img, car, radius))
    r = Image.radial_gradient('L').resize(img.size, Image.BICUBIC)
    r = r.point(lambda x: int(min(255, max(0, (x - 120) * 1.6)) * vignette))
    return Image.composite(ImageEnhance.Brightness(g).enhance(0.55), g, r)


# ------------------------------------------------------------------ layout

HEAD = '''<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root{--ink:#ece9e2;--dim:rgba(236,233,226,.56);--faint:rgba(236,233,226,.32);--accent:#ff6a3d;--bg:#0b0e12}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg)}
#og{position:absolute;left:0;top:0;width:1200px;height:630px;overflow:hidden;background:var(--bg);color:var(--ink);
 font-family:"Adwaita Sans","Noto Sans CJK SC",sans-serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.photo{position:absolute;left:0;width:1200px}
svg.over{position:absolute;left:0;top:0;width:1200px;height:630px;overflow:visible}
.lockup{position:absolute}
.lockup .row{display:flex;align-items:center;white-space:nowrap}
.mark{width:var(--mark);height:var(--mark);overflow:visible;flex:none;margin-right:var(--gap)}
.mark path{fill:none;stroke:var(--ink);stroke-width:2.6;stroke-linecap:round}
.mark circle{fill:var(--accent);stroke:var(--bg);stroke-width:1.4;paint-order:stroke}
.word{font-size:var(--word);font-weight:500;letter-spacing:.34em;line-height:1}
.zh{font:400 var(--zh)/1 "Noto Sans CJK SC";letter-spacing:.18em;color:var(--dim);margin-left:calc(var(--word) * .62)}
.row2{display:flex;align-items:baseline;white-space:nowrap}
.q{font:500 var(--q)/1 "Noto Serif CJK SC";color:#d9d5cc}
.src{font:400 var(--src)/1 "Noto Sans CJK SC";color:var(--faint);letter-spacing:.1em}
.mono,svg text{font-family:"Adwaita Mono",monospace}
</style>'''

# The quote sits under the wordmark: from the C to the last M, and the source
# starts where 无限遛弯 starts.
FIT = '''<script>
for (const L of document.querySelectorAll('.lockup')) {
  const word = L.querySelector('.word'), zh = L.querySelector('.zh');
  const q = L.querySelector('.q'), src = L.querySelector('.src'), row2 = L.querySelector('.row2');
  const lsW = parseFloat(getComputedStyle(word).letterSpacing);
  word.style.marginRight = -lsW + 'px';
  zh.style.marginRight = -parseFloat(getComputedStyle(zh).letterSpacing) + 'px';
  const base = L.getBoundingClientRect().left;
  const wr = word.getBoundingClientRect(), zr = zh.getBoundingClientRect();
  const wordW = wr.width - lsW;
  q.style.letterSpacing = '0px';
  const ls = (wordW - q.getBoundingClientRect().width) / ([...q.textContent].length - 1);
  q.style.letterSpacing = ls + 'px';
  q.style.marginRight = -ls + 'px';
  q.style.marginLeft = (wr.left - base) + 'px';
  src.style.marginLeft = (zr.left - wr.left - wordW) + 'px';
  row2.style.marginTop = getComputedStyle(L).getPropertyValue('--lead');
  if (L.dataset.mid) L.style.top = (Number(L.dataset.mid) - L.getBoundingClientRect().height / 2) + 'px';
}
</script>'''


def lockup(cls, mark, word, zh, quote, src, mid=None):
    m = f' data-mid="{mid}"' if mid is not None else ''
    return f'''<div class="lockup {cls}"{m} style="--mark:{mark}px;--word:{word}px;--zh:{zh}px;--q:{quote}px;--src:{src}px;--gap:{round(mark * 0.42)}px">
<div class="row"><svg class="mark" viewBox="0 0 32 32"><path d="{MARK_ROAD}"/><circle cx="16" cy="18" r="3.3"/></svg><span class="word">CONTINUUM</span><span class="zh">无限遛弯</span></div>
<div class="row2"><span class="q">{QUOTE}</span><span class="src">{SOURCE}</span></div>
</div>'''


def chainage(s):
    return 'K%d+%03d' % divmod(int(round(s)), 1000)


def render(name, body):
    html = os.path.join(WORK, f'og-{name}.html')
    open(html, 'w').write(HEAD + '</head><body><div id="og">' + body + '</div>' + FIT + '</body></html>')
    png = os.path.join(WORK, f'og-{name}@2x.png')
    chrome(['--force-device-scale-factor=2', '--window-size=1200,630', '--virtual-time-budget=4000',
            '--screenshot=' + png, 'file://' + html], timeout=120)
    img = Image.open(png).convert('RGB').resize((1200, 630), Image.LANCZOS)
    path = os.path.join(WORK, f'og-{name}.jpg')
    for q in range(90, 50, -2):
        img.save(path, 'JPEG', quality=q, optimize=True, progressive=True, subsampling=0 if q >= 86 else 2)
        if os.path.getsize(path) <= 200_000:
            break
    print(f'og {name}: {path} q{q} {os.path.getsize(path) // 1024} KB')


def frame(name, **look):
    img = Image.open(os.path.join(WORK, f'frame-{name}.png')).convert('RGB')
    meta = json.load(open(os.path.join(WORK, f'frame-{name}.json')))
    grade(img, meta['carPx'], **look).save(os.path.join(WORK, f'graded-{name}.png'))
    return meta


def og_a():
    meta = frame('a', sat=0.36, bright=0.86, contrast=1.06, cool=0.32, vignette=0.45, radius=70)
    P = lambda p: (p[0] / 2, p[1] / 2)
    TB = (782, 498, 1182, 612)  # the title block, in the border's corner
    in_tb = lambda x, y, pad=10: TB[0] - pad < x < TB[2] + pad and TB[1] - pad < y < TB[3] + pad

    # The design line: the centre line, dash-dot as on a drawing.
    runs, cur = [], []
    for _, p in meta['line']:
        if p is None:
            runs, cur = runs + ([cur] if len(cur) > 1 else []), []
            continue
        cur.append(P(p))
    if len(cur) > 1:
        runs.append(cur)
    line = ''.join('<polyline points="%s"/>' % ' '.join('%.1f,%.1f' % q for q in r) for r in runs)

    cx, cy = P(meta['carPx'])
    ticks, labels, placed = [], [], [(cx, cy)]
    for s, p, p2 in meta['marks']:
        if p is None or p2 is None:
            continue
        (x, y), (x2, y2) = P(p), P(p2)
        if not (30 < x < 1170 and 30 < y < 600) or in_tb(x, y):
            continue
        d = math.hypot(x2 - x, y2 - y) or 1
        nx, ny = -(y2 - y) / d, (x2 - x) / d
        if ny > 0:  # stakes are labelled on the upper side of the road
            nx, ny = -nx, -ny
        ticks.append('M%.1f %.1fL%.1f %.1f' % (x - nx * 7, y - ny * 7, x + nx * 7, y + ny * 7))
        lx, ly = x + nx * 15, y + ny * 15
        if any(math.hypot(lx - a, ly - b) < 64 for a, b in placed) or in_tb(lx, ly, 40):
            continue
        placed.append((lx, ly))
        labels.append(f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="{"start" if nx >= -0.2 else "end"}" dominant-baseline="middle">{chainage(s)}</text>')
    here = chainage(meta['sCar'])
    zone = ''.join(f'M{x} 18.5v6M{x} 611.5v-6' for x in range(100, 1200, 100)) + \
        ''.join(f'M18.5 {y}h6M1181.5 {y}h-6' for y in range(100, 630, 100))
    css = '''<style>
.design polyline{fill:none;stroke:rgba(244,242,236,.88);stroke-width:1.1;stroke-dasharray:16 4 2.5 4}
.ticks,.ring,.lead{fill:none;stroke:rgba(244,242,236,.92);stroke-width:1}
.lbl text{font-size:10.5px;fill:rgba(244,242,236,.86);letter-spacing:.02em;paint-order:stroke;stroke:rgba(11,14,18,.55);stroke-width:2.4px}
.frame,.zone{fill:none;stroke:rgba(236,233,226,.58);stroke-width:1}
.here{font-size:12.5px;fill:#f4f2ec;paint-order:stroke;stroke:rgba(11,14,18,.5);stroke-width:2.4px}
.tb{position:absolute;display:flex;background:rgba(11,14,18,.8);backdrop-filter:blur(8px);
 border-left:1px solid rgba(236,233,226,.6);border-top:1px solid rgba(236,233,226,.6)}
.tb .main{flex:1;position:relative;border-right:1px solid rgba(236,233,226,.35)}
.tb .side{width:104px;display:flex;flex-direction:column}
.tb .cell{flex:1;position:relative;display:flex;align-items:center;justify-content:center}
.tb .cell + .cell{border-top:1px solid rgba(236,233,226,.35)}
.tb i{position:absolute;left:7px;top:5px;font:400 9px/1 "Noto Sans CJK SC";font-style:normal;color:var(--faint);letter-spacing:.1em}
.tb b{font-weight:400;font-size:15px;color:var(--ink);margin-top:6px}
.tb b.mono{font-size:12.5px}
.l-a{left:20px;top:22px;--lead:14px}
</style>'''
    render('a', css + f'''<img class="photo" style="top:0;height:630px" src="file://{WORK}/graded-a.png">
<svg class="over" viewBox="0 0 1200 630">
<defs><clipPath id="inner"><rect x="19" y="19" width="1162" height="592"/></clipPath></defs>
<g clip-path="url(#inner)"><g class="design">{line}</g><path class="ticks" d="{''.join(ticks)}"/><g class="lbl">{''.join(labels)}</g></g>
<circle cx="{cx:.1f}" cy="{cy:.1f}" r="13" class="ring"/>
<path class="lead" d="M{cx + 9.2:.1f} {cy - 9.2:.1f}L{cx + 34:.1f} {cy - 34:.1f}H{cx + 96:.1f}"/>
<text x="{cx + 38:.1f}" y="{cy - 40:.1f}" class="here">{here}</text>
<rect x="18.5" y="18.5" width="1163" height="593" class="frame"/><path class="zone" d="{zone}"/>
</svg>
<div class="tb" style="left:{TB[0]}px;top:{TB[1]}px;width:{TB[2] - TB[0]}px;height:{TB[3] - TB[1]}px">
<div class="main">{lockup('l-a', 24, 14, 12.5, 18, 10)}</div>
<div class="side"><div class="cell"><i>里程</i><b class="mono">{here}</b></div><div class="cell"><i>纵坡</i><b class="mono">{meta['grade']:+.1f}%</b></div></div>
</div>''')


def og_b(name):
    meta = frame(name, sat=0.6, bright=0.95, contrast=1.1, cool=0.22, vignette=0.4, radius=90)
    css = '''<style>
.bar{position:absolute;left:0;width:1200px;height:64px;background:var(--bg)}
.l-b{left:44px}.l-b .row2{display:none}
.cite{position:absolute;right:44px;top:598px;transform:translateY(-50%);display:flex;align-items:baseline;gap:14px;white-space:nowrap}
.cite .q{font-size:17px;letter-spacing:.32em;margin-right:-.32em}
.cite .src{font-size:10.5px}
.tc{position:absolute;right:44px;top:32px;transform:translateY(-50%);font-size:10.5px;color:var(--faint);letter-spacing:.08em}
</style>'''
    render(name, css + f'''<div class="bar" style="top:0"></div><div class="bar" style="top:566px"></div>
<img class="photo" style="top:64px;height:502px" src="file://{WORK}/graded-{name}.png">
{lockup('l-b', 21, 12.5, 11.5, 16, 10, mid=598)}
<div class="cite"><span class="q">{QUOTE}</span><span class="src">{SOURCE}</span></div>
<div class="tc mono">{chainage(meta['sCar'])}</div>''')


def og_c():
    rows = json.load(open(os.path.join(WORK, 'profile.json')))  # [s, y, ground, kind, hairpin]
    BRIDGE, TUNNEL, S1 = 1, 2, 12000.0
    X = lambda s: s / S1 * 1200
    ys = [r[1] for r in rows]
    lo, hi = min(ys) - 26, max(ys) + 16
    top, bottom = 292, 526
    Y = lambda v: top + (hi - v) / (hi - lo) * (bottom - top)
    sCar = 720.0  # the dot sits on the wordmark's left edge

    g = [(X(r[0]), min(bottom, max(120, Y(r[2])))) for r in rows]
    fill = f'M{g[0][0]:.1f} {bottom} ' + ' '.join('L%.1f %.1f' % p for p in g) + f' L{g[-1][0]:.1f} {bottom} Z'
    gl, pen = [], False
    for r in rows:
        y = Y(r[2])
        if not 120 <= y <= bottom:
            pen = False
            continue
        gl.append(('L' if pen else 'M') + '%.1f %.1f' % (X(r[0]), y))
        pen = True
    piers = ''.join('M%.1f %.1fV%.1f' % (X(r[0]), Y(r[1]) + 2, min(bottom, Y(r[2])))
                    for r in rows if r[3] == BRIDGE and int(r[0]) % 48 == 0)
    # One path per run, so a tunnel's dashes carry on instead of restarting at every sample.
    solid, dashed, cur, curT = [], [], [], None
    for a, b in zip(rows, rows[1:]):
        t = a[3] == TUNNEL and b[3] == TUNNEL
        if t != curT and cur:
            (dashed if curT else solid).append('M' + 'L'.join(cur))
            cur = []
        if not cur:
            cur.append('%.1f %.1f' % (X(a[0]), Y(a[1])))
        cur.append('%.1f %.1f' % (X(b[0]), Y(b[1])))
        curT = t
    if cur:
        (dashed if curT else solid).append('M' + 'L'.join(cur))
    hp, inhp = [], False
    for r in rows:
        if r[4] and not inhp:
            hp.append('M%.1f %.1fv-5' % (X(r[0]), Y(r[1]) - 4))
        inhp = bool(r[4])

    # Long structures, dimensioned above the line as the HUD does.
    runs, cur = [], None
    for r in rows:
        if r[3] in (BRIDGE, TUNNEL) and cur and cur[0] == r[3] and r[0] - cur[2] <= 8:
            cur[2] = r[0]
        elif r[3] in (BRIDGE, TUNNEL):
            runs += [cur] if cur else []
            cur = [r[3], r[0], r[0]]
        elif cur:
            runs, cur = runs + [cur], None
    runs += [cur] if cur else []
    dims = []
    for kind, a, b in runs:
        xa, xb = X(a), X(b + 8)
        if b - a < 300 or xa < 60 or xb > 1110:
            continue
        yd = min(Y(rr[1]) for rr in rows if a - 200 <= rr[0] <= b + 200) - 30
        label = ('隧道' if kind == TUNNEL else '桥') + f' {int(round((b + 8 - a) / 10) * 10)} m'
        dims.append(f'<g class="dim"><path d="M{xa:.1f} {yd - 4:.1f}v8M{xb:.1f} {yd - 4:.1f}v8M{xa:.1f} {yd:.1f}H{xb:.1f}"/>'
                    f'<text x="{(xa + xb) / 2:.1f}" y="{yd - 8:.1f}" text-anchor="middle">{label}</text></g>')

    L = S1 / len(WORLDS)
    gates = ''.join('M%.1f %dv7' % (X(i * L), bottom + 16) for i in range(1, len(WORLDS)))
    names = ''.join(f'<text x="{X((i + 0.5) * L):.1f}" y="{bottom + 44}" class="w{" now" if i == 0 else ""}" text-anchor="middle">{w}</text>'
                    for i, w in enumerate(WORLDS))
    xc = X(sCar)
    yc = next(Y(r[1]) for r in rows if r[0] >= sCar)

    def layer(alpha, clip):  # the road behind the car faded, the road ahead full, as in the HUD
        return f'''<g clip-path="url(#{clip})" style="--a:{alpha}">
<g mask="url(#sky)"><path d="{fill}" fill="url(#gf)" opacity="{alpha}"/><path d="{''.join(gl)}" class="ground"/></g>
<path d="{piers}" class="piers"/><path d="{''.join(solid)}" class="grade"/><path d="{''.join(dashed)}" class="grade tun"/><path d="{''.join(hp)}" class="hp"/>
</g>'''

    css = '''<style>
#og{background:radial-gradient(900px 520px at 26% 18%, #141922 0%, #0d1015 55%, #0b0e12 100%)}
.grain{position:absolute;inset:0;opacity:.06;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.ground{fill:none;stroke:rgba(233,230,223,calc(.32 * var(--a)));stroke-width:1}
.piers{fill:none;stroke:rgba(233,230,223,calc(.22 * var(--a)));stroke-width:1}
.grade{fill:none;stroke:rgba(245,243,238,calc(.92 * var(--a)));stroke-width:1.8;stroke-linejoin:round}
.grade.tun{stroke:rgba(245,243,238,calc(.62 * var(--a)));stroke-dasharray:4 4}
.hp{fill:none;stroke:rgba(245,243,238,calc(.5 * var(--a)));stroke-width:1}
.dim path{fill:none;stroke:rgba(233,230,223,.42);stroke-width:1}
.dim text{font:500 11px "Noto Sans CJK SC";fill:rgba(233,230,223,.72);letter-spacing:.06em}
.gates{fill:none;stroke:rgba(233,230,223,.3);stroke-width:1}
text.w{font:400 13px "Noto Sans CJK SC";fill:rgba(233,230,223,.34);letter-spacing:.2em}
text.w.now{fill:rgba(236,233,226,.9)}
.l-c{left:72px;top:84px;--lead:22px}
</style>'''
    render('c', css + f'''<div class="grain"></div>
<svg class="over" viewBox="0 0 1200 630">
<defs>
<linearGradient id="gf" x1="0" y1="{top - 4}" x2="0" y2="{bottom}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#e9e6df" stop-opacity=".1"/><stop offset=".18" stop-color="#e9e6df" stop-opacity=".14"/><stop offset="1" stop-color="#e9e6df" stop-opacity=".02"/></linearGradient>
<linearGradient id="skyg" x1="0" y1="170" x2="0" y2="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
<mask id="sky"><rect width="1200" height="630" fill="url(#skyg)"/></mask>
<linearGradient id="fade" x1="0" x2="1200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".035" stop-color="#fff"/><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="m"><rect width="1200" height="630" fill="url(#fade)"/></mask>
<clipPath id="past"><rect width="{xc:.1f}" height="630"/></clipPath>
<clipPath id="ahead"><rect x="{xc:.1f}" width="{1200 - xc:.1f}" height="630"/></clipPath>
</defs>
<g mask="url(#m)">{layer(0.42, 'past')}{layer(1, 'ahead')}</g>
{''.join(dims)}<path class="gates" d="{gates}"/>{names}
<path d="M{xc:.1f} {top - 6}V{bottom}" stroke="rgba(255,106,61,.28)" stroke-width="1"/>
<circle cx="{xc:.1f}" cy="{yc:.1f}" r="4.2" fill="#ff6a3d" stroke="rgba(12,14,18,.6)" stroke-width="1.4"/>
</svg>
{lockup('l-c', 38, 23, 20, 30, 13)}''')


def build_og(which):
    os.makedirs(WORK, exist_ok=True)
    need = [v for v in which if v in SHOTS]
    if need:
        server = serve()
        try:
            for v in need:
                capture(v)
        finally:
            server.kill()
    if 'c' in which:
        prof = subprocess.run(['node', os.path.join(ROOT, 'tools', 'brand', 'profile.mjs'), '7', '12'],
                              capture_output=True, text=True, check=True).stdout
        open(os.path.join(WORK, 'profile.json'), 'w').write(prof)
    for v in which:
        {'a': og_a, 'b': lambda: og_b('b'), 'b2': lambda: og_b('b2'), 'c': og_c}[v]()


if __name__ == '__main__':
    cmd, args = (sys.argv[1:2] or ['og'])[0], sys.argv[2:]
    if cmd == 'mark':
        build_mark()
    elif cmd == 'og':
        build_og(args or ['a', 'b', 'b2', 'c'])
    elif cmd == 'install':
        shutil.copyfile(os.path.join(WORK, f'og-{args[0]}.jpg'), os.path.join(ASSETS, 'og.jpg'))
        print('docs/assets/og.jpg <-', f'og-{args[0]}.jpg')
    else:
        raise SystemExit(__doc__)
