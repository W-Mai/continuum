"""Check preview.html actually loads the model, without a human looking at it.

The page is opened in headless Chrome with a long virtual-time budget and the
resulting DOM is inspected: the HUD numbers must have been filled in from the
loaded geometry, and there must be no visible error panel. Exit code is non-zero
on failure so this can gate a build.
"""

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def dump_dom(budget_ms=12000, size=(1400, 900)):
    page = "file://" + os.path.join(ROOT, "preview.html")
    proc = subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu",
         "--enable-unsafe-swiftshader", "--allow-file-access-from-files",
         "--hide-scrollbars", "--window-size=%d,%d" % size,
         "--virtual-time-budget=%d" % budget_ms, "--dump-dom", page],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=180,
    )
    return proc.stdout.decode("utf-8", "replace")


def main():
    dom = dump_dom()

    problems = []

    if 'id="failmsg"' in dom:
        m = re.search(r'<pre id="failmsg">(.*?)</pre>', dom, re.S)
        msg = (m.group(1).strip() if m else "")
        if msg:
            problems.append("page reported a load failure: " + msg[:400])

    def field(fid):
        m = re.search(r'<dd id="%s"[^>]*>(.*?)</dd>' % fid, dom, re.S)
        return m.group(1).strip() if m else None

    width, height, tris = field("w"), field("h"), field("tris")

    for label, value in (("width", width), ("height", height), ("triangles", tris)):
        if value in (None, "", "—"):
            problems.append("%s was never populated (element missing or JS did not run)"
                            % label)

    if tris and tris not in ("", "—"):
        n = int(tris.replace(",", ""))
        if n < 10000:
            problems.append("triangle count %d looks like a partial load" % n)

    # the HUD reports the model's own bounding box in mm
    if width and width not in ("", "—"):
        w = int(width.replace(" mm", ""))
        if not (1700 <= w <= 1900):
            problems.append("model width %s mm outside the expected 1700-1900 mm" % w)
    if height and height not in ("", "—"):
        h = int(height.replace(" mm", ""))
        if not (1150 <= h <= 1400):
            problems.append("model height %s mm outside the expected 1150-1400 mm" % h)

    print("dom bytes: %d" % len(dom))
    print("width=%s height=%s triangles=%s" % (width, height, tris))
    if problems:
        print("\n%d problem(s):" % len(problems))
        for p in problems:
            print("  - " + p)
        return 1
    print("\npreview loads the model correctly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
