/* ============================================================
   表情包制作的违禁词打码（纯前端）：命中的字换成等长的 *。
   词表不能以明文出现，所以打包进来的只是摘要表（banwords.json，由 tools/banwords.mjs 生成）：
   每个词 SHA-256(salt + 归一化后的词) 取前 8 字节。打码时对输入文字的每一段子串算同样的摘要去比。
   规则仿小维 bot 的 replace_ban_words：词按长度从长到短，每个长度从左往右扫，命中就整段换成 *、跳过这一段接着扫；
   另外英文不分大小写、全角字母数字当半角（逐字对应，* 的个数和原文字数一致）。
   ============================================================ */
import { createRequire } from 'node:module';
const TABLE: BanTable = createRequire(import.meta.url)('./banwords.json');

export interface BanTable {
  version: string;
  salt: string;
  /** 词表里出现过的长度（字数），从长到短 */
  lens: number[];
  /** 摘要（16 位十六进制），已排序 */
  h: string[];
}

/** 逐字归一化：全角 ASCII → 半角，全角空格 → 空格，英文字母转小写（和 tools/banwords.mjs 一致） */
export function fold(ch: string): string {
  let c = ch.codePointAt(0)!;
  if (c >= 0xff01 && c <= 0xff5e) c -= 0xfee0;
  else if (c === 0x3000) c = 0x20;
  if (c >= 0x41 && c <= 0x5a) c += 0x20;
  return String.fromCodePoint(c);
}

/* ---------- SHA-256（同步，不依赖 crypto.subtle：局域网 http 打开也能用） ---------- */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const enc = new TextEncoder();

export function sha256Hex(s: string): string {
  const msg = enc.encode(s);
  const len = ((msg.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(len - 4, msg.length * 8);
  dv.setUint32(len - 8, Math.floor(msg.length / 0x20000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rot = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < len; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15]!, b = W[i - 2]!;
      W[i] = (W[i - 16]! + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + W[i - 7]! + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const t1 = (h! + (rot(e!, 6) ^ rot(e!, 11) ^ rot(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[i]! + W[i]!) >>> 0;
      const t2 = ((rot(a!, 2) ^ rot(a!, 13) ^ rot(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0;
      h = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0]! += a!; H[1]! += b!; H[2]! += c!; H[3]! += d!; H[4]! += e!; H[5]! += f!; H[6]! += g!; H[7]! += h!;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** 一个词（已归一化）的摘要：SHA-256(salt + 词) 前 8 字节 */
export const digest = (salt: string, folded: string): string => sha256Hex(salt + folded).slice(0, 16);

const sets = new WeakMap<BanTable, Set<string>>();

/** 打码：返回打码后的文字和有没有命中。表是空的就原样返回 */
export function maskText(text: string, table: BanTable = TABLE as BanTable): { text: string; masked: boolean } {
  if (!text || !table.h.length) return { text, masked: false };
  let set = sets.get(table);
  if (!set) sets.set(table, (set = new Set(table.h)));
  const out = Array.from(text);
  const norm = out.map(fold);
  let masked = false;
  for (const L of table.lens) {
    for (let i = 0; i + L <= norm.length; ) {
      if (set.has(digest(table.salt, norm.slice(i, i + L).join('')))) {
        for (let j = i; j < i + L; j++) out[j] = norm[j] = '*';
        masked = true;
        i += L;
      } else i++;
    }
  }
  return { text: out.join(''), masked };
}
