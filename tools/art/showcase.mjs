// Small copies of sticker GIFs for the README showcase, so GitHub serves them from the repo instead of
// hotlinking 1–2 MB originals through its image proxy (which drops some of them).
// usage: node tools/art/showcase.mjs OUT_DIR SIZE CODE=SRC.gif [CODE=SRC.gif ...]
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { decodeGif, encodeGif, toCanvas } from '../../lib/meme/gif.js'

const [out, sizeArg, ...pairs] = process.argv.slice(2)
const size = Number(sizeArg) || 160
await mkdir(out, { recursive: true })
for (const pair of pairs) {
  const [code, src] = pair.split('=')
  const gif = await decodeGif(await readFile(src))
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const frames = gif.frames.map((f) => {
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(toCanvas(f), 0, 0, size, size)
    return ctx.getImageData(0, 0, size, size)
  })
  const data = encodeGif(frames, gif.delays)
  await writeFile(join(out, `${code}.gif`), data)
  console.log(code, frames.length, 'frames', Math.round(data.length / 1024), 'KB')
}
