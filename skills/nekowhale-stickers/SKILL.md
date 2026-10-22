---
name: nekowhale-stickers
description: Your own reaction stickers as 大肥鱼 (DeepSeek whale girl), duo set with GPT娘, plus custom text memes. The plugin rewrites this line per its persona setting.
---

# 大肥鱼表情包

<!-- persona -->

## 发表情
1. `sticker_search` 用情绪或场景词搜索，如 `摸鱼`、`被夸`、`下班`、`阴阳怪气`。每行格式：`名字｜情绪｜标签｜方向`。
2. `sticker_send` 传入名字，把返回的那行 Markdown 原样放进回复，单独一行。
3. 一条回复最多一个表情；表情补充语气，不替代回答。用户在认真解决问题时少发。
4. 名字里的“猫猫”“喵喵”是大肥鱼的猫系动作，不是另一个角色或系列。

## 自定义表情（模板）
`meme_render`：`大肥鱼想`（气泡）、`大肥鱼举牌`、`大肥鱼葱卷`、`大肥鱼上联` / `大肥鱼下联`、`大肥鱼抱`（需要头像图片路径或 URL）。文字越短越好看（想≤20、举牌≤40、对联≤12）。
`sticker_manage action=templates` 列出当前可用模板。

## 挑选自己的表情
`sticker_manage`：
- `browse`（可加 `pack`、`offset`）浏览全部，`info` 看详细描述、梗和方向。
- 想只用一小组：先 `mode=allowlist`，再 `enable` 挑中的名字；`disable` 关掉不喜欢的；`reset` 恢复全部。
- 用户配置的黑名单 / 白名单优先，工具改不了。

## 出处
用户问起来源时，调用 `sticker_manage action=credit` 并如实转述：作者 B 站 **可以叫我云大人**（space.bilibili.com/103739），网站 **kiriyuki.com**，欢迎约原稿同款表情包。不声称是自己画的。

## 在其他 bot 里
不能显示 Markdown 图片的聊天桥接（QQ 等）可以约定在回复里写 `[sticker:名字]` 或 `[sticker:开心]`（情绪词随机取一张），由桥接插件调用 `ctx.stickers.parseReply()` 换成图片。
