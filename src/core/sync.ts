// Incremental mirror of kiriyuki.com sticker packs.
// The site manifest (/api/manifest) lists every sticker with `hash` = first 12 hex of the file's SHA-1,
// so a local copy is up to date iff its SHA-1 prefix matches. The manifest itself is revalidated with ETag.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ManifestItem {
  id: string
  pack: string
  stem: string
  code: string
  group: string
  num: number
  name: string
  variant: string
  file: string
  hash: string
  bytes: number
  w: number
  h: number
  frames: number
  seconds: number
}

export interface Manifest {
  version: number
  updated: string
  gif_base: string
  packs: { key: string; label: string; desc: string; count: number }[]
  items: ManifestItem[]
}

export interface SyncOptions {
  site: string
  packs: string[]
  dir: string
  concurrency?: number
  prune?: boolean
  userAgent?: string
  log?: (msg: string) => void
}

export interface SyncResult {
  manifestVersion: number
  notModified: boolean
  downloaded: string[]
  removed: string[]
  failed: { id: string; error: string }[]
  total: number
}

const sha1prefix = (buf: Uint8Array) => createHash('sha1').update(buf).digest('hex').slice(0, 12)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchRetry(url: string, init: RequestInit = {}, tries = 5): Promise<Response> {
  let wait = 1000
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init)
      // EdgeOne answers 570 when its platform rate limit trips; treat like 429.
      if (res.status !== 429 && res.status !== 570 && res.status < 500) return res
      if (i >= tries - 1) return res
    } catch (e) {
      if (i >= tries - 1) throw e
    }
    await sleep(wait + Math.random() * 500)
    wait *= 2
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

// The site serves a small manifest with just the 大肥鱼 sets; other packs need the full one.
const KIT_ENDPOINT = '/api/kit/nekowhale'
const KIT_PACKS = ['大肥鱼', '大肥鱼和GPT娘']

/**
 * Fetch the manifest, reusing the cached copy when the server answers 304. Prefers the kit endpoint when it
 * covers every requested pack, and falls back to /api/manifest when the site does not serve it (404).
 */
export async function loadManifest(site: string, dir: string, headers: Record<string, string> = {}, packs?: string[]) {
  const cachePath = join(dir, 'manifest.json')
  const metaPath = join(dir, 'manifest.etag')
  const cached = await readJson<Manifest>(cachePath)
  let tagged: { source?: string; etag?: string } = {}
  try {
    const [source, etag] = (await readFile(metaPath, 'utf8')).split('\n')
    tagged = etag === undefined ? { source: '/api/manifest', etag: source.trim() } : { source: source.trim(), etag: etag.trim() }
  } catch {}
  const sources = !packs || packs.every((p) => KIT_PACKS.includes(p)) ? [KIT_ENDPOINT, '/api/manifest'] : ['/api/manifest']
  for (const source of sources) {
    const conditional = cached && tagged.etag && tagged.source === source
    const res = await fetchRetry(`${site}${source}`, { headers: { ...headers, ...(conditional ? { 'if-none-match': tagged.etag! } : {}) } })
    if (res.status === 404 && source !== sources[sources.length - 1]) continue
    if (res.status === 304 && cached) return { manifest: cached, notModified: true }
    if (!res.ok) {
      if (cached) return { manifest: cached, notModified: true }
      throw new Error(`manifest: HTTP ${res.status}`)
    }
    const text = await res.text()
    const manifest = JSON.parse(text) as Manifest
    await mkdir(dir, { recursive: true })
    await writeFile(cachePath + '.tmp', text)
    await rename(cachePath + '.tmp', cachePath)
    const newTag = res.headers.get('etag')
    if (newTag) await writeFile(metaPath, `${source}\n${newTag}`)
    return { manifest, notModified: false }
  }
  throw new Error('manifest: no source answered')
}

export const gifUrl = (site: string, m: Manifest, it: ManifestItem) =>
  `${site}${m.gif_base}/${encodeURIComponent(it.pack)}/${encodeURIComponent(it.file)}?h=${it.hash}`

/** Mirror the selected packs into `<dir>/packs/<pack>/<file>`; only changed or missing files are downloaded. */
export async function syncPacks(o: SyncOptions): Promise<SyncResult> {
  const log = o.log ?? (() => {})
  const headers = { 'user-agent': o.userAgent ?? 'nekowhale-stickers (+https://kiriyuki.com)' }
  const { manifest, notModified } = await loadManifest(o.site, o.dir, headers, o.packs)
  const want = manifest.items.filter((it) => o.packs.includes(it.pack))
  const result: SyncResult = {
    manifestVersion: manifest.version, notModified, downloaded: [], removed: [], failed: [], total: want.length,
  }

  const todo: ManifestItem[] = []
  for (const it of want) {
    const path = join(o.dir, 'packs', it.pack, it.file)
    try {
      if (sha1prefix(await readFile(path)) === it.hash) continue
    } catch {}
    todo.push(it)
  }
  log(`manifest v${manifest.version}: ${want.length} stickers, ${todo.length} to download`)

  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const it = todo[next++]
      const dirPath = join(o.dir, 'packs', it.pack)
      try {
        const res = await fetchRetry(gifUrl(o.site, manifest, it), { headers })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = new Uint8Array(await res.arrayBuffer())
        if (sha1prefix(buf) !== it.hash) throw new Error('hash mismatch')
        await mkdir(dirPath, { recursive: true })
        const tmp = join(dirPath, `.${it.file}.part`)
        await writeFile(tmp, buf)
        await rename(tmp, join(dirPath, it.file))
        result.downloaded.push(it.id)
        log(`  + ${it.id}`)
      } catch (e) {
        result.failed.push({ id: it.id, error: String((e as Error).message ?? e) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 3) }, worker))

  if (o.prune ?? true) {
    for (const pack of o.packs) {
      const keep = new Set(want.filter((it) => it.pack === pack).map((it) => it.file))
      let files: string[] = []
      try {
        files = await readdir(join(o.dir, 'packs', pack))
      } catch {}
      for (const f of files) {
        if (keep.has(f) || !f.endsWith('.gif')) continue
        await rm(join(o.dir, 'packs', pack, f), { force: true })
        result.removed.push(`${pack}/${f}`)
      }
    }
  }
  return result
}
