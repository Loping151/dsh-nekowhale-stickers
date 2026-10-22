# Task: annotate original animated stickers for an AI sticker plugin

You are labelling stickers so a chat AI can pick the right one. Each sticker has a contact sheet: a JPG showing
up to 12 frames of the GIF in order (left to right, top to bottom, frame numbers in red, header shows total frames
and duration). Light grey = transparent background. Look at EVERY sheet with your image viewing tool, read the
sticker's file name (the part after the code is the author's own title, a strong hint), and write one JSON line.

## Characters
- 大肥鱼 (Da Fei Yu, "big fat fish"): an anthropomorphised DeepSeek whale girl. Dark blue long hair with an ahoge,
  maid headdress, blue eyes, a whale-tail shaped hair tuft or fin. Keywords people use: 大肥鱼, 肥鱼, ds, deepseek.
- GPT娘 (GPT-chan): the WHITE character (white or silver hair, dragon horns (she is a dragon girl), an OpenAI-logo hair ornament) in pack 大肥鱼和GPT娘. She is the
  anthropomorphised ChatGPT. In that pack DIRECTION MATTERS: always state who does what to whom.
Packs: 大肥鱼 (single character) and 大肥鱼和GPT娘 (two characters).

## Output: one JSON object per line, keys in this order, Simplified Chinese except `en`
{"id": "<pack>/<file stem>",
 "text": "caption text drawn in the image, exactly, or empty string",
 "emotion": "<one of: 开心 大笑 喜欢 害羞 得意 兴奋 惊讶 疑惑 思考 无语 难过 哭 生气 害怕 疲惫 赞同 拒绝 打招呼 感谢 道歉 卖萌 搞怪 嘲讽 安慰 其他>",
 "tags": ["4 to 8 short tags about WHEN to use it: situation, emotion, intent, e.g. 下班, 摸鱼, 求夸, 阴阳怪气"],
 "use": "one sentence, at most 30 chars: the chat situation where this sticker fits best",
 "desc": "40 to 100 chars: what happens in the animation, start to end, concrete actions and expression changes",
 "meme": "the well known meme, catchphrase, anime, game or internet culture reference it plays on, with the source, or empty string if none or not sure. Never guess.",
 "dir": "two-character pack only: e.g. 大肥鱼→GPT娘, GPT娘→大肥鱼, 互相, or 无 when they do not interact. Empty string in the single pack.",
 "en": "short English gloss, at most 8 words"}

For the two-character pack, `desc` and `use` must name the actor and the receiver, e.g. 大肥鱼给GPT娘喂药, not 一个人给另一个喂药.
Check carefully which one is white (GPT娘) and which is dark blue (大肥鱼) in each frame.
`tags` must help retrieval by an AI that is deciding how to react in a chat; prefer situations and feelings over visual details.
`meme`: use your knowledge; you may use web search sparingly only when the title clearly points to a specific meme you
cannot place. Leave it empty rather than inventing.

## Procedure
1. Read your batch list file (one contact sheet path per line). The sticker id is the pack folder name + "/" + the sheet
   file stem.
2. For each sheet in order: view it, then APPEND its JSON line to your output file immediately (so progress survives).
   If the output file already has a line for an id, skip that sticker (resume support).
3. Do not write anything else to the output file. Valid JSON per line, no trailing commas, no code fences.
4. When the whole list is done, append nothing more and reply DONE with the number of lines written.
