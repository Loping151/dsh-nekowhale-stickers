// Dependency-free scoring search tuned for short Chinese queries.
// Each query term is matched as a substring against weighted fields; CJK terms that miss as a whole
// fall back to bigram overlap, so 想摸鱼 still finds 摸鱼 and 上班不想动 finds 上班.
import type { Sticker } from './types.js'

const WEIGHTS: [keyof Sticker | 'tagsJoined', number][] = [
  ['name', 6], ['tagsJoined', 5], ['emotion', 4], ['text', 4], ['meme', 3], ['use', 3], ['en', 2], ['desc', 1], ['dir', 2],
]

const CJK = /[㐀-鿿豈-﫿]/u

export function terms(query: string): string[] {
  return query.toLowerCase().split(/[\s,，。.!！?？、;；:：/|]+/u).filter(Boolean)
}

function bigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2))
  return out
}

export function fields(s: Sticker): Record<string, string> {
  return {
    name: s.name, tagsJoined: (s.tags ?? []).join(' '), emotion: s.emotion ?? '', text: s.text ?? '',
    meme: s.meme ?? '', use: s.use ?? '', en: s.en ?? '', desc: s.desc ?? '', dir: s.dir ?? '',
  }
}

export function score(s: Sticker, qs: string[], cache?: Map<string, Record<string, string>>): number {
  let f = cache?.get(s.id)
  if (!f) {
    f = Object.fromEntries(Object.entries(fields(s)).map(([k, v]) => [k, v.toLowerCase()]))
    cache?.set(s.id, f)
  }
  let total = 0
  let matched = 0
  for (const q of qs) {
    let best = 0
    for (const [key, w] of WEIGHTS) {
      const v = f[key as string] ?? ''
      if (!v) continue
      if (v.includes(q)) best = Math.max(best, w * (v === q ? 1.5 : 1))
      else if (CJK.test(q) && q.length > 2) {
        const bg = bigrams(q)
        const hit = bg.filter((b) => v.includes(b)).length
        if (hit) best = Math.max(best, (w * hit) / bg.length * 0.8)
      }
    }
    total += best
    if (best > 0) matched++
  }
  // Prefer stickers that satisfy every term of the query over ones that match a single term strongly.
  return qs.length > 1 ? total * (matched / qs.length) ** 2 : total
}
