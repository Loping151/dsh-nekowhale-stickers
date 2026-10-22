#!/usr/bin/env node
// Standalone CLI over StickerKit, so bots in any language can shell out to it.
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StickerKit } from './core/index.js'

const USAGE = `nekowhale-stickers <command> [args] [--data DIR] [--site URL] [--packs a,b] [--json]
  sync                       download / update every sticker (incremental)
  search <query> [-n N]      find stickers for a mood or situation
  get <name>                 print the local GIF path (downloads it if needed)
  info <name>                full knowledge entry
  templates                  list text / avatar templates
  render <template> [text] [--image FILE] [-o OUT.gif]
  credit                     attribution line
  index [--pack P]           one line per enabled sticker, for a prompt
  categories                 emotion categories with counts ([sticker:<emotion>] picks one at random)
  mcp [--images]             serve the kit as an MCP server over stdio`

const argv = process.argv.slice(2)
const flags: Record<string, string | boolean> = {}
const pos: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--json') flags.json = true
  else if (a === '--images') flags.images = true
  else if (a.startsWith('-')) flags[a.replace(/^-+/u, '')] = argv[++i] ?? ''
  else pos.push(a)
}
const json = flags.json === true
const out = (v: unknown, text: string) => console.log(json ? JSON.stringify(v, null, 1) : text)

const kit = new StickerKit({
  dataDir: String(flags.data ?? process.env.NEKOWHALE_DATA ?? join(homedir(), '.nekowhale-stickers')),
  ...(flags.site ? { site: String(flags.site) } : {}),
  ...(flags.packs ? { packs: String(flags.packs).split(',') } : {}),
  bundledMeta: fileURLToPath(new URL('../meta/nekowhale.json', import.meta.url)),
  log: (m) => { if (!json && process.env.NEKOWHALE_QUIET !== '1') console.error(m) },
})

const [cmd, ...rest] = pos
switch (cmd) {
  case 'sync': {
    const r = await kit.sync()
    out(r, `v${r.manifestVersion}: ${r.total} stickers, ${r.downloaded.length} downloaded, ${r.removed.length} removed, ${r.failed.length} failed`)
    break
  }
  case 'search': {
    const hits = await kit.search(rest.join(' '), { limit: Number(flags.n ?? 8), shuffle: false })
    out(hits.map((h) => ({ ...h.sticker, score: h.score })), hits.map((h) => kit.line(h.sticker)).join('\n'))
    break
  }
  case 'get': {
    const { path, sticker } = await kit.file(rest.join(' '))
    out({ path, ...sticker }, path)
    break
  }
  case 'info': {
    const s = await kit.resolve(rest.join(' '))
    if (!s) throw new Error('unknown sticker')
    out(s, kit.line(s, 'full'))
    break
  }
  case 'templates': {
    const ts = await kit.templates()
    out(ts, ts.map((t) => `${t.title}  (${t.id}, ${t.input})`).join('\n'))
    break
  }
  case 'render': {
    const [tpl, ...text] = rest
    const image = flags.image ? await readFile(String(flags.image)) : undefined
    const r = await kit.render(tpl, { text: text.join(' '), image })
    if (flags.o) await writeFile(String(flags.o), r.data)
    const { data: _d, ...meta } = r
    out(meta, flags.o ? String(flags.o) : r.path)
    break
  }
  case 'credit':
    await kit.ready()
    out(kit.attribution, kit.attribution.text)
    break
  case 'index': {
    const list = (await kit.all()).filter((s) => !flags.pack || s.pack === flags.pack)
    out(list.map((s) => s.id), list.map((s) => kit.line(s)).join('\n'))
    break
  }
  case 'categories': {
    const counts = new Map<string, number>()
    for (const s of await kit.all()) counts.set(s.emotion ?? '其他', (counts.get(s.emotion ?? '其他') ?? 0) + 1)
    const rows = [...counts].sort((a, b) => b[1] - a[1])
    out(Object.fromEntries(rows), rows.map(([k, n]) => `${k} ${n}`).join('\n'))
    break
  }
  case 'mcp': {
    const { serveMcp } = await import('./mcp.js')
    await serveMcp(kit, { images: flags.images === true })
    break
  }
  default:
    console.log(USAGE)
    process.exitCode = cmd ? 1 : 0
}
