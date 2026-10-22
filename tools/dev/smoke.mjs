// Fake-ctx smoke test of the dsh adapter against the real defineTool / schemastery packages.
// usage: node tools/dev/smoke.mjs DATA_DIR
import { join } from 'node:path'
const root = new URL('../../', import.meta.url).pathname
const plugin = await import(join(root, 'lib/index.js'))
const { validateJsonSchemaValue } = await import(join(root, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js'))
const config = plugin.Config({ dataDir: process.argv[2], publicBaseUrl: 'http://127.0.0.1:3180', promptMode: 'index', indexLimit: 3 })
const tools = new Map(), injects = [], provided = {}
const sections = []
const ctx = {
  logger: () => ({ warn: console.warn, info() {}, debug() {}, error: console.error }),
  tools: { register: (d) => { tools.set(d.name, d); return () => {} } },
  provide: (n, v) => { provided[n] = v; return () => {} },
  get: () => undefined,
  inject: (names, cb) => { injects.push(names.join(',')); if (names[0] === 'systemPrompt') cb({ effect: (f) => f(), systemPrompt: { section: (s) => sections.push(s) } }) },
  effect: (fn) => fn(),
  plugin: (p) => { p.apply(ctx); return { dispose: async () => {} } },
}
plugin.apply(ctx, config)
console.log('tools:', [...tools.keys()].join(', '), '| injects:', injects.join(' ; '), '| provides:', Object.keys(provided))
const schemaChars = JSON.stringify([...tools.values()].map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))).length
console.log('tool schema chars:', schemaChars)
async function call(name, args) {
  const t = tools.get(name)
  const argErrors = validateJsonSchemaValue(t.parameters, args, '')
  if (argErrors.length) return console.log(name, 'ARG ERRORS', argErrors)
  try {
    const value = await t.execute(args, { signal: new AbortController().signal })
    const outErrors = validateJsonSchemaValue(t.output.schema, value, '')
    console.log(`> ${name} ${JSON.stringify(args)}\n${t.output.render(args, value).map((b) => b.text ?? `[${b.type}]`).join('\n')}${outErrors.length ? `\nOUTPUT ERRORS ${outErrors}` : ''}`)
  } catch (e) { console.log(`> ${name} threw: ${e.message}`) }
}
await call('sticker_search', { query: '下班 开心' })
await call('sticker_send', { name: '摸鱼' })
await call('sticker_send', { name: 'TT01_钻戒求婚' })
await call('meme_render', { template: '大肥鱼想', text: '加班' })
await call('sticker_manage', { action: 'info', names: ['3TT06_当场抓获'] })
await call('sticker_manage', { action: 'mode', mode: 'allowlist' })
await call('sticker_manage', { action: 'enable', names: ['3N05_摸鱼', '12N11_害羞', 'TT02_比心'] })
await call('sticker_search', { query: '' })
await new Promise((r) => setTimeout(r, 200))
console.log('index hint:', JSON.stringify(sections[0]?.text()))
await call('sticker_manage', { action: 'browse', offset: 0 })
await call('sticker_manage', { action: 'reset' })
await call('sticker_manage', { action: 'credit' })
const segs = await provided.stickers.parseReply('好的[sticker:摸鱼]收到[表情:不存在]')
console.log('parseReply:', JSON.stringify(segs.map((s) => s.type === 'sticker' ? { type: s.type, id: s.sticker.id } : s)))
