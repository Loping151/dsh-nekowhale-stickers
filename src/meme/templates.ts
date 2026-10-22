import { createCanvas, ImageData, type Canvas, type SKRSContext2D, type Image } from '@napi-rs/canvas';
/* ============================================================
   六个模板的拼法（Node 端，移植自 sticker-gallery）。素材由 tools/meme/build.py 离线算好放在 /meme/<角色>/：
   底图 GIF（原字已抠掉）+ JSON（逐帧四角 / 位移 / 头像圆心）+ 蒙版图。这里只做「贴回去 + 编码」
   ============================================================ */
import { decodeGif, encodeGif, toCanvas, type GifFrames } from './gif.js';
import { drawWarped, type Pt } from './warp.js';
import { stampFrames } from './watermark.js';
import { circularAvatar, ensureFont, FONT_BLACK, FONT_KAI, renderTextBlock, renderVerticalStrip } from './text.js';
import { loadImage } from '@napi-rs/canvas';
import { maskText } from './banwords.js';
import { withFonts } from './fonts.js';
import type { Fetcher } from './types.js';
export type { Fetcher } from './types.js';

export type TemplateKey = 'hug' | 'couplet_top' | 'couplet_bottom' | 'think' | 'scroll' | 'sign';

export interface TemplateDef {
  key: TemplateKey;
  label: string;
  fileLabel: string; // i18n-ignore — fixed download file name component
  /** 输入是文字还是头像 */
  input: 'text' | 'image';
  defaultText: string;
  maxLen: number;
}

export const TEMPLATES: TemplateDef[] = [
  { key: 'hug', label: '抱', fileLabel: '抱', input: 'image', defaultText: '', maxLen: 0 }, // i18n-ignore — file name
  { key: 'couplet_top', label: '上联', fileLabel: '上联', input: 'text', defaultText: '恭喜发财', maxLen: 12 }, // i18n-ignore — file name and default image text
  { key: 'couplet_bottom', label: '下联', fileLabel: '下联', input: 'text', defaultText: '万事如意', maxLen: 12 }, // i18n-ignore — file name and default image text
  { key: 'think', label: '想', fileLabel: '想', input: 'text', defaultText: '妈妈', maxLen: 20 }, // i18n-ignore — file name and default image text
  { key: 'scroll', label: '葱卷', fileLabel: '葱卷', input: 'text', defaultText: '葱卷', maxLen: 60 }, // i18n-ignore — file name and default image text
  { key: 'sign', label: '举牌', fileLabel: '举牌', input: 'text', defaultText: '今天也要开心哦', maxLen: 40 }, // i18n-ignore — file name and default image text
];

interface BaseMeta {
  size: [number, number];
  durations: number[];
  base: string;
  source: string;
}
interface HugMeta extends BaseMeta {
  dia: number;
  paw: string;
  frames: { cx: number; cy: number }[];
}
interface CoupletMeta extends BaseMeta {
  W: number;
  L: number;
  frames: { quad: Pt[] }[]; // TL,BL,BR,TR
}
interface ThinkMeta extends BaseMeta {
  box: [number, number, number, number];
  mask?: string; // 抹字后的气泡白面（竖向拼的蒙版图）：字只在里面显示，角色压进气泡的地方被挡住
  frames: { dy: number }[];
}
interface ScrollMeta extends BaseMeta {
  shortBox: [number, number, number, number];
  wideBox: [number, number, number, number];
  longText: number;
  mask: string;
  frames: { dy: number; mask: boolean }[];
}
interface SignMeta extends BaseMeta {
  W: number;
  H: number;
  frames: { quad: Pt[] }[]; // TL,TR,BR,BL
}

export interface MemeInputs {
  text?: string;
  image?: Buffer;
}

export interface MemeResult { data: Buffer; mime: 'image/gif'; width: number; height: number; masked: boolean }

const INK_KAI = 'rgb(28, 22, 22)';
const INK_BLACK = 'rgb(16, 16, 16)';
const INK_SIGN = 'rgb(38, 34, 40)';

/* ---------- 素材索引与版本 ----------
   index.json 每次校验（no-cache），assets 把逻辑文件名映射到按内容哈希命名的不可变副本。
   只更新有变化的素材；固定地址仅用于兼容旧索引，服务端要求每次校验。 */
export interface MemeIndex {
  packs: Record<string, Partial<Record<TemplateKey, string>>>;
  skipped: Record<string, Record<string, string>>;
  templates: string[];
  generated?: string;
  assets?: Record<string, Record<string, string>>;
}
export async function loadMemeIndex(fetch: Fetcher): Promise<MemeIndex> {
  const idx = JSON.parse((await fetch('meme/index.json')).toString('utf8')) as MemeIndex;
  if (!idx.packs || !idx.templates) throw new Error('Invalid meme index');
  return idx;
}
export function listTemplates(index: MemeIndex, pack?: string) {
  return Object.entries(index.packs).filter(([p]) => pack === undefined || p === pack).flatMap(([p, available]) =>
    TEMPLATES.filter(t => available[t.key]).map(t => ({ pack: p, tpl: t.key, title: `${p}${t.label}`,
      inputs: { texts: Number(t.input === 'text'), images: Number(t.input === 'image') }, defaultText: t.defaultText })));
}

// All asset state belongs to one invocation; different Fetchers cannot contaminate one another.
class Assets {
  constructor(readonly fetch: Fetcher, readonly index: MemeIndex, readonly pack: string) {}
  path(file: string): string {
    const hashed = this.index.assets?.[this.pack]?.[file];
    return hashed ? `meme/${hashed}` : `meme/${encodeURIComponent(this.pack)}/${file}`;
  }
  async meta<T>(tpl: TemplateKey): Promise<T> { return JSON.parse((await this.fetch(this.path(`${tpl}.json`))).toString('utf8')) as T; }
  async gif(file: string) { return decodeGif(await this.fetch(this.path(file))); }
  async masks(file: string, w: number, h: number, n: number): Promise<Canvas[]> {
    const img = await loadImage(await this.fetch(this.path(file)));
    if (img.width !== w || img.height !== h*n) throw new Error('Invalid mask dimensions');
    const sheet = createCanvas(w,h*n), ctx = sheet.getContext('2d'); ctx.drawImage(img,0,0);
    return Array.from({length:n}, (_,i) => {
      const d = ctx.getImageData(0,i*h,w,h);
      for(let k=0;k<d.data.length;k+=4) d.data[k+3]=d.data[k];
      return toCanvas(d);
    });
  }
}

function blank(base: GifFrames): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(1, 1);
  canvas.width = base.w;
  canvas.height = base.h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

/** 让出主线程一拍（几十帧逐帧算，别把界面卡死） */
const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export async function renderMeme(fetch: Fetcher, pack: string, tpl: TemplateKey, inputs: MemeInputs,
  opts: { watermark?: boolean; banwords?: boolean } = {}): Promise<MemeResult> {
  const index = await loadMemeIndex(fetch);
  const def = TEMPLATES.find(t => t.key === tpl);
  if (!def || !index.packs[pack]?.[tpl]) throw new Error(`Unavailable template: ${pack}/${tpl}`);
  const masked = opts.banwords === false || def.input === 'image' ? {text: inputs.text ?? '', masked: false} : maskText(inputs.text ?? '');
  const assets = new Assets(fetch,index,pack);
  return withFonts(fetch, async () => {
    let out;
    switch(tpl) {
      case 'hug': out = await renderHug(assets, inputs); break;
      case 'couplet_top': case 'couplet_bottom': out = await renderCouplet(assets,tpl,masked.text); break;
      case 'think': out = await renderThink(assets,masked.text); break;
      case 'scroll': out = await renderScroll(assets,masked.text); break;
      case 'sign': out = await renderSign(assets,masked.text); break;
    }
    if (opts.watermark === true) stampFrames(out.frames,out.w,out.h);
    return { data: encodeGif(out.frames,out.delays), mime: 'image/gif' as const, width: out.w, height: out.h, masked: masked.masked };
  });
}

async function renderHug(assets: Assets, inputs: MemeInputs, onProgress?: (f: number) => void) {
  const meta = await assets.meta<HugMeta>('hug');
  const [base, paw] = await Promise.all([assets.gif(meta.base), assets.gif(meta.paw)]);
  const img = inputs.image ? await loadImage(inputs.image) : undefined;
  if (!img) throw new Error('先放一张头像');
  const sw = img.width;
  const sh = img.height;
  const avatar = circularAvatar(img, meta.dia, sw, sh);
  const { canvas, ctx } = blank(base);
  const frames: ImageData[] = [];
  const pawCanvases = paw.frames.map(toCanvas);
  for (let i = 0; i < base.frames.length; i++) {
    const c = meta.frames[i] ?? meta.frames[meta.frames.length - 1]!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(base.frames[i]!, 0, 0);
    ctx.drawImage(avatar, c.cx - meta.dia / 2, c.cy - meta.dia / 2);
    const pc = pawCanvases[i] ?? pawCanvases[pawCanvases.length - 1];
    if (pc) ctx.drawImage(pc, 0, 0);
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    onProgress?.((i + 1) / base.frames.length);
    if (i % 6 === 5) await breathe();
  }
  return { frames, delays: base.delays, w: base.w, h: base.h };
}

async function renderCouplet(assets: Assets, tpl: 'couplet_top' | 'couplet_bottom', text: string, onProgress?: (f: number) => void) {
  const meta = await assets.meta<CoupletMeta>(tpl);
  const def = TEMPLATES.find((t) => t.key === tpl)!;
  text = text.trim() || def.defaultText;
  await ensureFont(FONT_KAI, 400, text);
  const base = await assets.gif(meta.base);
  const strip = renderVerticalStrip(meta.W, meta.L, text, FONT_KAI, 400, INK_KAI);
  const stripData = strip.getContext('2d')!.getImageData(0, 0, strip.width, strip.height);
  const frames: ImageData[] = [];
  for (let i = 0; i < base.frames.length; i++) {
    const fr = new ImageData(new Uint8ClampedArray(base.frames[i]!.data), base.w, base.h);
    const q = (meta.frames[i] ?? meta.frames[meta.frames.length - 1]!).quad; // TL,BL,BR,TR
    drawWarped(fr, stripData, [q[0]!, q[3]!, q[2]!, q[1]!]);
    frames.push(fr);
    onProgress?.((i + 1) / base.frames.length);
    if (i % 4 === 3) await breathe();
  }
  return { frames, delays: base.delays, w: base.w, h: base.h };
}

async function renderThink(assets: Assets, text: string, onProgress?: (f: number) => void) {
  const meta = await assets.meta<ThinkMeta>('think');
  text = text.trim() || '妈妈'; // i18n-ignore — default image text
  await ensureFont(FONT_BLACK, 900, text);
  const base = await assets.gif(meta.base);
  const masks = meta.mask ? await assets.masks(meta.mask, base.w, base.h, meta.frames.length) : null;
  const [x0, y0, x1, y1] = meta.box;
  const flat = renderTextBlock(x1 - x0 + 1, y1 - y0 + 1, text, { family: FONT_BLACK, weight: 900, color: INK_BLACK, maxPx: 78, minPx: 8, linesAlign: 'left' });
  const { canvas, ctx } = blank(base);
  const layer = createCanvas(1, 1);
  layer.width = base.w;
  layer.height = base.h;
  const lctx = layer.getContext('2d')!;
  const frames: ImageData[] = [];
  for (let i = 0; i < base.frames.length; i++) {
    const dy = (meta.frames[i] ?? meta.frames[meta.frames.length - 1]!).dy;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(base.frames[i]!, 0, 0);
    const mask = masks?.[i] ?? masks?.[masks.length - 1];
    if (mask) {
      // 字只在气泡白面上显示：头发 / 耳朵压进气泡的地方被挡住（脑袋在前、字在后）
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.drawImage(flat, x0, y0 + dy);
      lctx.globalCompositeOperation = 'destination-in';
      lctx.drawImage(mask, 0, 0);
      ctx.drawImage(layer, 0, 0);
    } else {
      ctx.drawImage(flat, x0, y0 + dy);
    }
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    onProgress?.((i + 1) / base.frames.length);
    if (i % 6 === 5) await breathe();
  }
  return { frames, delays: base.delays, w: base.w, h: base.h };
}

async function renderScroll(assets: Assets, text: string, onProgress?: (f: number) => void) {
  const meta = await assets.meta<ScrollMeta>('scroll');
  text = text.trim() || '葱卷'; // i18n-ignore — default image text
  await ensureFont(FONT_BLACK, 900, text);
  const base = await assets.gif(meta.base);
  const masks = await assets.masks(meta.mask, base.w, base.h, meta.frames.length);
  // 字对着整张纸面居中（不管长短），被角色挡住的部分由蒙版裁掉——和「想」一个层次逻辑；原版短文另用一个避开角色的小框，本站不这么做
  const box = meta.wideBox;
  const [x0, y0, x1, y1] = box;
  const flat = renderTextBlock(x1 - x0 + 1, y1 - y0 + 1, text, { family: FONT_BLACK, weight: 900, color: INK_BLACK, maxPx: 110, minPx: 8, linesAlign: 'left' });
  const { canvas, ctx } = blank(base);
  const layer = createCanvas(1, 1);
  layer.width = base.w;
  layer.height = base.h;
  const lctx = layer.getContext('2d')!;
  const frames: ImageData[] = [];
  for (let i = 0; i < base.frames.length; i++) {
    const fm = meta.frames[i] ?? meta.frames[meta.frames.length - 1]!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(base.frames[i]!, 0, 0);
    if (fm.mask && masks[i]) {
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.drawImage(flat, x0, y0 + fm.dy);
      lctx.globalCompositeOperation = 'destination-in';
      lctx.drawImage(masks[i]!, 0, 0);
      ctx.drawImage(layer, 0, 0);
    }
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    onProgress?.((i + 1) / base.frames.length);
    if (i % 6 === 5) await breathe();
  }
  return { frames, delays: base.delays, w: base.w, h: base.h };
}

async function renderSign(assets: Assets, text: string, onProgress?: (f: number) => void) {
  const meta = await assets.meta<SignMeta>('sign');
  text = text.trim() || '今天也要开心哦'; // i18n-ignore — default image text
  await ensureFont(FONT_KAI, 400, text);
  const base = await assets.gif(meta.base);
  const flat = renderTextBlock(meta.W, meta.H, text, { family: FONT_KAI, weight: 400, color: INK_SIGN, maxPx: 90, minPx: 8, strokeRatio: 0.025, linesAlign: 'left' });
  const flatData = flat.getContext('2d')!.getImageData(0, 0, flat.width, flat.height);
  const frames: ImageData[] = [];
  for (let i = 0; i < base.frames.length; i++) {
    const fr = new ImageData(new Uint8ClampedArray(base.frames[i]!.data), base.w, base.h);
    drawWarped(fr, flatData, (meta.frames[i] ?? meta.frames[meta.frames.length - 1]!).quad);
    frames.push(fr);
    onProgress?.((i + 1) / base.frames.length);
    if (i % 4 === 3) await breathe();
  }
  return { frames, delays: base.delays, w: base.w, h: base.h };
}
