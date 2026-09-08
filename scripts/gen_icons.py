"""
Generates the favicon set, PWA icons, and the social preview image.

This is a local authoring tool, not part of the site build, the images it
writes are committed to the repo, so CI never needs Pillow installed. Run it
again only when the mark itself changes:

    python scripts/gen_icons.py

The mark is the same idea as the wordmark in the header: three shelves with
boxes sitting on them, lit warm from above.
"""

from __future__ import annotations

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - developer tooling
    sys.exit("This script needs Pillow:  pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "assets", "icons")

INK = (22, 20, 27)
INK_RAISED = (30, 27, 38)
EDGE = (46, 40, 57)
LAMP = (255, 179, 71)
LAMP_DIM = (217, 135, 36)
PAPER = (237, 231, 240)
MUTED = (156, 147, 172)

FONT_DIRS = [
    r"C:\Windows\Fonts",
    "/System/Library/Fonts",
    "/usr/share/fonts/truetype/dejavu",
]
FONT_CANDIDATES = {
    "bold": ["seguisb.ttf", "segoeuib.ttf", "Helvetica.ttc", "DejaVuSans-Bold.ttf"],
    "regular": ["segoeui.ttf", "Helvetica.ttc", "DejaVuSans.ttf"],
    "mono": ["consola.ttf", "Menlo.ttc", "DejaVuSansMono.ttf"],
}


def load_font(kind: str, size: int):
    for name in FONT_CANDIDATES[kind]:
        for directory in FONT_DIRS:
            path = os.path.join(directory, name)
            if os.path.exists(path):
                try:
                    return ImageFont.truetype(path, size)
                except OSError:
                    continue
    return ImageFont.load_default()


def draw_mark(size: int, *, padding_ratio: float = 0.16, background: bool = True) -> Image.Image:
    """Three shelves, three boxes, warm light from above."""
    scale = 4  # supersample, then downscale for clean edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if background:
        radius = int(s * 0.19)
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=INK)
        # A soft lamp wash across the top. Drawn on its own layer and
        # composited: painting translucent rows straight onto the base would
        # replace the ink rather than blend with it.
        wash = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        wd = ImageDraw.Draw(wash)
        span = int(s * 0.38)
        for i in range(span):
            t = 1 - (i / span)
            alpha = int(30 * t * t)
            if alpha > 0:
                wd.rectangle([0, i, s, i + 1], fill=(*LAMP, alpha))
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
        img.alpha_composite(Image.composite(wash, Image.new("RGBA", (s, s), (0, 0, 0, 0)), mask))

    pad = int(s * padding_ratio)
    inner = s - pad * 2
    shelf_h = max(2, int(inner * 0.032))
    gap = inner / 3.0

    boxes = [
        (0.10, 0.34, LAMP),        # wide box, front left
        (0.46, 0.30, LAMP_DIM),    # second shelf, right of centre
        (0.20, 0.30, PAPER),       # bottom shelf
    ]

    for row in range(3):
        y = pad + int(gap * (row + 1)) - shelf_h
        # the box sits on top of the shelf line
        bx, bw, colour = boxes[row]
        box_w = int(inner * bw)
        box_h = int(gap * 0.52)
        x0 = pad + int(inner * bx)
        d.rounded_rectangle(
            [x0, y - box_h, x0 + box_w, y],
            radius=max(2, int(s * 0.012)),
            fill=colour,
        )
        d.rectangle([pad, y, pad + inner, y + shelf_h], fill=EDGE)

    return img.resize((size, size), Image.LANCZOS)


def write_png(img: Image.Image, name: str) -> None:
    path = os.path.join(OUT, name)
    img.save(path, "PNG", optimize=True)
    print(f"  {name:<28} {os.path.getsize(path):>7} bytes")


def build_maskable(size: int) -> Image.Image:
    """Maskable icons get cropped to a circle, so keep the mark well inside."""
    img = Image.new("RGBA", (size, size), INK)
    mark = draw_mark(size, padding_ratio=0.28, background=False)
    img.alpha_composite(mark)
    return img


def build_og() -> Image.Image:
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(img, "RGBA")

    # lamp wash from the top edge
    for i in range(int(h * 0.7)):
        t = 1 - (i / (h * 0.7))
        alpha = int(30 * t * t)
        if alpha > 0:
            d.rectangle([0, i, w, i + 1], fill=(*LAMP, alpha))

    d.rectangle([0, 0, w, 5], fill=LAMP)

    mark = draw_mark(104, background=False)
    img.paste(mark, (84, 74), mark)

    f_word = load_font("bold", 46)
    f_title = load_font("bold", 74)
    f_body = load_font("regular", 30)
    f_mono = load_font("mono", 24)

    d.text((208, 92), "ShelfLedger", font=f_word, fill=PAPER)

    d.text((84, 236), "Track your collection", font=f_title, fill=PAPER)
    d.text((84, 318), "without an account.", font=f_title, fill=LAMP)

    d.text(
        (84, 424),
        "Funko Pops, action figures, anime figures.",
        font=f_body,
        fill=MUTED,
    )

    # the promise, set like a ledger line
    d.line([(84, 496), (w - 84, 496)], fill=EDGE, width=2)
    d.text((84, 522), "NO ACCOUNT   ·   NO CLOUD   ·   NO TRACKING   ·   MIT LICENSED",
           font=f_mono, fill=LAMP)

    # a shelf of boxes along the right, echoing the mark
    x = 828
    for i, (bw, bh, colour) in enumerate(
        [(58, 96, LAMP), (46, 74, INK_RAISED), (66, 112, LAMP_DIM), (42, 66, INK_RAISED), (54, 88, PAPER)]
    ):
        y = 470
        d.rounded_rectangle([x, y - bh, x + bw, y], radius=5, fill=colour)
        if colour in (INK_RAISED,):
            d.rounded_rectangle([x, y - bh, x + bw, y], radius=5, outline=EDGE, width=2)
        x += bw + 14
    d.rectangle([820, 470, w - 62, 476], fill=EDGE)

    return img


def build_favicon_svg() -> str:
    """A crisp vector favicon; the .ico is only there for old browsers."""
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="ShelfLedger">
  <rect width="64" height="64" rx="12" fill="#16141B"/>
  <rect x="10" y="14" width="16" height="9" rx="1.5" fill="#FFB347"/>
  <rect x="10" y="23" width="44" height="2" fill="#2E2839"/>
  <rect x="30" y="29" width="14" height="8" rx="1.5" fill="#D98724"/>
  <rect x="10" y="37" width="44" height="2" fill="#2E2839"/>
  <rect x="14" y="43" width="14" height="8" rx="1.5" fill="#EDE7F0"/>
  <rect x="10" y="51" width="44" height="2" fill="#9C93AC"/>
</svg>
"""


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    print("icons ->", os.path.relpath(OUT, ROOT))

    write_png(draw_mark(192), "icon-192.png")
    write_png(draw_mark(512), "icon-512.png")
    write_png(build_maskable(512), "icon-maskable-512.png")
    write_png(draw_mark(180), "apple-touch-icon.png")
    write_png(build_og(), "og-image.png")

    svg_path = os.path.join(OUT, "favicon.svg")
    with open(svg_path, "w", encoding="utf-8") as fh:
        fh.write(build_favicon_svg())
    print(f"  {'favicon.svg':<28} {os.path.getsize(svg_path):>7} bytes")

    ico_path = os.path.join(OUT, "favicon.ico")
    draw_mark(64).save(ico_path, sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  {'favicon.ico':<28} {os.path.getsize(ico_path):>7} bytes")


if __name__ == "__main__":
    main()
