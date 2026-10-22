"""Merge per-sticker annotations (JSONL) with the site manifest into the hosted knowledge file.

usage: python3 -I build_meta.py MANIFEST.json OUT.json ANNOT.jsonl [ANNOT.jsonl ...]
Later files override earlier ones field by field (manual.jsonl last). Entries are stamped with the manifest hash of the GIF they describe.
"""
import json
import sys
from datetime import datetime, timezone

EMOTIONS = "开心 大笑 喜欢 害羞 得意 兴奋 惊讶 疑惑 思考 无语 难过 哭 生气 害怕 疲惫 赞同 拒绝 打招呼 感谢 道歉 卖萌 搞怪 嘲讽 安慰 其他".split()
KEYS = ["text", "emotion", "tags", "use", "desc", "meme", "dir", "en"]

PACKS = [
    {
        "key": "大肥鱼",
        "title": "大肥鱼",
        "desc": "拟人化的 DeepSeek 鲸鱼娘日常表情，单人。",
        "showcase": "https://kiriyuki.com/showcase?p=%E5%A4%A7%E8%82%A5%E9%B1%BC",
        "characters": [{"name": "大肥鱼", "look": "深蓝长发、呆毛、女仆头饰、蓝眼睛，DeepSeek 鲸鱼拟人"}],
    },
    {
        "key": "大肥鱼和GPT娘",
        "title": "大肥鱼和GPT娘",
        "desc": "大肥鱼与 GPT娘的双人互动表情，有方向：dir 字段写明谁对谁做。",
        "showcase": "https://kiriyuki.com/showcase?p=%E5%A4%A7%E8%82%A5%E9%B1%BC%E5%92%8CGPT%E5%A8%98",
        "characters": [
            {"name": "大肥鱼", "look": "深蓝长发、女仆头饰（DeepSeek）"},
            {"name": "GPT娘", "look": "白色角色：白发龙娘：龙角、OpenAI 标志发饰（ChatGPT）"},
        ],
    },
]

ATTRIBUTION = {
    "author": "可以叫我云大人",
    "links": [
        {"label": "Bilibili", "url": "https://space.bilibili.com/103739"},
        {"label": "kiriyuki.com", "url": "https://kiriyuki.com"},
    ],
    "text": "表情包作者：B站 可以叫我云大人（space.bilibili.com/103739），kiriyuki.com 制作，欢迎约原稿同款表情包！",
}


def main(manifest_path, out_path, *annot_paths):
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    packs = {p["key"] for p in PACKS}
    items = {it["id"]: it for it in manifest["items"] if it["pack"] in packs}
    ann = {}
    for p in annot_paths:
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line:
                row = json.loads(line)
                ann[row["id"]] = {**ann.get(row["id"], {}), **row}   # later files override field by field
    stickers, missing = [], []
    for sid, it in sorted(items.items(), key=lambda kv: (kv[1]["pack"], kv[1]["code"])):
        a = ann.get(sid)
        if a is None:
            missing.append(sid)
            continue
        entry = {"id": sid, "hash": it["hash"]}
        for k in KEYS:
            v = a.get(k, [] if k == "tags" else "")
            entry[k] = [t.strip() for t in v if t.strip()] if k == "tags" else str(v).strip()
        if entry["emotion"] not in EMOTIONS:
            entry["emotion"] = "其他"
        stickers.append(entry)
    meta = {
        "schema": "sticker-kit/1",
        "kit": "nekowhale",
        "version": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "attribution": ATTRIBUTION,
        "packs": PACKS,
        "emotions": EMOTIONS,
        "stickers": stickers,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"{len(stickers)} stickers written, {len(missing)} without annotation")
    for m in missing:
        print("  missing:", m)


if __name__ == "__main__":
    main(*sys.argv[1:])
