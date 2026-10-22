import { createCanvas, ImageData, type Canvas, type SKRSContext2D, type Image } from '@napi-rs/canvas';
/* 输出右上角的「用户生成」角标：小字、淡淡的，标明这张是用户自己拼的，不是官方表情。
   GIF 只有 1 位透明，所以分两种底：底色不透明的地方按 alpha 混进去（真正的半透明）；
   底是透明的地方没法半透明，只把笔画覆盖过半的像素点成一个浅灰（聊天背景上看着也是淡的）。 */

const TEXT = '用户生成'; // i18n-ignore — text drawn into generated GIF
const ALPHA = 0.42; // 不透明底上的混合比例
const GREY = 138; // 混进不透明底的灰
const GREY_ON_CLEAR = 176; // 透明底上直接点的浅灰
const MARGIN = 4;

let cache: { key: string; w: number; h: number; x: number; y: number; cov: Uint8ClampedArray } | null = null;

/** 把角标文字画成一张覆盖率图（alpha 通道），按输出尺寸缓存 */
function glyphs(W: number, H: number) {
  const px = Math.max(10, Math.min(14, Math.round(W * 0.036)));
  const key = `${W}x${H}`;
  if (cache && cache.key === key) return cache;
  const c = createCanvas(1, 1);
  const ctx = c.getContext('2d')!;
  ctx.font = `600 ${px}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "AR PL KaitiM Big5", sans-serif`;
  const w = Math.ceil(ctx.measureText(TEXT).width) + 2;
  const h = Math.ceil(px * 1.3);
  c.width = w;
  c.height = h;
  ctx.font = `600 ${px}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "AR PL KaitiM Big5", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(TEXT, 1, h / 2);
  const cov = ctx.getImageData(0, 0, w, h).data;
  cache = { key, w, h, x: Math.max(0, W - w - MARGIN), y: MARGIN, cov };
  return cache;
}

/** 就地给每一帧盖角标 */
export function stampFrames(frames: ImageData[], W: number, H: number): void {
  if (W < 60 || H < 40) return; // 太小的图放不下，算了
  const g = glyphs(W, H);
  for (const fr of frames) {
    const d = fr.data;
    for (let gy = 0; gy < g.h; gy++) {
      const y = g.y + gy;
      if (y >= H) break;
      for (let gx = 0; gx < g.w; gx++) {
        const cov = g.cov[(gy * g.w + gx) * 4 + 3]! / 255;
        if (cov <= 0.02) continue;
        const x = g.x + gx;
        if (x >= W) break;
        const i = (y * W + x) * 4;
        if (d[i + 3]! >= 128) {
          const k = ALPHA * cov;
          d[i] = Math.round(d[i]! * (1 - k) + GREY * k);
          d[i + 1] = Math.round(d[i + 1]! * (1 - k) + GREY * k);
          d[i + 2] = Math.round(d[i + 2]! * (1 - k) + GREY * k);
        } else if (cov >= 0.5) {
          d[i] = GREY_ON_CLEAR;
          d[i + 1] = GREY_ON_CLEAR;
          d[i + 2] = GREY_ON_CLEAR;
          d[i + 3] = 255;
        }
      }
    }
  }
}
