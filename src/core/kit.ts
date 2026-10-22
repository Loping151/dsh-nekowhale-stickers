// StickerKit: the framework-neutral service. The dsh plugin, the CLI and any other bot host wrap this.
import { createHash } from 'node:crypto'
import { copyFile, link, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCachedFetcher } from './fetcher.js'
import { score, terms } from './search.js'
import { fetchRetry, loadManifest, syncPacks, type Manifest, type SyncResult } from './sync.js'
import type { Attribution, KitMeta, Segment, Sticker, StickerHit, StickerMeta, TemplateInfo } from './types.js'

export interface KitOptions {
  /** site origin, default https://kiriyuki.com */
  site?: string
  /** pack keys to serve */
  packs?: string[]
  /** writable directory for GIFs, caches, renders and state */
  dataDir: string
  /** bundled snapshot of the knowledge file, used offline and before the first update */
  bundledMeta?: string
  /** site-relative path of the hosted knowledge file; empty disables remote updates */
  metaPath?: string
  /** startup: mirror every sticker in the background at start; lazy: download a GIF the first time it is used; off: never touch the network */
  autoSync?: 'startup' | 'lazy' | 'off'
  /** re-check the manifest, meta and template index this often */
  refreshHours?: number
  /** rules that always hide a sticker: id, stem, code, name, or pack: / tag: / emotion: / group: prefixed */
  blacklist?: string[]
  /** when non-empty, only stickers matching one of these rules exist */
  whitelist?: string[]
  /** template output: mask banned words, as on the website */
  banwords?: boolean
  log?: (msg: string, level?: 'info' | 'warn') => void
}

export interface KitState {
  /** all: every sticker except `disabled`; allowlist: only `enabled` */
  mode: 'all' | 'allowlist'
  enabled: string[]
  disabled: string[]
}

export interface RenderOutput {
  /** content id, also the file name stem under renders/ */
  id: string
  path: string
  data: Buffer
  mime: 'image/gif'
  width: number
  height: number
  template: TemplateInfo
  /** banned words were masked */
  masked: boolean
}

export const DEFAULT_SITE = 'https://kiriyuki.com'
export const DEFAULT_PACKS = ['大肥鱼', '大肥鱼和GPT娘']
export const DEFAULT_ATTRIBUTION: Attribution = {
  author: '可以叫我云大人',
  links: [
    { label: 'Bilibili', url: 'https://space.bilibili.com/103739' },
    { label: 'kiriyuki.com', url: 'https://kiriyuki.com' },
  ],
  text: '表情包作者：B站 可以叫我云大人（space.bilibili.com/103739），kiriyuki.com 制作，欢迎约原稿同款表情包！',
}

const UA = 'nekowhale-stickers (+https://kiriyuki.com)'

const RULE = /^(pack|tag|emotion|group|code):(.+)$/u

export function matchesRule(rule: string, s: Sticker): boolean {
  const m = RULE.exec(rule.trim())
  if (m) {
    const v = m[2].trim()
    if (m[1] === 'pack') return s.pack === v
    if (m[1] === 'tag') return (s.tags ?? []).includes(v)
    if (m[1] === 'emotion') return s.emotion === v
    if (m[1] === 'group') return s.code.replace(/\d+$/u, '') === v
    return s.code === v
  }
  const r = rule.trim()
  return r === s.id || r === s.stem || r === s.code || r === s.name
}

// `[sticker:REF]`; dsh-meme already owns `[表情: caption]`, so that form is left alone.
const MARK = /\[sticker:([^\]\n]{1,80})\]/gu

export class StickerKit {
  readonly site: string
  readonly packs: string[]
  readonly fetch: (rel: string, force?: boolean) => Promise<Buffer>
  private o: Required<Omit<KitOptions, 'log' | 'bundledMeta'>> & Pick<KitOptions, 'log' | 'bundledMeta'>
  private meta?: KitMeta
  private manifest?: Manifest
  private stickers: Sticker[] = []
  private byId = new Map<string, Sticker>()
  private fieldCache = new Map<string, Record<string, string>>()
  private dupStems = new Set<string>()
  private state: KitState = { mode: 'all', enabled: [], disabled: [] }
  private loaded?: Promise<void>
  private lastRefresh = 0
  private syncing?: Promise<SyncResult>
  private downloads = new Map<string, Promise<void>>()
  private listeners = new Set<() => void>()

  constructor(options: KitOptions) {
    this.o = {
      site: DEFAULT_SITE, packs: DEFAULT_PACKS, metaPath: 'meme/kit/nekowhale.json', autoSync: 'lazy',
      refreshHours: 6, blacklist: [], whitelist: [], banwords: true, ...options,
    }
    this.site = this.o.site.replace(/\/+$/u, '')
    this.packs = this.o.packs
    this.fetch = createCachedFetcher({
      site: this.site, dir: join(this.o.dataDir, 'cache'), ttlMs: this.o.refreshHours * 3600_000,
      headers: { 'user-agent': UA }, offline: this.o.autoSync === 'off',
    })
  }

  private log(msg: string, level: 'info' | 'warn' = 'info') { this.o.log?.(msg, level) }

  /** Called after the catalog or the agent's selection changes. Returns an unsubscribe function. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() { for (const fn of this.listeners) fn() }

  // ---------------------------------------------------------------- loading
  /** Load meta, manifest and state. Cheap after the first call; refreshes in the background when stale. */
  ready(): Promise<void> {
    if (!this.loaded) this.loaded = this.load()
    else if (this.o.autoSync !== 'off' && Date.now() - this.lastRefresh > this.o.refreshHours * 3600_000) {
      this.lastRefresh = Date.now()
      void this.refresh().catch((e) => this.log(`refresh failed: ${e}`, 'warn'))
    }
    return this.loaded
  }

  private async load() {
    this.state = await readJson<KitState>(this.statePath()) ?? this.state
    if (this.o.bundledMeta) this.meta = await readJson<KitMeta>(this.o.bundledMeta)
    this.manifest = await readJson<Manifest>(join(this.o.dataDir, 'manifest.json'))
    this.rebuild()
    if (this.o.autoSync === 'off') return
    this.lastRefresh = Date.now()
    // First run without any local data: wait for the network; otherwise refresh in the background.
    const p = this.refresh().catch((e) => this.log(`refresh failed: ${e}`, 'warn'))
    if (this.stickers.length === 0) await p
  }

  private async refresh() {
    if (this.o.metaPath) {
      try {
        const remote = JSON.parse((await this.fetch(this.o.metaPath)).toString('utf8')) as KitMeta
        if (remote.schema === 'sticker-kit/1' && Array.isArray(remote.stickers)) this.meta = remote
      } catch (e) {
        this.log(`knowledge file not updated (${e}); using the cached or bundled copy`)
      }
    }
    if (this.o.autoSync === 'startup') await this.sync()
    else this.manifest = (await loadManifest(this.site, this.o.dataDir, {}, this.packs)).manifest
    this.rebuild()
  }

  private rebuild() {
    const metaById = new Map((this.meta?.stickers ?? []).map((m) => [m.id, m]))
    const out = new Map<string, Sticker>()
    for (const it of this.manifest?.items ?? []) {
      if (!this.packs.includes(it.pack)) continue
      const m = metaById.get(it.id)
      out.set(it.id, {
        ...strip(m), id: it.id, pack: it.pack, stem: it.stem, code: it.code, name: it.name, file: it.file,
        hash: it.hash, bytes: it.bytes, frames: it.frames, w: it.w, h: it.h,
        ...(m?.hash && m.hash !== it.hash ? { metaStale: true } : {}),
      })
    }
    // Stickers known only from meta (no manifest yet, e.g. offline first run).
    for (const m of this.meta?.stickers ?? []) {
      if (out.has(m.id)) continue
      const [pack, stem] = m.id.split('/')
      if (!this.packs.includes(pack) || !stem) continue
      const code = stem.split('_')[0]
      out.set(m.id, {
        ...strip(m), id: m.id, pack, stem, code, name: stem.slice(code.length + 1) || stem, file: `${stem}.gif`,
        hash: m.hash ?? '', bytes: 0, frames: 0, w: 0, h: 0,
      })
    }
    this.stickers = [...out.values()].filter((s) => !this.o.blacklist.some((r) => matchesRule(r, s))
      && (this.o.whitelist.length === 0 || this.o.whitelist.some((r) => matchesRule(r, s))))
    this.byId = new Map(this.stickers.map((s) => [s.id, s]))
    const seen = new Set<string>()
    this.dupStems = new Set(this.stickers.filter((s) => seen.has(s.stem) || !seen.add(s.stem)).map((s) => s.stem))
    this.fieldCache.clear()
    this.emit()
  }

  /** Mirror every sticker of the configured packs (incremental). */
  sync(): Promise<SyncResult> {
    if (!this.syncing) {
      this.syncing = syncPacks({ site: this.site, packs: this.packs, dir: this.o.dataDir, log: (m) => this.log(m) })
        .then(async (r) => {
          this.manifest = await readJson<Manifest>(join(this.o.dataDir, 'manifest.json')) ?? this.manifest
          this.rebuild()
          return r
        })
        .finally(() => { this.syncing = undefined })
    }
    return this.syncing
  }

  /** Change selection rules and output options at runtime (e.g. from a settings page). */
  configure(p: { blacklist?: string[]; whitelist?: string[]; banwords?: boolean }) {
    const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i])
    let rebuild = false
    if (p.blacklist && !same(p.blacklist, this.o.blacklist)) { this.o.blacklist = [...p.blacklist]; rebuild = true }
    if (p.whitelist && !same(p.whitelist, this.o.whitelist)) { this.o.whitelist = [...p.whitelist]; rebuild = true }
    if (p.banwords !== undefined) this.o.banwords = p.banwords
    if (rebuild) this.rebuild()
  }

  // ---------------------------------------------------------------- knowledge
  get attribution(): Attribution { return this.meta?.attribution ?? DEFAULT_ATTRIBUTION }
  get packInfo() { return (this.meta?.packs ?? []).filter((p) => this.packs.includes(p.key)) }
  get emotions(): string[] { return this.meta?.emotions ?? [] }

  isEnabled(s: Sticker): boolean {
    if (this.state.disabled.includes(s.id)) return false
    return this.state.mode === 'all' || this.state.enabled.includes(s.id)
  }

  /** Every sticker after config black/white lists; `enabledOnly` also applies the agent's own picks. */
  async all(enabledOnly = true): Promise<Sticker[]> {
    await this.ready()
    return enabledOnly ? this.stickers.filter((s) => this.isEnabled(s)) : [...this.stickers]
  }

  /** Resolve an id, stem, code or name. */
  async resolve(ref: string): Promise<Sticker | undefined> {
    await this.ready()
    const r = ref.trim().replace(/\.gif$/iu, '')
    return this.byId.get(r)
      ?? this.stickers.find((s) => s.stem === r || s.code === r)
      ?? this.stickers.find((s) => s.name === r && this.isEnabled(s))
      ?? this.stickers.find((s) => s.name === r)
  }

  async search(query: string, opts: { limit?: number; pack?: string; emotion?: string; includeDisabled?: boolean; shuffle?: boolean } = {}): Promise<StickerHit[]> {
    let pool = await this.all(!opts.includeDisabled)
    if (opts.pack) pool = pool.filter((s) => s.pack === opts.pack)
    if (opts.emotion) pool = pool.filter((s) => s.emotion === opts.emotion)
    const qs = terms(query)
    const hits = qs.length === 0
      ? pool.map((sticker) => ({ sticker, score: 0 }))
      : pool.map((sticker) => ({ sticker, score: score(sticker, qs, this.fieldCache) })).filter((h) => h.score > 0)
    // A little jitter among near-equal scores keeps replies from always using the same sticker.
    if (opts.shuffle ?? true) for (const h of hits) h.score *= 1 + Math.random() * 0.15
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, Math.max(1, Math.min(opts.limit ?? 6, 50)))
  }

  /** Resolve a name, or treat an emotion word (开心, 生气, ...) as "any enabled sticker of that emotion". */
  async pick(ref: string): Promise<Sticker | undefined> {
    const s = await this.resolve(ref)
    if (s) return s
    const r = ref.trim()
    return this.emotions.includes(r) || this.stickers.some((x) => x.emotion === r) ? this.random({ emotion: r }) : undefined
  }

  async random(opts: { pack?: string; emotion?: string } = {}): Promise<Sticker | undefined> {
    const pool = (await this.all()).filter((s) => (!opts.pack || s.pack === opts.pack) && (!opts.emotion || s.emotion === opts.emotion))
    return pool[Math.floor(Math.random() * pool.length)]
  }

  /** Public URL of the original GIF on the site (for bridges that send by URL). */
  url(s: Sticker): string {
    return `${this.site}${this.manifest?.gif_base ?? '/media/gif'}/${encodeURIComponent(s.pack)}/${encodeURIComponent(s.file)}${s.hash ? `?h=${s.hash}` : ''}`
  }

  /** Local path of the sticker GIF, downloading it first when needed. */
  async file(ref: string | Sticker): Promise<{ path: string; sticker: Sticker }> {
    const s = typeof ref === 'string' ? await this.resolve(ref) : ref
    if (!s) throw new Error(`unknown sticker: ${ref}`)
    const path = join(this.o.dataDir, 'packs', s.pack, s.file)
    try {
      const buf = await readFile(path)
      if (!s.hash || sha1(buf) === s.hash) {
        await this.archive(s, path)
        return { path, sticker: s }
      }
    } catch {}
    if (this.o.autoSync === 'off') throw new Error(`sticker ${s.id} is not downloaded and autoSync is off`)
    let p = this.downloads.get(s.id)
    if (!p) {
      p = (async () => {
        const res = await fetchRetry(this.url(s), { headers: { 'user-agent': UA } })
        if (!res.ok) throw new Error(`download ${s.id}: HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (s.hash && sha1(buf) !== s.hash) throw new Error(`download ${s.id}: hash mismatch`)
        await mkdir(join(this.o.dataDir, 'packs', s.pack), { recursive: true })
        const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.part`
        await writeFile(tmp, buf)
        await rename(tmp, path)
      })().finally(() => this.downloads.delete(s.id))
      this.downloads.set(s.id, p)
    }
    await p
    await this.archive(s, path)
    return { path, sticker: s }
  }

  /**
   * Keep a hash-addressed hard link of every version that was handed out, so image links already written
   * into chat history keep showing the same picture after the art is updated (the main file gets replaced).
   */
  private async archive(s: Sticker, path: string) {
    if (!s.hash) return
    const target = join(this.o.dataDir, 'byhash', `${s.hash}.gif`)
    try { await stat(target); return } catch {}
    await mkdir(join(this.o.dataDir, 'byhash'), { recursive: true })
    try { await link(path, target) } catch { await copyFile(path, target).catch(() => {}) }
  }

  /** File for a hash-addressed link: an archived version first, else the current sticker with that hash. */
  async fileByHash(hash: string): Promise<string | undefined> {
    const archived = join(this.o.dataDir, 'byhash', `${hash}.gif`)
    try { await stat(archived); return archived } catch {}
    await this.ready()
    const s = this.stickers.find((x) => x.hash === hash)
    return s ? (await this.file(s)).path : undefined
  }

  // ---------------------------------------------------------------- agent curation
  getState(): KitState { return structuredClone(this.state) }

  async setEnabled(refs: string[], enabled: boolean) {
    await this.ready()
    const changed: string[] = []
    const unknown: string[] = []
    for (const ref of refs) {
      const s = await this.resolve(ref)
      if (!s) { unknown.push(ref); continue }
      const was = this.isEnabled(s)
      this.state.disabled = this.state.disabled.filter((x) => x !== s.id)
      this.state.enabled = this.state.enabled.filter((x) => x !== s.id)
      if (enabled && this.state.mode === 'allowlist') this.state.enabled.push(s.id)
      if (!enabled && this.state.mode === 'all') this.state.disabled.push(s.id)
      if (was !== this.isEnabled(s)) changed.push(s.id)
    }
    await this.saveState()
    return { changed, unknown }
  }

  async setMode(mode: KitState['mode']) {
    await this.ready()
    this.state.mode = mode
    await this.saveState()
  }

  async resetState() {
    this.state = { mode: 'all', enabled: [], disabled: [] }
    await this.saveState()
  }

  private statePath() { return join(this.o.dataDir, 'state.json') }
  private async saveState() {
    await mkdir(this.o.dataDir, { recursive: true })
    await writeFile(this.statePath() + '.tmp', JSON.stringify(this.state, null, 1))
    await rename(this.statePath() + '.tmp', this.statePath())
    this.emit()
  }

  // ---------------------------------------------------------------- templates
  private memeMod?: Promise<typeof import('../meme/index.js')>
  private meme() {
    // @napi-rs/canvas is an optional native dependency: load it only when a template is used.
    this.memeMod ??= import('../meme/index.js')
    return this.memeMod
  }

  async templates(): Promise<TemplateInfo[]> {
    const m = await this.meme()
    let index: Awaited<ReturnType<typeof m.loadMemeIndex>>
    try { index = await m.loadMemeIndex(this.fetch) } catch (e) { this.log(`templates unavailable: ${e}`, 'warn'); return [] }
    return m.TEMPLATES.flatMap((t) => this.packs.filter((p) => index.packs[p]?.[t.key]).map((pack) => ({
      id: `${pack}:${t.key}`, pack, key: t.key, title: `${pack}${t.label}`, input: t.input,
      defaultText: t.defaultText, maxLen: t.maxLen,
    })))
  }

  /** Accepts `大肥鱼:think`, `大肥鱼想`, `think` (first pack) or the label `想`. */
  async resolveTemplate(ref: string): Promise<TemplateInfo | undefined> {
    const all = await this.templates()
    const r = ref.trim()
    return all.find((t) => t.id === r || t.title === r) ?? all.find((t) => t.key === r || t.title.endsWith(r))
  }

  async render(ref: string, input: { text?: string; image?: Buffer }): Promise<RenderOutput> {
    const t = await this.resolveTemplate(ref)
    if (!t) {
      const names = (await this.templates()).map((x) => x.title)
      throw new Error(`unknown template: ${ref}; available: ${names.join(', ') || 'none (template assets not published yet)'}`)
    }
    if (t.input === 'image' && !input.image) throw new Error(`${t.title} needs an image`)
    const m = await this.meme()
    const text = (input.text ?? '').trim() || t.defaultText
    const r = await m.renderMeme(this.fetch, t.pack, t.key as never, t.input === 'text' ? { text: [...text].slice(0, t.maxLen).join('') } : { image: input.image },
      { banwords: this.o.banwords })
    const id = createHash('sha256').update(r.data).digest('hex').slice(0, 16)
    const dir = join(this.o.dataDir, 'renders')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${id}.gif`)
    await writeFile(path, r.data)
    return { id, path, data: r.data, mime: r.mime, width: r.width, height: r.height, template: t, masked: r.masked }
  }

  renderPath(id: string) { return join(this.o.dataDir, 'renders', `${id}.gif`) }

  // ---------------------------------------------------------------- reply markup
  /**
   * Split a model reply on `[sticker:REF]` marks so a chat bridge can send the images as separate messages.
   * REF is a sticker name or an emotion word (random pick). Unknown refs are kept as text.
   */
  async parseReply(text: string): Promise<Segment[]> {
    const out: Segment[] = []
    let last = 0
    for (const m of text.matchAll(MARK)) {
      const s = await this.pick(m[1])
      if (!s) continue
      if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
      out.push({ type: 'sticker', ref: m[1], sticker: s })
      last = m.index! + m[0].length
    }
    if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
    return out
  }

  /** Name to show the model: the file stem, or `pack/stem` when several packs share the stem. */
  label(s: Sticker): string { return this.dupStems.has(s.stem) ? s.id : s.stem }

  /** One compact line per sticker, for browsing or for a small prompt index. */
  line(s: Sticker, detail: 'short' | 'full' = 'short'): string {
    const base = `${this.label(s)}｜${s.emotion ?? ''}｜${(s.tags ?? []).slice(0, 5).join(',')}`
    if (detail === 'short') return s.dir ? `${base}｜${s.dir}` : base
    return [base, s.use, s.desc, s.meme && `梗:${s.meme}`, s.dir && `方向:${s.dir}`, s.text && `字:${s.text}`]
      .filter(Boolean).join('\n  ')
  }
}

function strip(m?: StickerMeta): Partial<Sticker> {
  if (!m) return {}
  const { id: _i, hash: _h, ...rest } = m
  return rest
}

function sha1(buf: Uint8Array) { return createHash('sha1').update(buf).digest('hex').slice(0, 12) }

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return undefined }
}
