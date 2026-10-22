"""Tile the frames of an animated sticker into one labelled PNG so a vision model sees the whole motion.

usage: python3 -I contact_sheet.py OUT_DIR GIF [GIF ...]
Writes OUT_DIR/<stem>.jpg. Up to MAX_FRAMES frames are sampled uniformly (all of them if fewer).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageSequence

MAX_FRAMES = 12
CELL = 200          # px per frame tile
COLS = 4


def frames_of(path):
    im = Image.open(path)
    out, total_ms = [], 0
    for fr in ImageSequence.Iterator(im):
        total_ms += fr.info.get("duration", 100) or 100
        bg = Image.new("RGBA", fr.size, (236, 236, 236, 255))   # light grey shows transparent areas
        bg.alpha_composite(fr.convert("RGBA"))
        out.append(bg.convert("RGB"))
    return out, total_ms


def sheet(path, out_dir):
    frames, total_ms = frames_of(path)
    n = len(frames)
    idx = list(range(n)) if n <= MAX_FRAMES else [round(i * (n - 1) / (MAX_FRAMES - 1)) for i in range(MAX_FRAMES)]
    cols = min(COLS, len(idx))
    rows = -(-len(idx) // cols)
    head = 24
    img = Image.new("RGB", (cols * CELL, rows * CELL + head), "white")
    d = ImageDraw.Draw(img)
    d.text((6, 5), f"{Path(path).name}  frames={n}  duration={total_ms}ms  (left->right, top->bottom)", fill="black")
    for k, i in enumerate(idx):
        fr = frames[i].copy()
        fr.thumbnail((CELL - 8, CELL - 22))
        x, y = (k % cols) * CELL, (k // cols) * CELL + head
        img.paste(fr, (x + (CELL - fr.width) // 2, y + 18))
        d.text((x + 4, y + 3), f"#{i}", fill=(200, 0, 0))
    out = Path(out_dir) / (Path(path).stem + ".jpg")
    img.save(out, quality=85)
    return out


if __name__ == "__main__":
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in sys.argv[2:]:
        print(sheet(p, out_dir))
