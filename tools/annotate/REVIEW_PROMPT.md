# Task: strict review of sticker annotations

Input: /tmp/dshsticker/annot/qa_in.jsonl, one JSON object per line (schema as in /tmp/dshsticker/tasks/annotate.md, read it).
Contact sheet for id P/S is /tmp/dshsticker/sheets/P/S.jpg . View the sheet for every entry you change or doubt.

Check two things:
1. `meme` must name a specific, well known reference: a named internet meme or catchphrase, a named work (anime,
   game, film, song), a named platform culture (e.g. Bilibili 一键三连). Generic actions or folk imagery are NOT memes
   (e.g. 猫咪挥爪, 扎小人的民俗意象, 加载转圈图标 unless it is a specific named meme). If not specific and certain, set "".
   If it is right but vague, make it precise and short, at most 40 chars, format: 梗名或作品名：一句说明.
2. Two-character pack 大肥鱼和GPT娘 (GPT娘 is the white / silver haired one with horns, 大肥鱼 is dark blue): verify
   `dir` and that `desc` and `use` name actor and receiver correctly. Fix any swap.
Also fix any obvious factual error you notice in other fields of the same entry.

Output: write ONLY the entries you changed, full objects with all keys, one per line, to /tmp/dshsticker/annot/qa_out.jsonl
(create it, even if empty). Then write a short report of what you changed and why to /tmp/dshsticker/annot/qa_report.md
