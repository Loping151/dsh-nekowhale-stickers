// Framework-neutral data model. The same shapes are published as JSON (sticker-kit/1) so bots in any
// language can consume the knowledge without this library.

/** Per-sticker knowledge, written once per sticker (see tools/annotate). */
export interface StickerMeta {
  /** `<pack>/<file stem>`, same as the site manifest id */
  id: string
  /** first 12 hex of the GIF's SHA-1 when the entry was written; differs => the art changed since */
  hash?: string
  /** caption drawn in the image, verbatim */
  text: string
  /** one coarse emotion from a fixed vocabulary, handy for category based bots */
  emotion: string
  /** when to use it: situations, feelings, intents */
  tags: string[]
  /** one sentence: the chat situation it fits */
  use: string
  /** what happens in the animation */
  desc: string
  /** well known meme / work it references, empty if none */
  meme: string
  /** two-character packs: who acts on whom, e.g. 大肥鱼→GPT娘 */
  dir: string
  /** short English gloss */
  en: string
}

export interface Attribution {
  author: string
  links: { label: string; url: string }[]
  /** ready-to-show credit line */
  text: string
}

export interface PackInfo {
  key: string
  title: string
  desc: string
  showcase: string
  characters: { name: string; look: string }[]
}

/** The hosted knowledge file. */
export interface KitMeta {
  schema: 'sticker-kit/1'
  kit: string
  version: string
  attribution: Attribution
  packs: PackInfo[]
  /** fixed emotion vocabulary used by `StickerMeta.emotion` */
  emotions: string[]
  stickers: StickerMeta[]
}

export interface Sticker extends Partial<Omit<StickerMeta, 'id' | 'hash'>> {
  id: string
  pack: string
  /** file stem, e.g. 10N01_猫猫搓手 */
  stem: string
  /** e.g. 10N01 */
  code: string
  /** author's title, e.g. 猫猫搓手 */
  name: string
  file: string
  hash: string
  bytes: number
  frames: number
  w: number
  h: number
  /** meta was written for an older version of the art */
  metaStale?: boolean
}

export interface StickerHit {
  sticker: Sticker
  score: number
}

export interface TemplateInfo {
  /** `<pack>:<key>`, e.g. 大肥鱼:think */
  id: string
  pack: string
  key: string
  /** e.g. 大肥鱼想 */
  title: string
  input: 'text' | 'image'
  defaultText: string
  maxLen: number
}

/** A reply split into text and sticker parts, for bridges that send images separately (QQ, Telegram, ...). */
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'sticker'; ref: string; sticker?: Sticker }
  | { type: 'image'; url: string; alt: string }
