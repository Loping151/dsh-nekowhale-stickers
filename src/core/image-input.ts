// Load an avatar for image templates from a local path or an http(s) URL, defensively: the argument comes
// from a model, so only real image files are accepted, sizes are capped, and URLs may not point at
// loopback / private / link-local addresses (no reaching into the LAN through the tool).
import { lookup } from 'node:dns/promises'
import { readFile, stat } from 'node:fs/promises'
import { isIP } from 'node:net'

const MAX_BYTES = 10 * 1024 * 1024

export function isImage(b: Uint8Array): boolean {
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
  return (b[0] === 0x89 && ascii(1, 3) === 'PNG') || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    || ascii(0, 4) === 'GIF8' || (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') || ascii(0, 2) === 'BM'
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7))
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) image URLs are allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  if (addrs.some(privateAddress)) throw new Error('image URL points to a private or local address')
}

export async function loadImageInput(src: string, opts: { allowPrivate?: boolean; signal?: AbortSignal } = {}): Promise<Buffer> {
  let buf: Buffer
  if (/^https?:\/\//iu.test(src)) {
    let url = new URL(src)
    for (let hop = 0; ; hop++) {
      if (!opts.allowPrivate) await assertPublic(url)
      const res = await fetch(url, { redirect: 'manual', signal: opts.signal })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc && hop < 3) { url = new URL(loc, url); continue }
      if (!res.ok) throw new Error(`image: HTTP ${res.status}`)
      if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('image too large')
      buf = Buffer.from(await res.arrayBuffer())
      break
    }
  } else {
    if ((await stat(src)).size > MAX_BYTES) throw new Error('image too large')
    buf = await readFile(src)
  }
  if (buf.length > MAX_BYTES) throw new Error('image too large')
  if (!isImage(buf)) throw new Error('not an image file (png, jpeg, gif, webp or bmp)')
  return buf
}
