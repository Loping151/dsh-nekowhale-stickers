// Minimal MCP server over stdio (newline-delimited JSON-RPC), no SDK dependency.
// Any MCP host (LangBot, NoneBot / AstrBot LLM plugins, Claude / Cursor style clients, ...) can use the kit.
// In chat bots the host sends the returned file path or URL itself; tool images only reach the model.
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { loadImageInput, type StickerKit } from './core/index.js'

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const TOOLS = [
  {
    name: 'sticker_search',
    description: 'Find reaction stickers of 大肥鱼 (DeepSeek whale girl) and GPT娘 for a mood or situation. One line each: name｜emotion｜tags｜direction.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Chinese mood / situation words, e.g. 摸鱼 被夸. Empty: random.' }, limit: { type: 'integer' }, emotion: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'sticker_get',
    description: 'Get a sticker by name (or an emotion word for a random one): local GIF path, public URL and meaning. Send the file yourself.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'meme_render',
    description: 'Render a custom sticker: 大肥鱼想 / 举牌 / 葱卷 / 上联 / 下联 with short text, or 大肥鱼抱 with an avatar image path or URL. Returns the GIF path.',
    inputSchema: { type: 'object', properties: { template: { type: 'string' }, text: { type: 'string' }, image: { type: 'string' } }, required: ['template'] },
  },
  {
    name: 'sticker_info',
    description: 'Full description, meme reference and direction of stickers, plus the author credit.',
    inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] },
  },
]

export async function serveMcp(kit: StickerKit, opts: { images?: boolean } = {}) {
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n')
  const text = (t: string) => ({ content: [{ type: 'text', text: t }] })

  async function call(name: string, a: any) {
    switch (name) {
      case 'sticker_search': {
        const hits = await kit.search(a.query ?? '', { limit: a.limit ?? 5, emotion: a.emotion })
        return text(hits.length ? hits.map((h) => kit.line(h.sticker)).join('\n') : '没有匹配的表情，换个情绪词再试。')
      }
      case 'sticker_get': {
        const s = await kit.pick(String(a.name ?? ''))
        if (!s) throw new Error(`unknown sticker ${a.name}`)
        const { path } = await kit.file(s)
        const out: any = text(JSON.stringify({ name: s.stem, path, url: kit.url(s), mime: 'image/gif', emotion: s.emotion, use: s.use, dir: s.dir || undefined }))
        if (opts.images) out.content.push({ type: 'image', mimeType: 'image/gif', data: (await readFile(path)).toString('base64') })
        return out
      }
      case 'meme_render': {
        const image = a.image ? await loadImageInput(String(a.image)) : undefined
        const r = await kit.render(String(a.template), { text: a.text, image })
        return text(JSON.stringify({ path: r.path, mime: r.mime, template: r.template.title, masked: r.masked }))
      }
      case 'sticker_info': {
        const lines: string[] = []
        for (const n of a.names ?? []) {
          const s = await kit.resolve(n)
          lines.push(s ? kit.line(s, 'full') : `${n}: unknown`)
        }
        return text([...lines, '', kit.attribution.text].join('\n'))
      }
    }
    throw new Error(`unknown tool ${name}`)
  }

  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    if (!line.trim()) continue
    let msg: any
    try { msg = JSON.parse(line) } catch { continue }
    const { id, method, params } = msg
    if (id === undefined) continue // notifications
    try {
      if (method === 'initialize') {
        await kit.ready()
        send({ jsonrpc: '2.0', id, result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'nekowhale-stickers', version: VERSION },
          instructions: `Stickers of 大肥鱼 / GPT娘: sticker_search, then sticker_get and send the returned file. In plain-text replies a bridge may expand [sticker:name]. At most one sticker per reply. ${kit.attribution.text}`,
        } })
      } else if (method === 'tools/list') send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
      else if (method === 'tools/call') {
        try {
          send({ jsonrpc: '2.0', id, result: await call(params?.name, params?.arguments ?? {}) })
        } catch (e) {
          send({ jsonrpc: '2.0', id, result: { ...text(String((e as Error).message ?? e)), isError: true } })
        }
      } else if (method === 'ping') send({ jsonrpc: '2.0', id, result: {} })
      else send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: String((e as Error).message ?? e) } })
    }
  }
}
