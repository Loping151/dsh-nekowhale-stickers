"""Compose the README hero: generated background plate + real sticker frames + the Live2D portrait.
Only the plate is AI generated; every character pixel comes from the original art, so nothing can be mis-drawn.

usage: python3 -I hero.py BG.png PORTRAIT.png PACKS_DIR OUT.jpg
"""
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 2400, 1000
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_SC = 2  # face index of Simplified Chinese in the collection

# (pack/stem, frame, centre x, centre y, card size, rotation)
CARDS = [
    ("大肥鱼和GPT娘/TT02_比心", 10, 1130, 300, 300, -6),
    ("大肥鱼/3N05_摸鱼", 8, 1070, 710, 250, 5),
    ("大肥鱼/12N11_害羞", 6, 2210, 230, 240, 7),
    ("大肥鱼/5N05_吃瓜", 6, 2250, 640, 250, -5),
    ("大肥鱼和GPT娘/TT07_干杯", 12, 1950, 860, 210, 4),
    ("大肥鱼/16N01_超开心", 8, 1340, 880, 190, -8),
]


def fit_cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def shadow(layer, blur=18, offset=(0, 12), alpha=70):
    a = layer.getchannel("A").point(lambda v: v * alpha // 255)
    sh = Image.new("RGBA", layer.size, (40, 60, 110, 0))
    sh.putalpha(a)
    pad = blur * 3
    out = Image.new("RGBA", (layer.width + pad * 2, layer.height + pad * 2), (0, 0, 0, 0))
    out.alpha_composite(sh, (pad + offset[0], pad + offset[1]))
    return out.filter(ImageFilter.GaussianBlur(blur)), pad


def card(path, frame, size, rot):
    im = Image.open(path)
    im.seek(min(frame, im.n_frames - 1))
    art = im.convert("RGBA").resize((size - 28, size - 28), Image.LANCZOS)
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 9, fill=255)
    c.paste((255, 255, 255, 255), (0, 0), m)
    c.alpha_composite(art, (14, 14))
    return c.rotate(rot, resample=Image.BICUBIC, expand=True)


def paste_with_shadow(base, layer, cx, cy):
    sh, pad = shadow(layer)
    base.alpha_composite(sh, (cx - layer.width // 2 - pad, cy - layer.height // 2 - pad))
    base.alpha_composite(layer, (cx - layer.width // 2, cy - layer.height // 2))


def main(bg_path, portrait_path, packs, out):
    base = fit_cover(Image.open(bg_path).convert("RGBA"), W, H)
    # soft white veil behind the title so it reads on any plate
    veil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(veil).rounded_rectangle((70, 300, 980, 700), radius=60, fill=(255, 255, 255, 110))
    base.alpha_composite(veil.filter(ImageFilter.GaussianBlur(40)))

    for key, frame, cx, cy, size, rot in CARDS[:2]:
        paste_with_shadow(base, card(f"{packs}/{key}.gif", frame, size, rot), cx, cy)

    por = Image.open(portrait_path).convert("RGBA")
    ph = round(H * 0.97)
    por = por.resize((round(por.width * ph / por.height), ph), Image.LANCZOS)
    sh, pad = shadow(por, blur=24, offset=(0, 10), alpha=60)
    px, py = 1660 - por.width // 2, H - ph + 40
    base.alpha_composite(sh, (px - pad, py - pad))
    base.alpha_composite(por, (px, py))

    for key, frame, cx, cy, size, rot in CARDS[2:]:
        paste_with_shadow(base, card(f"{packs}/{key}.gif", frame, size, rot), cx, cy)

    d = ImageDraw.Draw(base)
    title = ImageFont.truetype(FONT, 132, index=FONT_SC)
    text = "大肥鱼\n哈基米表情包"
    l, t, r, b = d.multiline_textbbox((0, 0), text, font=title, spacing=36, stroke_width=7)
    d.multiline_text((120, (H - (b - t)) // 2 - t), text, font=title, spacing=36, fill=(32, 52, 110), stroke_width=7, stroke_fill=(255, 255, 255))
    base.convert("RGB").save(out, quality=88, optimize=True, progressive=True)


if __name__ == "__main__":
    main(*sys.argv[1:])
