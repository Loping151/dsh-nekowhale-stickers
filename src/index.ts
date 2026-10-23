// dsh (DeepSeek Harness) plugin: a thin cordis adapter over the framework-neutral StickerKit.
// Named exports only. Do not add `export default`: the dsh loader prefers it and drops inject / Config.
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { StickerKit, DEFAULT_PACKS, DEFAULT_SITE, loadImageInput } from './core/index.js'
import type { Sticker } from './core/index.js'

export * from './core/index.js'

export const name = 'nekowhale-stickers'
export const inject = ['tools']
/** Other plugins can `inject: ['stickers']` and call `ctx.stickers.search()`, `.file()`, `.parseReply()`, ... */
export const provide = 'stickers'

export interface Config {
  site: string
  packs: string[]
  dataDir?: string
  autoSync: 'startup' | 'lazy' | 'off'
  refreshHours: number
  metaPath: string
  blacklist: string[]
  whitelist: string[]
  persona: 'self' | 'neutral'
  promptMode: 'skill' | 'hint' | 'index' | 'off'
  frequency: 'rare' | 'normal' | 'often'
  indexLimit: number
  agentCuration: boolean
  templates: boolean
  banwords: boolean
  searchLimit: number
  returnImageToModel: boolean
  pet: boolean
  petHeight: number
  petBubbles: boolean
  publicBaseUrl?: string
  routePath: string
}

// dsh 0.2 edits a plugin's `.volatile()` fields on its Plugins page and hands them over as references that it
// updates in place; dsh 0.1.5 (whose schemastery may predate volatile) passes plain values.
const live = <S,>(s: S): S => (typeof (s as any).volatile === 'function' ? (s as any).volatile() : s)
const plain = (v: unknown): unknown => (v !== null && typeof v === 'object' && typeof (v as any).get === 'function' ? (v as any).get() : v)

// One flat object: dsh 0.2 only edits volatile fields on a fixed object path (not inside an intersect).
export const Config: Schema<Config> = Schema.object({
  // Source
  site: Schema.string().default(DEFAULT_SITE).description('Sticker site origin.'),
  packs: Schema.array(String).default(DEFAULT_PACKS).description('Packs to serve (showcase names on the site).'),
  dataDir: Schema.string().description('Writable data directory. Default: $DSH_HOME/nekowhale-stickers.'),
  autoSync: Schema.union(['startup', 'lazy', 'off']).default('lazy')
    .description('startup: mirror all GIFs in the background; lazy: download each GIF on first use; off: no network.'),
  refreshHours: Schema.natural().default(6).description('How often to re-check the manifest, knowledge file and templates.'),
  metaPath: Schema.string().default('meme/kit/nekowhale.json').description('Site path of the hosted knowledge file. Empty: bundled copy only.'),
  // Selection
  blacklist: live(Schema.array(String).default([]).description('Always hide. Rules: id, file stem, code, name, or pack:/tag:/emotion:/group: prefixed, e.g. tag:舌吻.')),
  whitelist: live(Schema.array(String).default([]).description('If not empty, only stickers matching a rule exist.')),
  agentCuration: live(Schema.boolean().default(true).description('Let the agent browse and switch stickers on or off for itself (sticker_manage).')),
  // Prompt and tokens
  persona: live(Schema.union(['self', 'neutral']).default('self')
    .description('self: the agent is 大肥鱼 (DeepSeek as a girl) and the stickers are its own expressions; neutral: a third-party sticker pack, for non-DeepSeek models.')),
  promptMode: live(Schema.union(['skill', 'hint', 'index', 'off']).default('skill')
    .description('skill: only the skill catalog line (~60 tokens); hint: plus a one-line system hint; index: plus a compact list of enabled stickers; off: tools only.')),
  frequency: live(Schema.union(['rare', 'normal', 'often']).default('normal').description('How eagerly the hint asks the agent to use stickers.')),
  indexLimit: live(Schema.natural().default(40).description('index mode: at most this many stickers are listed (pick favourites with sticker_manage first).')),
  searchLimit: live(Schema.natural().min(1).max(20).default(5).description('Default search results.')),
  returnImageToModel: live(Schema.boolean().default(false).description('Attach the picture to tool results so the model can see it (costs image tokens).')),
  // Templates
  templates: live(Schema.boolean().default(true).description('Enable meme_render (text / avatar templates, rendered locally).')),
  banwords: live(Schema.boolean().default(true).description('Mask banned words in rendered memes, like the website does.')),
  // Web pet
  pet: live(Schema.boolean().default(true).description('Show the kiriyuki.com web pet (大肥鱼) floating in the web UI. Turning it off hides it within seconds.')),
  petHeight: live(Schema.natural().min(120).max(480).default(211).description('Pet height in CSS pixels.')),
  petBubbles: live(Schema.boolean().default(true).description('Speech bubbles (about 1.5 MB more to load).')),
  // Web UI
  publicBaseUrl: Schema.string().description('Origin used in image links, e.g. http://127.0.0.1:3180. Default: the dsh web server.'),
  routePath: Schema.string().default('/x-nekowhale-stickers').description('HTTP route that serves images to the web UI.'),
}) as Schema<Config>

// What the web UI settings page edits (dsh: Settings → Plugins). dsh stores the user's values in
// $DSH_HOME/settings.yaml on top of the cordis.patch.yml config, and pushes changes live.
const LIVE_KEYS = ['pet', 'petHeight', 'petBubbles', 'persona', 'promptMode', 'frequency', 'indexLimit',
  'searchLimit', 'returnImageToModel', 'agentCuration', 'templates', 'banwords', 'blacklist', 'whitelist'] as const
type Live = Pick<Config, typeof LIVE_KEYS[number]>

export const Settings = Schema.intersect([
  Schema.object({
    pet: Schema.boolean().default(true).description('在网页界面显示大肥鱼桌宠'),
    petHeight: Schema.natural().min(120).max(480).default(211).description('桌宠大小（高度，像素）'),
    petBubbles: Schema.boolean().default(true).description('桌宠对话气泡'),
  }).description('网页桌宠'),
  Schema.object({
    persona: Schema.union(['self', 'neutral']).default('self').description('模型身份'),
    promptMode: Schema.union(['skill', 'hint', 'index', 'off']).default('skill').description('常驻提示'),
    frequency: Schema.union(['rare', 'normal', 'often']).default('normal').description('发表情的频率（提示模式为 hint / index 时生效）'),
    indexLimit: Schema.natural().default(40).description('index 模式最多列出的表情数'),
  }).description('角色与提示'),
  Schema.object({
    searchLimit: Schema.natural().min(1).max(20).default(5).description('每次搜索返回的条数'),
    returnImageToModel: Schema.boolean().default(false).description('把图片附给模型看（消耗图像 token）'),
    agentCuration: Schema.boolean().default(true).description('允许 agent 自己挑选、开关表情'),
    templates: Schema.boolean().default(true).description('启用模板制图（想 / 举牌 / 葱卷 / 对联 / 抱）'),
    banwords: Schema.boolean().default(true).description('模板文字自动屏蔽敏感词'),
    blacklist: Schema.array(String).default([]).description('黑名单：一行一条，名字、编号或 tag: / pack: / emotion: 前缀'),
    whitelist: Schema.array(String).default([]).description('白名单：非空时只使用匹配的表情'),
  }).description('表情'),
]) as Schema<Live>

// kiriyuki.com lets any origin use this one character without a key; the others need authorization.
const PET_CHARACTER = 'dafeiyu'

const SKILL_DIR = fileURLToPath(new URL('../skills/nekowhale-stickers/', import.meta.url))
const SKILL_FILE = fileURLToPath(new URL('../skills/nekowhale-stickers/SKILL.md', import.meta.url))
const BUNDLED_META = fileURLToPath(new URL('../meta/nekowhale.json', import.meta.url))

const TEXT_OUT = {
  schema: { type: 'object', additionalProperties: true, properties: { text: { type: 'string', required: true } } },
  render: (_args: unknown, v: { text: string; image?: Record<string, unknown> }): any[] => [
    { type: 'text' as const, text: v.text },
    ...(v.image ? [{ type: 'image' as const, attachment: { ...v.image } }] : []),
  ],
} as const

const HINTS = {
  rare: '仅在气氛特别合适时偶尔用 sticker_search / sticker_send 发个表情。',
  normal: '闲聊、调侃、庆祝、安慰时可以用 sticker_search 找表情、sticker_send 直接发出，别每句都发。',
  often: '多用表情表达情绪：先 sticker_search 再 sticker_send，闲聊里大约每两三条回复发一个。',
}

// Who the stickers belong to. dsh normally runs DeepSeek, and 大肥鱼 *is* DeepSeek as a girl, so by default
// the agent speaks as her; describing her in the third person made models say "let me use 大肥鱼 to send you one".
const PERSONA = {
  self: {
    catalog: 'Your own reaction stickers: you are 大肥鱼, the DeepSeek whale girl (duo set with GPT娘), plus custom text memes. Use in casual chat and emotional replies, or when asked for 表情包 / stickers.',
    search: 'Find your own reaction stickers (you are 大肥鱼; duo set with GPT娘) for a mood or situation. Lines: name｜emotion｜tags｜direction. Then sticker_send.',
    hint: '你就是大肥鱼（拟人化的 DeepSeek），这些表情是你自己的表情。',
    skill: `## 你是谁
你就是**大肥鱼**：拟人化的 DeepSeek（鲸鱼娘，深蓝长发、女仆头饰）。这些表情就是你自己的表情和动作，发出去等于你本人在做这个表情。
- 像聊天时随手甩表情一样直接发；不要说“用大肥鱼给你发”“要我发表情吗”，也不要预告或解释自己要发表情。
- 双人套组 \`大肥鱼和GPT娘\` 里你是大肥鱼，**GPT娘**（白发龙娘：龙角、OpenAI 发饰，拟人化的 ChatGPT）是另一方：可以代表聊天对象，也可以就是在说 ChatGPT。按方向选：\`大肥鱼→GPT娘\` 是你对对方做，\`GPT娘→大肥鱼\` 是对方对你做。`,
  },
  neutral: {
    catalog: 'Reaction stickers of 大肥鱼 (DeepSeek whale girl) and GPT娘, plus custom text memes. Use for casual chat, emotional replies, or when the user asks for 表情包 / stickers / memes.',
    search: 'Find reaction stickers (大肥鱼, GPT娘) for a mood or situation. Lines: name｜emotion｜tags｜direction. Then sticker_send.',
    hint: '可以发大肥鱼 / GPT娘表情包。',
    skill: `## 角色
**大肥鱼**＝拟人化的 DeepSeek 鲸鱼娘（深蓝长发、女仆头饰）；**GPT娘**＝拟人化的 ChatGPT（白发龙娘：龙角、OpenAI 发饰）。
双人套组的表情有方向，搜索结果最后一栏写明谁对谁做（如 \`大肥鱼→GPT娘\`）。直接发表情即可，不要预告或询问是否要发。`,
  },
}

function splitSkill(text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(text)
  if (!m) throw new Error('SKILL.md is missing frontmatter')
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/u)) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/u.exec(line)
    if (kv) meta[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/u, '$2')
  }
  return { meta, body: text.slice(m[0].length) }
}

export function apply(ctx: any, config: Config) {
  const log = ctx.logger('nekowhale-stickers')
  // Current options: cordis.patch.yml config, overridden by the web UI settings once dsh hands them over.
  // Read on use, never copied, so changes apply live.
  let source: () => Partial<Live> = () => ({})
  const opts = () => Object.fromEntries(Object.entries(config).map(([k, v]) => [k, plain(v)])) as unknown as Config
  const cur = (): Config => ({ ...opts(), ...source() })
  const start = cur()
  const kit = new StickerKit({
    site: config.site, packs: config.packs, dataDir: config.dataDir ?? dshHomePath('nekowhale-stickers'),
    bundledMeta: BUNDLED_META, metaPath: config.metaPath, autoSync: config.autoSync, refreshHours: config.refreshHours,
    blacklist: start.blacklist, whitelist: start.whitelist, banwords: start.banwords,
    log: (m, level) => (level === 'warn' ? log.warn(m) : log.info(m)),
  })
  ctx.provide('stickers', kit)
  void kit.ready().catch((e) => log.warn('initial load failed: %s', e))

  // ---------------------------------------------------------------- links
  const origin = () => {
    if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/+$/u, '')
    const port = ctx.get('webServer')?.port
    return port === undefined ? undefined : `http://127.0.0.1:${port}`
  }
  const link = (alt: string, route: string, fsPath: string) => {
    const base = origin()
    return base === undefined ? `![${alt}](${fsPath})` : `![${alt}](${base}${config.routePath}${route})`
  }

  async function imageForModel(path: string) {
    if (!cur().returnImageToModel) return undefined
    const attachments = ctx.get('attachments')
    if (!attachments) return undefined
    // Best effort: the Markdown line is the real result, so a failed attachment must not fail the tool.
    const ref = await attachments.saveImage({ data: await readFile(path), mediaType: 'image/gif', name: path.split(/[\\/]/u).pop() })
    return { attachmentId: String(ref.attachmentId), mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height }
  }
  const tryImageForModel = (path: string) => imageForModel(path).catch((e) => { log.warn('image for model: %s', e); return undefined })

  const footer = '把上面这行原样放进回复即可显示。'

  // ---------------------------------------------------------------- agent surface (tools + prompt)
  // Which tools exist and the prompt pieces depend on settings, so they live in an inner plugin that is
  // remounted when one of those settings changes; everything else reads cur() on use.
  const Agent = {
    name: 'nekowhale-stickers-agent',
    inject: ['tools'],
    apply(actx: any) {
      const c = cur()
    actx.tools.register(defineTool({
      name: 'sticker_search',
      description: PERSONA[c.persona].search,
      parameters: {
        query: { type: 'string', required: true, description: 'Chinese mood / situation words, e.g. 摸鱼 被夸. Empty: random.' },
        limit: { type: 'integer' },
        emotion: { type: 'string' },
      },
      output: TEXT_OUT,
      isConcurrencySafe: () => true,
      async execute(args: { query: string; limit?: number; emotion?: string }) {
        const hits = await kit.search(args.query ?? '', { limit: args.limit ?? cur().searchLimit, emotion: args.emotion })
        if (hits.length === 0) return { text: '没有匹配的表情，换个情绪词再试。' }
        return { text: hits.map((h) => kit.line(h.sticker)).join('\n') }
      },
    }))

    actx.tools.register(defineTool({
      name: 'sticker_send',
      description: 'Send a sticker by name from sticker_search (an emotion word picks a random one). Returns a Markdown image line to paste into your reply.',
      parameters: { name: { type: 'string', required: true } },
      output: TEXT_OUT,
      isConcurrencySafe: () => true,
      async execute(args: { name: string }) {
        const s = await kit.pick(args.name)
        if (!s) throw new Error(`unknown sticker "${args.name}"; call sticker_search first`)
        if (!kit.isEnabled(s)) throw new Error(`sticker "${s.stem}" is switched off`)
        const { path } = await kit.file(s)
        const image = await tryImageForModel(path)
        return { text: `${link(s.name || s.stem, `/s/${s.hash}.gif`, path)}\n${footer}`, ...(image ? { image } : {}) }
      },
    }))

    if (c.templates) {
      actx.tools.register(defineTool({
        name: 'meme_render',
        description: 'Custom sticker from a template: 大肥鱼想 / 举牌 / 葱卷 / 上联 / 下联 (text), 大肥鱼抱 (avatar image). Returns a Markdown image line.',
        parameters: {
          template: { type: 'string', required: true, description: 'e.g. 大肥鱼举牌' },
          text: { type: 'string', description: 'Short text.' },
          image: { type: 'string', description: '大肥鱼抱: avatar image file path or public URL.' },
        },
        output: TEXT_OUT,
        timeoutMs: 60000,
        async execute(args: { template: string; text?: string; image?: string }, exec: any) {
          const image = args.image ? await loadImageInput(args.image, { signal: exec?.signal }) : undefined
          const r = await kit.render(args.template, { text: args.text, image })
          const extra = await tryImageForModel(r.path)
          const note = r.masked ? '\n(部分词语已按网站规则屏蔽)' : ''
          return { text: `${link(r.template.title, `/r/${r.id}.gif`, r.path)}\n${footer}${note}`, ...(extra ? { image: extra } : {}) }
        },
      }))
    }

    if (c.agentCuration) {
      actx.tools.register(defineTool({
        name: 'sticker_manage',
        description: 'Browse and curate stickers: browse, info, enable/disable (names), mode (all|allowlist), reset, templates, credit, sync.',
        parameters: {
          action: { type: 'string', required: true, enum: ['browse', 'info', 'enable', 'disable', 'mode', 'reset', 'templates', 'credit', 'sync'] },
          names: { type: 'array', items: { type: 'string' } },
          mode: { type: 'string', enum: ['all', 'allowlist'] },
          pack: { type: 'string' },
          offset: { type: 'integer' },
          all: { type: 'boolean' },
        },
        output: TEXT_OUT,
        async execute(a: { action: string; names?: string[]; mode?: 'all' | 'allowlist'; pack?: string; offset?: number; all?: boolean }) {
          switch (a.action) {
            case 'browse': {
              const list = (await kit.all(!a.all)).filter((s) => !a.pack || s.pack === a.pack)
              const off = Math.max(0, a.offset ?? 0)
              const page = list.slice(off, off + 60)
              const st = kit.getState()
              const head = `mode=${st.mode} 共${list.length}个，显示 ${off}-${off + page.length}${off + page.length < list.length ? `，下一页 offset=${off + page.length}` : ''}`
              return { text: [head, ...page.map((s) => (kit.isEnabled(s) ? '' : '[off] ') + kit.line(s))].join('\n') }
            }
            case 'info': {
              const out: string[] = []
              for (const n of a.names ?? []) {
                const s = await kit.resolve(n)
                out.push(s ? kit.line(s, 'full') : `${n}: unknown`)
              }
              return { text: out.join('\n') || 'names required' }
            }
            case 'enable':
            case 'disable': {
              const r = await kit.setEnabled(a.names ?? [], a.action === 'enable')
              const st = kit.getState()
              return { text: `changed ${r.changed.length}${r.unknown.length ? `, unknown: ${r.unknown.join(',')}` : ''}; mode=${st.mode}, on-list ${st.enabled.length}, off-list ${st.disabled.length}` }
            }
            case 'mode':
              if (!a.mode) throw new Error('mode required')
              await kit.setMode(a.mode)
              return { text: `mode=${a.mode}${a.mode === 'allowlist' ? ' (only stickers you enable are used)' : ''}` }
            case 'reset':
              await kit.resetState()
              return { text: 'reset: every sticker enabled' }
            case 'templates':
              return { text: (await kit.templates()).map((t) => `${t.title}｜${t.input === 'image' ? '需要头像图片' : `文字≤${t.maxLen}，默认“${t.defaultText}”`}`).join('\n') || 'no templates' }
            case 'credit':
              return { text: [kit.attribution.text, ...kit.packInfo.map((p) => `${p.title}: ${p.showcase}`)].join('\n') }
            case 'sync': {
              const r = await kit.sync()
              return { text: `manifest v${r.manifestVersion}: ${r.total} stickers, ${r.downloaded.length} downloaded, ${r.removed.length} removed, ${r.failed.length} failed` }
            }
          }
          throw new Error(`unknown action ${a.action}`)
        },
      }))
    }

    if (c.promptMode === 'hint' || c.promptMode === 'index') {
      actx.inject(['systemPrompt'], (pctx: any) => {
        // Recomputed only when the selection changes, so the prompt prefix stays byte-identical (KV cache).
        let indexText = ''
        const refreshIndex = async () => {
          if (c.promptMode !== 'index') return
          const list = (await kit.all()).slice(0, cur().indexLimit)
          indexText = list.length ? `\n可用表情（名｜情绪｜标签）：\n${list.map((s: Sticker) => kit.line(s)).join('\n')}` : ''
        }
        void refreshIndex().catch(() => {})
        pctx.effect(() => kit.onChange(() => void refreshIndex().catch(() => {})))
        pctx.effect(() => pctx.systemPrompt.section({
          name: 'nekowhale-stickers:hint', order: 9500, text: () => PERSONA[c.persona].hint + HINTS[cur().frequency] + indexText,
        }))
      })
    }
    },
  }
  let agentKey = ''
  let agentFiber: any
  const remountAgent = () => {
    const c = cur()
    const key = JSON.stringify([c.persona, c.promptMode, c.templates, c.agentCuration])
    if (key === agentKey) return
    agentKey = key
    void agentFiber?.dispose()
    agentFiber = ctx.plugin(Agent)
  }
  remountAgent()

  const liveKey = () => { const c = cur(); return JSON.stringify(LIVE_KEYS.map((k) => c[k])) }
  let applied = liveKey()
  const applySettings = () => {
    applied = liveKey()
    const c = cur()
    kit.configure({ blacklist: c.blacklist, whitelist: c.whitelist, banwords: c.banwords })
    remountAgent()
  }
  ctx.inject(['settings'], (sctx: any) => {
    // dsh 0.1.5 settings store.
    if (typeof sctx.settings?.installSection === 'function') {
      const base = Object.fromEntries(LIVE_KEYS.map((k) => [k, opts()[k]])) as Live
      sctx.settings.installSection(ctx, 'nekowhale-stickers', Settings, base, {
        setSource: (current: () => Partial<Live>) => { source = current },
        onChange: () => { try { applySettings() } catch (e) { log.warn('settings: %s', e) } },
      })
      return
    }
    // dsh 0.2: the Plugins page edits the volatile Config fields; the browser half draws its own form there.
    if (typeof sctx.settings?.configure === 'function') sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber))
  })
  // dsh 0.2 updates the volatile references in place without telling the plugin: look again after each
  // profile reload (a Plugins-page save is one) and, as a fallback, every few seconds.
  const recheck = () => {
    if (liveKey() === applied) return
    try { applySettings() } catch (e) { log.warn('settings: %s', e) }
  }
  ctx.on('app-boot/config-reload', recheck)
  ctx.effect(() => {
    const timer = setInterval(recheck, 2000)
    timer.unref?.()
    return () => clearInterval(timer)
  })

  // ---------------------------------------------------------------- skill (body loads on demand)
  ctx.inject(['skills'], (sctx: any) => {
    sctx.skills.registerProvider(() => ({
      name: 'nekowhale-stickers',
      async list() {
        if (cur().promptMode === 'off') return []
        const { meta } = splitSkill(await readFile(SKILL_FILE, 'utf8'))
        return [{
          name: meta.name, description: PERSONA[cur().persona].catalog, invocation: { modelInvocable: true, userInvocable: true },
          provider: 'nekowhale-stickers', source: 'bundled', rank: 600,
          resourceBase: { kind: 'directory', path: SKILL_DIR }, locator: SKILL_FILE,
        }]
      },
      async get(c: any) {
        const { body } = splitSkill(await readFile(SKILL_FILE, 'utf8'))
        const content = body.replace('<!-- persona -->', PERSONA[cur().persona].skill)
        return { name: c.name, description: c.description, invocation: c.invocation, provider: c.provider, source: c.source, resourceBase: c.resourceBase, content }
      },
    }))
  })

  // ---------------------------------------------------------------- image route for the web UI
  // The pet runs in a cross-origin iframe served by the site; the page only gets this small config.
  const petConfig = () => {
    const c = cur()
    return {
      pet: c.pet, base: `${config.site.replace(/\/+$/u, '')}/hakimi-pet`, character: PET_CHARACTER,
      height: c.petHeight, bubbles: c.petBubbles,
    }
  }

  ctx.inject(['webServer'], (wctx: any) => {
    // Initial state for the browser half, so the first paint already matches the config.
    wctx.on('webserver/index-inject', (table: any[]) => {
      table.push({ kind: 'global', name: '__NEKOWHALE_PET__', value: petConfig() })
    })
    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: config.routePath,
      handler: async (req: any, res: any) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return }
        const rest = new URL(req.url ?? '/', 'http://x').pathname.slice(config.routePath.length)
        if (rest === '/pet/config.json') {
          const body = JSON.stringify(petConfig())
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(req.method === 'HEAD' ? undefined : body)
          return
        }
        const m = /^\/(s|r)\/([0-9a-f]{12,16})\.gif$/u.exec(rest)
        try {
          if (!m) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
          let file: string
          if (m[1] === 'r') file = kit.renderPath(m[2])
          else {
            const found = await kit.fileByHash(m[2])
            if (!found) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
            file = found
          }
          const info = await stat(file)
          res.setHeader('Content-Type', 'image/gif')
          res.setHeader('Content-Length', String(info.size))
          res.setHeader('Cache-Control', 'private, max-age=86400')
          res.setHeader('X-Content-Type-Options', 'nosniff')
          if (req.method === 'HEAD') { res.end(); return }
          createReadStream(file).on('error', () => res.destroy()).pipe(res)
        } catch (e: any) {
          if (e?.code !== 'ENOENT') log.warn('route: %s', e)
          res.statusCode = 404
          res.end()
        }
      },
    }), 'nekowhale-stickers: image route')
  })
}
