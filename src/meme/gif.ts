import { createCanvas, ImageData, type Canvas, type SKRSContext2D, type Image } from '@napi-rs/canvas';
/* ============================================================
   GIF 的解与编（Node 端）：解码用 gifuct-js（逐帧补齐 disposal 合成整帧），编码用 gifenc（每帧独立调色板 + 1 位透明）
   ============================================================ */
import { decompressFrames, parseGIF } from 'gifuct-js';
import gifenc from 'gifenc';
const { GIFEncoder, quantize } = gifenc;

export interface GifFrames {
  w: number;
  h: number;
  frames: ImageData[];
  delays: number[];
}

export async function decodeGif(data: Buffer): Promise<GifFrames> {
  const gif = parseGIF(Uint8Array.from(data).buffer);
  const parsed = decompressFrames(gif, true);
  const w = gif.lsd.width;
  const h = gif.lsd.height;
  const canvas = createCanvas(1, 1);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const patch = createCanvas(1, 1);
  const pctx = patch.getContext('2d')!;
  const frames: ImageData[] = [];
  const delays: number[] = [];
  let prev: (typeof parsed)[number] | null = null;
  for (const f of parsed) {
    // disposal 2 = 画完这一帧后把它那块清掉；3 = 恢复上一帧（很少见，按清掉处理）
    if (prev && prev.disposalType >= 2) ctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
    patch.width = f.dims.width;
    patch.height = f.dims.height;
    const rgba = new Uint8ClampedArray(f.patch.length);
    rgba.set(f.patch);
    pctx.putImageData(new ImageData(rgba, f.dims.width, f.dims.height), 0, 0);
    ctx.drawImage(patch, f.dims.left, f.dims.top);
    frames.push(ctx.getImageData(0, 0, w, h));
    delays.push(f.delay || 60);
    prev = f;
  }
  return { w, h, frames, delays };
}

/** 帧序列 → GIF（透明背景保留为 1 位透明），delays 为毫秒。
    调色板用全部帧的不透明像素抽样一起算一份、每帧共用：逐帧各算会让静止的部分逐帧换色，看起来一直在闪。
    按 RGB565 量化（不是 RGBA4444）：4 位一通道太粗，近黑的字会被并进深藏青的头发色里，字看着发蓝 */
export function encodeGif(frames: ImageData[], delays: number[]): Buffer {
  const gif = GIFEncoder();
  // Every opaque colour of the whole animation, with counts.
  const counts = new Map<number, number>();
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 128) continue;
      const key = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  // Few enough colours (the source stickers use one 255-colour table): keep them exactly. Otherwise quantize
  // once over a sample of all frames.
  let palette: number[][];
  if (counts.size <= 255) {
    palette = [...counts.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  } else {
    const total = frames.reduce((n, f) => n + f.data.length, 0);
    const step = Math.max(1, Math.ceil(total / (4 * 200_000))); // 最多抽 20 万像素算调色板
    const sample = new Uint8ClampedArray(Math.ceil(total / step / 4) * 4 + 4);
    let k = 0;
    for (const f of frames) {
      const d = f.data;
      for (let i = 0; i + 3 < d.length; i += 4 * step) {
        if (d[i + 3]! < 128) continue; // 透明像素不参与配色
        sample[k] = d[i]!; sample[k + 1] = d[i + 1]!; sample[k + 2] = d[i + 2]!; sample[k + 3] = 255;
        k += 4;
      }
    }
    palette = (k ? quantize(sample.subarray(0, k), 255, { format: 'rgb565' }) : [[0, 0, 0]]) as number[][];
  }
  if (palette.length === 0) palette.push([0, 0, 0]);
  // One exact-colour lookup shared by all frames. gifenc's applyPalette caches per call by an RGB565 key using
  // whichever pixel of that bucket it met first, so near-identical colours could map to different entries from
  // frame to frame and static areas shimmered.
  const lookup = new Map<number, number>();
  const nearest = (key: number): number => {
    let idx = lookup.get(key);
    if (idx !== undefined) return idx;
    const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i]!;
      const dr = r - p[0]!, dg = g - p[1]!, db = b - p[2]!;
      const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dist < bestD) { bestD = dist; best = i; if (dist === 0) break; }
    }
    lookup.set(key, best);
    return best;
  };
  const ti = palette.length; // 透明色索引（单独占一格，不和任何实色共用）
  const full = [...palette, [0, 0, 0]];
  frames.forEach((fr, i) => {
    const d = fr.data;
    const index = new Uint8Array(fr.width * fr.height);
    for (let p = 0, j = 0; p < index.length; p++, j += 4) {
      index[p] = d[j + 3]! < 128 ? ti : nearest((d[j]! << 16) | (d[j + 1]! << 8) | d[j + 2]!);
    }
    gif.writeFrame(index, fr.width, fr.height, { palette: full, delay: delays[i] ?? 60, transparent: true, transparentIndex: ti, dispose: 2, repeat: 0 });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** 把 ImageData 画到一张新画布上（拿来当 drawImage 的源） */
export function toCanvas(img: ImageData): Canvas {
  const c = createCanvas(1, 1);
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}
