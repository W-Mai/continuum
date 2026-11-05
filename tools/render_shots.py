"""Headless Chrome turntable renderer for GLB assets, plus a standard-library
PNG blank-frame check. Drives tools/render.html; no third-party packages.
"""

import argparse
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

# Chrome writes the canvas at these sizes unless the window is tiny.
DEFAULT_VIEWS = ('hero34', 'front', 'rear34', 'side', 'top', 'low34')
CHROME_CANDIDATES = (
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
)

# A frame is blank unless at least this share of pixels is lit geometry.
MIN_SUBJECT_FRACTION = 0.01
BRIGHT_LUMA = 0.15
# Pixels within this distance of the background colour count as background.
BG_TOLERANCE = 3


# ------------------------------------------------------------------ PNG


def read_png(path):
    """Decode a non-interlaced 8-bit RGB/RGBA PNG into (w, h, channels, bytes).

    Only the subset Chrome emits, but every filter type is handled properly.
    """
    with open(path, 'rb') as fh:
        data = fh.read()

    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG: %s' % path)

    pos = 8
    idat = []
    width = height = depth = color_type = interlace = None
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        chunk = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if chunk == b'IHDR':
            width, height, depth, color_type, _, _, interlace = struct.unpack(
                '>IIBBBBB', payload[:13])
        elif chunk == b'IDAT':
            idat.append(payload)
        elif chunk == b'IEND':
            break

    if depth != 8:
        raise ValueError('unsupported PNG bit depth %s' % depth)
    if interlace:
        raise ValueError('interlaced PNG is not supported')
    if color_type not in (2, 6):
        raise ValueError('unsupported PNG color type %s' % color_type)

    channels = 3 if color_type == 2 else 4
    raw = zlib.decompress(b''.join(idat))
    stride = width * channels
    if len(raw) != (stride + 1) * height:
        raise ValueError('PNG payload size mismatch: %s' % path)

    out = bytearray(stride * height)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        filt = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if filt == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filt == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filt == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filt == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = prev[i]
                ul = prev[i - channels] if i >= channels else 0
                est = left + up - ul
                da, db, dc = abs(est - left), abs(est - up), abs(est - ul)
                if da <= db and da <= dc:
                    pred = left
                elif db <= dc:
                    pred = up
                else:
                    pred = ul
                line[i] = (line[i] + pred) & 0xFF
        elif filt != 0:
            raise ValueError('bad PNG filter type %s' % filt)
        out[y * stride:(y + 1) * stride] = line
        prev = line

    return width, height, channels, bytes(out)


def hex_to_rgb(text):
    text = (text or '').strip().lstrip('#')
    if len(text) != 6:
        return None
    try:
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def blank_stats(path, bg=None):
    """Measure how much of a rendered frame is lit content rather than void.

    `subject` is the share of pixels that differ from the background *and* are
    bright enough to be geometry, which is what the pass/fail decision uses.
    """
    width, height, channels, pixels = read_png(path)
    total = width * height
    bg = bg or (0x12, 0x14, 0x1A)

    bright = 0
    non_bg = 0
    subject = 0
    for i in range(0, len(pixels), channels):
        r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
        differs = (abs(r - bg[0]) > BG_TOLERANCE
                   or abs(g - bg[1]) > BG_TOLERANCE
                   or abs(b - bg[2]) > BG_TOLERANCE)
        # Rec. 709 luma on the sRGB values is enough for a "did it draw" test.
        lit = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0 > BRIGHT_LUMA
        non_bg += differs
        bright += lit
        # Luma alone would accept a light background, and background-diff alone
        # would accept a dark UI overlay; the subject needs both at once.
        subject += differs and lit

    return {
        'width': width,
        'height': height,
        'non_bg': non_bg / total,
        'bright': bright / total,
        'subject': subject / total,
        'blank': (subject / total) < MIN_SUBJECT_FRACTION,
    }


# ------------------------------------------------------------------ chrome


def find_chrome(explicit=None):
    if explicit:
        if not os.path.isfile(explicit):
            raise SystemExit('chrome not found: %s' % explicit)
        return explicit
    for path in CHROME_CANDIDATES:
        if os.path.isfile(path):
            return path
    found = shutil.which('google-chrome') or shutil.which('chromium')
    if found:
        return found
    raise SystemExit('no Chrome/Chromium binary found; pass --chrome PATH')


def render_url(page, model, view, width, height, wire, grid, bg, ppu):
    """Build the file:// URL for one view.

    `model` is an absolute path; Chrome resolves it against the page's file
    origin, and the renderer treats it as a plain filesystem path.
    """
    params = [
        'model=' + model,
        'view=' + view,
        'w=%d' % width,
        'h=%d' % height,
        'wire=%d' % (1 if wire else 0),
        'grid=%d' % (1 if grid else 0),
        'ppu=%s' % ppu,
    ]
    if bg:
        params.append('bg=' + bg.lstrip('#'))
    return 'file://%s?%s' % (page, '&'.join(params))


def chrome_args(chrome, url, width, height, budget_ms, extra):
    return [
        chrome,
        '--headless=new',
        # SwiftShader keeps WebGL2 available when there is no real GPU.
        '--disable-gpu',
        '--enable-unsafe-swiftshader',
        '--allow-file-access-from-files',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--window-size=%d,%d' % (width, height),
        '--virtual-time-budget=%d' % budget_ms,
    ] + extra + [url]


def read_title(chrome, url, width, height, budget_ms):
    """Run the page for --dump-dom and return its <title>, or None."""
    proc = subprocess.run(
        chrome_args(chrome, url, width, height, budget_ms, ['--dump-dom']),
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=180,
    )
    text = proc.stdout.decode('utf-8', 'replace')
    start = text.find('<title>')
    if start < 0:
        return None
    end = text.find('</title>', start)
    if end < 0:
        return None
    return text[start + len('<title>'):end].strip()


def screenshot(chrome, url, width, height, budget_ms, dest):
    proc = subprocess.run(
        chrome_args(chrome, url, width, height, budget_ms,
                    ['--screenshot=' + dest]),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180,
    )
    if proc.returncode != 0 or not os.path.isfile(dest):
        raise SystemExit('chrome screenshot failed for %s' % url)


# ------------------------------------------------------------------ main


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='Render a GLB to PNGs from several fixed viewpoints.')
    ap.add_argument('--model', required=True, help='path to the .glb file')
    ap.add_argument('--outdir', default='out/renders', help='output directory')
    ap.add_argument('--views', default=','.join(DEFAULT_VIEWS),
                    help='comma-separated view names (default: %(default)s)')
    ap.add_argument('--width', type=int, default=1600)
    ap.add_argument('--height', type=int, default=1000)
    ap.add_argument('--wire', action='store_true', help='overlay edge wireframe')
    ap.add_argument('--no-grid', dest='grid', action='store_false',
                    help='hide the ground grid')
    ap.add_argument('--bg', default='#12141a', help='background colour (hex)')
    ap.add_argument('--ppu', default='1', help='renderer pixel ratio')
    ap.add_argument('--budget', type=int, default=20000,
                    help='Chrome virtual time budget in ms')
    ap.add_argument('--chrome', default=None, help='path to Chrome binary')
    ap.add_argument('--check', action='store_true',
                    help='render hero34 only and assert the frame is not blank')
    args = ap.parse_args(argv)

    model = os.path.abspath(args.model)
    if not os.path.isfile(model):
        raise SystemExit('model not found: %s' % model)
    if args.bg and hex_to_rgb(args.bg) is None:
        raise SystemExit('bad --bg value: %s' % args.bg)

    page = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'render.html')
    if not os.path.isfile(page):
        raise SystemExit('render page missing: %s' % page)

    chrome = find_chrome(args.chrome)

    views = [v.strip() for v in args.views.split(',') if v.strip()]
    if args.check:
        views = ['hero34']
    unknown = [v for v in views if v not in DEFAULT_VIEWS]
    if unknown:
        raise SystemExit('unknown view(s): %s' % ', '.join(unknown))

    outdir = os.path.abspath(args.outdir)
    os.makedirs(outdir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(model))[0]

    failures = []
    for view in views:
        url = render_url(page, model, view, args.width, args.height,
                         args.wire, args.grid, args.bg, args.ppu)

        # Verify the page reports success before trusting its pixels; a failed
        # render still writes a PNG, it is just empty.
        title = read_title(chrome, url, args.width, args.height, args.budget)
        if title is None or not title.startswith('RENDER_DONE'):
            reason = title or 'page produced no title'
            print('[fail] %s: %s' % (view, reason), file=sys.stderr)
            failures.append(view)
            continue

        with tempfile.TemporaryDirectory() as tmp:
            shot = os.path.join(tmp, 'frame.png')
            screenshot(chrome, url, args.width, args.height, args.budget, shot)
            stats = blank_stats(shot, hex_to_rgb(args.bg))
            if stats['blank']:
                print('[fail] %s: blank frame (%.2f%% of pixels are lit geometry,'
                      ' need %.2f%%)'
                      % (view, stats['subject'] * 100, MIN_SUBJECT_FRACTION * 100),
                      file=sys.stderr)
                failures.append(view)
                continue
            dest = os.path.join(outdir, '%s_%s.png' % (stem, view))
            shutil.move(shot, dest)

        print('%s  %dx%d  non-background %.2f%%  bright %.2f%%  subject %.2f%%'
              % (os.path.basename(dest), stats['width'], stats['height'],
                 stats['non_bg'] * 100, stats['bright'] * 100,
                 stats['subject'] * 100))

    if failures:
        print('%d view(s) failed: %s' % (len(failures), ', '.join(failures)),
              file=sys.stderr)
        return 1
    print('ok: %d frame(s) in %s' % (len(views), outdir))
    return 0


if __name__ == '__main__':
    sys.exit(main())
