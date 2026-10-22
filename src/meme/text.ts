import { createCanvas, ImageData, type Canvas, type SKRSContext2D, type Image } from '@napi-rs/canvas';
/* ============================================================
   文字排版与渲染（Canvas 2D）
   - 均衡分行：选使字号最大的行数，再把字数平均分到各行（相差 ≤ 1）——和服务端那套一致，末字不会挤成孤行
   - 自适应字号：和服务端 pil_utils.draw_text 一样，从最大字号逐 1 递减到「最长行 ≤ 宽 且 总高 ≤ 高」为止
   - 行高 / 基线：skia paragraph 的口径——行高 = 字体 ascent + descent（楷体正好 1.0 em，Noto Black 约 1.45 em），
     基线在行顶 + ascent；整块居中、各行左对齐（lines_align=left）
   - 竖排长条（上联 / 下联）：每个字在自己那格居中
   - 字体：分片 woff2 按 unicode-range 只取用到的片；渲染前注册到 GlobalFonts
   ============================================================ */
import { fontFamilies } from './fonts.js';
export { ensureFont } from './fonts.js';
export const FONT_KAI = 'Kai';
export const FONT_BLACK = 'NotoBlack';

/** 均衡分行：含换行 / 空格的按换行拆（拉丁文交给自然换行），否则按方块字均分 */
export function balancedLines(text: string, W: number, H: number): string[] {
  text = text.trim();
  if (!text) return [];
  if (text.includes('\n')) return text.split('\n').map((s) => s.trim()).filter(Boolean);
  const chars = Array.from(text);
  const L = chars.length;
  if (L <= 1 || /\s/.test(text)) return [text];
  let best = 1;
  let bestSize = 0;
  for (let m = 1; m <= L; m++) {
    const perLine = Math.ceil(L / m);
    const size = Math.min(W / perLine, H / m);
    if (size > bestSize) {
      bestSize = size;
      best = m;
    }
  }
  const base = Math.floor(L / best);
  const rem = L % best;
  const lines: string[] = [];
  let i = 0;
  for (let k = 0; k < best; k++) {
    const n = base + (k < rem ? 1 : 0);
    lines.push(chars.slice(i, i + n).join(''));
    i += n;
  }
  return lines;
}

function fontStr(px: number, family: string, weight: number): string {
  return `${weight} ${px}px ${fontFamilies(family)}, "PingFang SC", "Microsoft YaHei", "AR PL KaitiM Big5", "Noto Sans CJK SC", "Noto Sans CJK TC", sans-serif`;
}

/** 字体在某字号下的 ascent / descent / 行高，按服务端 skia 量出来的口径写死（浏览器的 fontBoundingBox 用的是 OS/2 typo 值，
    Noto Black 会少算三成行高，字就排大了）：
    - 文鼎简中楷 gkai00mp：ascent 0.8789、descent 0.1201、leading 0.0059 → 行高 ≈ 1.005 em
    - Noto Sans CJK SC Black：ascent 1.16、descent 0.288 → 行高 1.448 em
    skia paragraph 每行高度取整（round），这里照做 */
export function fontMetrics(_ctx: SKRSContext2D, px: number, family: string, _weight: number): { asc: number; desc: number; lineH: number } {
  const r = family === FONT_BLACK ? { asc: 1.16, desc: 0.288, lead: 0 } : { asc: 0.8789, desc: 0.1201, lead: 0.0059 };
  return { asc: px * r.asc, desc: px * r.desc, lineH: Math.round(px * (r.asc + r.desc + r.lead)) };
}

/** 最大字号：从 maxPx 逐 1 递减，直到最长行 ≤ W 且 行数 × 行高 ≤ H（和 pil_utils.draw_text 同一口径）；放不下就返回 minPx */
export function fitFont(ctx: SKRSContext2D, lines: string[], W: number, H: number, family: string, weight: number, maxPx: number, minPx: number): number {
  for (let px = Math.floor(maxPx); px >= minPx; px--) {
    if (lines.length * fontMetrics(ctx, px, family, weight).lineH > H) continue;
    ctx.font = fontStr(px, family, weight);
    let ok = true;
    for (const l of lines) {
      if (ctx.measureText(l).width > W) {
        ok = false;
        break;
      }
    }
    if (ok) return px;
  }
  return minPx;
}

export interface TextBlockOpts {
  family: string;
  weight: number;
  color: string;
  maxPx: number;
  minPx: number;
  /** 描边宽度占字号比例（0 = 不描）；实际描边宽 = round(字号 × 比例)，和服务端一样 */
  strokeRatio?: number;
  /** 多行时各行怎么对齐：整块居中后，'left' = 各行左端对齐（pil_utils draw_text 的默认 lines_align），'center' = 各行各自居中 */
  linesAlign?: 'left' | 'center';
}

/** 把文字排进 W×H 的透明画布，居中 */
export function renderTextBlock(W: number, H: number, text: string, o: TextBlockOpts): Canvas {
  const c = createCanvas(1, 1);
  c.width = Math.max(1, Math.round(W));
  c.height = Math.max(1, Math.round(H));
  const ctx = c.getContext('2d')!;
  const lines = balancedLines(text, c.width, c.height);
  if (!lines.length) return c;
  const px = fitFont(ctx, lines, c.width, c.height, o.family, o.weight, o.maxPx, o.minPx);
  const { asc, lineH } = fontMetrics(ctx, px, o.family, o.weight);
  ctx.font = fontStr(px, o.family, o.weight);
  const leftAligned = o.linesAlign === 'left' && lines.length > 1;
  // 各行左对齐：文字块（最宽那行）整体居中，短行贴着块的左边——原版 pil_utils 就是这么排的，各行居中会让短行往右挪半个字
  const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const x = leftAligned ? (c.width - blockW) / 2 : c.width / 2;
  ctx.textAlign = leftAligned ? 'left' : 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = o.color;
  ctx.lineJoin = 'round';
  const stroke = o.strokeRatio ? Math.round(px * o.strokeRatio) : 0;
  if (stroke) {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = stroke;
  }
  // 整块（行数 × 行高）在框里居中，每行基线 = 行顶 + ascent
  let top = (c.height - lines.length * lineH) / 2;
  for (const l of lines) {
    const y = top + asc;
    if (stroke) ctx.strokeText(l, x, y);
    ctx.fillText(l, x, y);
    top += lineH;
  }
  return c;
}

/** 竖排长条：W 宽 L 长，每个字在自己的格里居中（上联 / 下联） */
export function renderVerticalStrip(W: number, L: number, text: string, family: string, weight: number, color: string): Canvas {
  const c = createCanvas(1, 1);
  c.width = Math.max(1, Math.round(W));
  c.height = Math.max(1, Math.round(L));
  const ctx = c.getContext('2d')!;
  const chars = Array.from(text.replace(/\s+/g, ''));
  if (!chars.length) return c;
  const pitch = c.height / chars.length;
  const px = Math.max(8, Math.floor(Math.min(c.width * 0.92, pitch * 0.86)));
  ctx.font = fontStr(px, family, weight);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, Math.floor(px / 40)) * 2;
  chars.forEach((ch, i) => {
    const y = pitch * i + pitch / 2;
    ctx.strokeText(ch, c.width / 2, y);
    ctx.fillText(ch, c.width / 2, y);
  });
  return c;
}

/** 任意图片 → 方形居中裁剪 → 圆形（抗锯齿靠 2 倍超采样） */
export function circularAvatar(img: (Canvas | Image) & { width?: number; height?: number }, dia: number, srcW: number, srcH: number): Canvas {
  const ss = 2;
  const big = createCanvas(1, 1);
  big.width = big.height = dia * ss;
  const bctx = big.getContext('2d')!;
  const s = Math.min(srcW, srcH);
  bctx.save();
  bctx.beginPath();
  bctx.arc((dia * ss) / 2, (dia * ss) / 2, (dia * ss) / 2, 0, Math.PI * 2);
  bctx.closePath();
  bctx.clip();
  bctx.drawImage(img, (srcW - s) / 2, (srcH - s) / 2, s, s, 0, 0, dia * ss, dia * ss);
  bctx.restore();
  const out = createCanvas(1, 1);
  out.width = out.height = dia;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(big, 0, 0, dia, dia);
  return out;
}
