// Disk-cached fetcher for site files (meme template assets, fonts, kit meta).
// Content-hashed paths (`.../assets/...`) never change, so they are fetched once. Everything else is
// revalidated with ETag / Last-Modified after `ttlMs`, and the cached copy is used when offline.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fetchRetry } from './sync.js'

export interface CachedFetcherOptions {
  site: string
  dir: string
  ttlMs?: number
  headers?: Record<string, string>
  /** never touch the network: serve the cache or fail */
  offline?: boolean
}

interface Validator { etag?: string; lastModified?: string; checked: number }

const IMMUTABLE = /(^|\/)assets\//

/** Map a site path to a safe cache path (no `..`, no absolute paths). */
function cachePath(dir: string, rel: string) {
  const clean = rel.split('?')[0].split('/').filter((p) => p && p !== '.' && p !== '..').map(decodeURIComponent)
  return join(dir, ...clean.map((p) => p.replace(/[<>:"\\|?*]/g, '_')))
}

export function createCachedFetcher(o: CachedFetcherOptions) {
  const ttl = o.ttlMs ?? 24 * 3600_000
  const inflight = new Map<string, Promise<Buffer>>()

  async function load(rel: string, force: boolean): Promise<Buffer> {
    const path = cachePath(o.dir, rel)
    const vpath = path + '.validator.json'
    let cached: Buffer | undefined
    try { cached = await readFile(path) } catch {}
    if (cached && IMMUTABLE.test(rel)) return cached
    if (o.offline) {
      if (cached) return cached
      throw new Error(`offline and not cached: ${rel}`)
    }
    let v: Validator | undefined
    try { v = JSON.parse(await readFile(vpath, 'utf8')) } catch {}
    if (cached && v && !force && Date.now() - v.checked < ttl) return cached

    const headers: Record<string, string> = { ...o.headers }
    if (cached && v?.etag) headers['if-none-match'] = v.etag
    if (cached && v?.lastModified) headers['if-modified-since'] = v.lastModified
    const url = `${o.site}/${rel.split('/').map((p) => encodeURIComponent(decodeURIComponent(p))).join('/')}`
    let res: Response
    try {
      res = await fetchRetry(url, { headers }, 3)
    } catch (e) {
      if (cached) return cached
      throw e
    }
    await mkdir(dirname(path), { recursive: true })
    if (res.status === 304 && cached) {
      await writeFile(vpath, JSON.stringify({ ...v, checked: Date.now() }))
      return cached
    }
    if (!res.ok) {
      if (cached && res.status >= 500) return cached
      throw new Error(`GET ${rel}: HTTP ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // A missing static file on some CDNs falls back to the SPA's index.html with 200.
    if (/\.(json|css)$/.test(rel) && (res.headers.get('content-type') ?? '').includes('text/html')) {
      if (cached) return cached
      throw new Error(`GET ${rel}: got HTML instead of a file`)
    }
    const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.part`
    await writeFile(tmp, buf)
    await rename(tmp, path)
    await writeFile(vpath, JSON.stringify({
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
      checked: Date.now(),
    }))
    return buf
  }

  const fetcher = (rel: string, force = false): Promise<Buffer> => {
    const key = `${rel}|${force}`
    let p = inflight.get(key)
    if (!p) {
      p = load(rel, force).finally(() => inflight.delete(key))
      inflight.set(key, p)
    }
    return p
  }
  return fetcher
}
