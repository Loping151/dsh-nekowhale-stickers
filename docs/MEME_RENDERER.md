# Portable Node meme renderer

`src/meme/index.ts` ports sticker-gallery's renderer and consumes its existing content-hashed asset index, GIF bases, geometry JSON and mask PNGs. No new asset format, CV implementation, DOM, or DeepSeek Harness dependency is involved. Runtime dependencies are `@napi-rs/canvas`, `gifuct-js`, and `gifenc`.

```ts
import { loadMemeIndex, listTemplates, renderMeme, type Fetcher } from './src/meme/index.js';
const fetcher: Fetcher = async relativePath => { /* return asset bytes */ };
const index = await loadMemeIndex(fetcher);
const templates = listTemplates(index, '大肥鱼');
const result = await renderMeme(fetcher, '大肥鱼', 'think', { text: '开心快乐' });
// result: { data: Buffer, mime: 'image/gif', width, height, masked }
```

`Fetcher` receives paths relative to the site root, without a leading slash: `meme/index.json`, `meme/assets/<hash>.gif`, `fonts/kai/fonts.css`, etc. Unhashed fallback paths URL-encode the pack name. The caller owns network policy and disk caching. Index and asset state is scoped to each invocation, so independent Fetchers cannot mix indexes. `listTemplates(index, pack?)` returns `{ pack, tpl, title, inputs: { texts, images }, defaultText }` entries for available templates only.

Template keys: `hug`, `couplet_top`, `couplet_bottom`, `think`, `scroll`, `sign`. Hug requires `image: Buffer`; text templates use their website defaults when text is empty. The website's layout and metric constants are retained, including vertical whitespace removal and single-line Latin phrases. `opts.watermark` defaults to false (the plugin never stamps); `opts.banwords` defaults to true. `masked` reports whether the site's hashed banword table changed the supplied text. The library does not impose the UI's input maxlength.

Fonts are loaded from the site's CSS unicode ranges. Only matching WOFF2 chunks are fetched. Canvas 1.0.13 loads WOFF2 directly, without a decompressor. Each chunk gets a content-hashed alias to prevent native font registrations replacing other subsets. Async-local family lists isolate concurrent renders. Registration is process-wide; network/disk caching remains the Fetcher's responsibility. As on the website, font fetch failures fall back to installed fonts. Kai's published subsets cover simplified Chinese; traditional glyphs require a system CJK fallback. The port adds common Linux families (AR PL KaitiM Big5, Noto CJK) to the existing fallback list. The comparison runner registers the reference host's freely redistributable `bkai00mp.ttf` to supply that fallback on this otherwise minimal host. No full font is bundled with the renderer.

The math, warp, watermark blend, hashed banword algorithm and shared RGB565 palette come from the site. One encoder correction excludes the reserved transparency entry when matching opaque colors; otherwise pure black can disappear. All other GIF behavior follows the website, including infinite repeat and treating disposal 3 as clearing the previous patch. Font rasterization, system watermark fonts and encoder quantization prevent a general byte-for-byte guarantee against browsers or PIL.

For compilation use NodeNext/ES2022, strict TypeScript, Node types and the included gifenc declaration. When emitting JS, copy `src/meme/banwords.json` beside the emitted `banwords.js` (it is loaded with `createRequire`, which works on Node 20 without JSON import flags). No repository-wide build settings were changed.

## Accuracy

Checked against the original Python templates with short, long, Traditional Chinese and Latin captions and with
different avatars. Chinese text position stays within about 1–4 px of the reference (sign ≤ 1.6 px, opened scroll
≤ 1.4 px, think ≤ 2.4 px, couplets ≤ 3.9 px for a single large character). Latin captions intentionally follow the
website layout (one line, no wrapping), so they differ from the Python version.

## Fonts

Runtime uses the website's WOFF2 subsets, fetched per character range: 文鼎 PL 简中楷 `gkai00mp` (ARPHIC Public
License) for couplets and signs, and Noto Sans CJK SC Black (SIL Open Font License 1.1) for think and scroll. Missing
glyphs fall back to the system CJK fonts of the machine running the renderer.
