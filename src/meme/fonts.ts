import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { GlobalFonts } from '@napi-rs/canvas';
import type { Fetcher } from './types.js';

const context = new AsyncLocalStorage<{ fetch: Fetcher; families: Map<string, string[]> }>();
const registered = new Set<string>();
export function withFonts<T>(fetch: Fetcher, work: () => Promise<T>): Promise<T> {
  return context.run({ fetch, families: new Map() }, work);
}
export function fontFamilies(family: string): string {
  return (context.getStore()?.families.get(family) ?? [family]).map(f => JSON.stringify(f)).join(',');
}
/** Separate aliases preserve every chunk: registering subsets under one name can replace prior subsets in Skia. */
export async function ensureFont(family: string, _weight: number, text: string): Promise<void> {
  const state = context.getStore();
  if (!state) throw new Error('Font loading requires a render context');
  const dir = family === 'Kai' ? 'kai' : 'notoblack';
  try {
    const css = (await state.fetch(`fonts/${dir}/fonts.css`)).toString('utf8');
    const cps = Array.from(text || '字', c => c.codePointAt(0)!);
    const names: string[] = [];
    for (const face of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
      const path = /url\(['"]?([^)'"\s]+)['"]?\)/.exec(face[1])?.[1];
      const ranges = /unicode-range\s*:\s*([^;]+)/i.exec(face[1])?.[1];
      if (!path || !ranges) continue;
      const covers = ranges.split(',').some(range => {
        const m = /U\+([\dA-F?]+)(?:-([\dA-F]+))?/i.exec(range);
        if (!m) return false;
        const low = parseInt(m[1].replace(/\?/g,'0'),16), high = parseInt(m[2] ?? m[1].replace(/\?/g,'F'),16);
        return cps.some(cp => cp>=low && cp<=high);
      });
      if (!covers) continue;
      const rel = path.startsWith('/') ? path.slice(1) : `fonts/${dir}/${path}`;
      const data = await state.fetch(rel);
      const alias = `Meme_${family}_${createHash('sha256').update(data).digest('hex')}`;
      if (!registered.has(alias)) {
        if (!GlobalFonts.register(data,alias)) throw new Error(`Cannot load ${rel}`);
        registered.add(alias);
      }
      names.push(alias);
    }
    state.families.set(family,names.length ? names : [family]);
  } catch {
    // Same behavior as the site: network/font failure falls back to installed fonts.
    state.families.set(family,[family]);
  }
}
