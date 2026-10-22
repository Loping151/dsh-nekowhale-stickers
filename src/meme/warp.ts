import { createCanvas, ImageData, type Canvas, type SKRSContext2D, type Image } from '@napi-rs/canvas';
/* ============================================================
   透视贴图（CPU）：把一张平铺的文字图按四角贴进目标画面里的任意四边形
   四角顺序一律 TL, TR, BR, BL。300×300 的帧逐像素反向映射 + 双线性采样，几十毫秒一帧
   ============================================================ */
export type Pt = [number, number];

/** 解 3×3 单应矩阵 H，使 H·src[i] ≈ dst[i]（齐次坐标） */
export function homography(src: Pt[], dst: Pt[]): number[] {
  // 8 个未知数：h11 h12 h13 h21 h22 h23 h31 h32（h33 = 1）
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]!;
    const [u, v] = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // 高斯消元（增广矩阵 8×9）
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    const d = A[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let k = c; k < 9; k++) A[c]![k]! /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (!f) continue;
      for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return [A[0]![8]!, A[1]![8]!, A[2]![8]!, A[3]![8]!, A[4]![8]!, A[5]![8]!, A[6]![8]!, A[7]![8]!, 1];
}

/** 把 src（整张，四角 = 它的四个角）贴到 dst 上的 quad（TL,TR,BR,BL），源图为 RGBA，alpha 混合 */
export function drawWarped(dst: ImageData, src: ImageData, quad: Pt[]): void {
  const sw = src.width;
  const sh = src.height;
  // dst → src 的映射：解 quad → 源矩形
  const H = homography(quad, [
    [0, 0],
    [sw, 0],
    [sw, sh],
    [0, sh],
  ]);
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(dst.width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(dst.height - 1, Math.ceil(Math.max(...ys)));
  const d = dst.data;
  const s = src.data;
  const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = H as [number, number, number, number, number, number, number, number, number];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w = h31 * px + h32 * py + h33;
      if (Math.abs(w) < 1e-9) continue;
      const u = (h11 * px + h12 * py + h13) / w - 0.5;
      const v = (h21 * px + h22 * py + h23) / w - 0.5;
      if (u < -0.5 || v < -0.5 || u > sw - 0.5 || v > sh - 0.5) continue;
      // 双线性
      const ux = Math.max(0, Math.min(sw - 1, u));
      const vy = Math.max(0, Math.min(sh - 1, v));
      const ix = Math.floor(ux);
      const iy = Math.floor(vy);
      const fx = ux - ix;
      const fy = vy - iy;
      const ix1 = Math.min(sw - 1, ix + 1);
      const iy1 = Math.min(sh - 1, iy + 1);
      const i00 = (iy * sw + ix) * 4;
      const i10 = (iy * sw + ix1) * 4;
      const i01 = (iy1 * sw + ix) * 4;
      const i11 = (iy1 * sw + ix1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const a = (s[i00 + 3]! * w00 + s[i10 + 3]! * w10 + s[i01 + 3]! * w01 + s[i11 + 3]! * w11) / 255;
      if (a <= 0.002) continue;
      // 预乘平均，避免透明像素的颜色（黑）渗进边缘
      const pr = (s[i00]! * s[i00 + 3]! * w00 + s[i10]! * s[i10 + 3]! * w10 + s[i01]! * s[i01 + 3]! * w01 + s[i11]! * s[i11 + 3]! * w11) / 255;
      const pg = (s[i00 + 1]! * s[i00 + 3]! * w00 + s[i10 + 1]! * s[i10 + 3]! * w10 + s[i01 + 1]! * s[i01 + 3]! * w01 + s[i11 + 1]! * s[i11 + 3]! * w11) / 255;
      const pb = (s[i00 + 2]! * s[i00 + 3]! * w00 + s[i10 + 2]! * s[i10 + 3]! * w10 + s[i01 + 2]! * s[i01 + 3]! * w01 + s[i11 + 2]! * s[i11 + 3]! * w11) / 255;
      const o = (y * dst.width + x) * 4;
      const da = d[o + 3]! / 255;
      const outA = a + da * (1 - a);
      if (outA <= 0) continue;
      d[o] = (pr + d[o]! * da * (1 - a)) / outA;
      d[o + 1] = (pg + d[o + 1]! * da * (1 - a)) / outA;
      d[o + 2] = (pb + d[o + 2]! * da * (1 - a)) / outA;
      d[o + 3] = outA * 255;
    }
  }
}
