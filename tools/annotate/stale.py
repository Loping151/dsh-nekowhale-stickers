"""List stickers whose knowledge entry is missing or was written for an older version of the art.

usage: python3 -I stale.py MANIFEST.json META.json [SHEETS_DIR]
Prints one line per sticker: `<reason> <id>`; with SHEETS_DIR, prints contact sheet paths instead,
ready to be used as an annotation batch list (see PROMPT.md).
"""
import json
import sys


def main(manifest_path, meta_path, sheets=None):
    meta = json.load(open(meta_path, encoding="utf-8"))
    packs = {p["key"] for p in meta["packs"]}
    known = {s["id"]: s.get("hash") for s in meta["stickers"]}
    for it in json.load(open(manifest_path, encoding="utf-8"))["items"]:
        if it["pack"] not in packs:
            continue
        reason = "new" if it["id"] not in known else "changed" if known[it["id"]] != it["hash"] else None
        if reason:
            print(f"{sheets}/{it['id']}.jpg" if sheets else f"{reason} {it['id']}")


if __name__ == "__main__":
    main(*sys.argv[1:])
