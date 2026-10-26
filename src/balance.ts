// DeepSeek balance for the pet's double-click card, read through dsh's own services.
//
// Same rules as the kiriyuki.com desktop pet (sticker-gallery pet/src/pet/balance-data.ts), which reads the
// same dsh sign-ins from outside dsh:
// - DeepSeek account sign-in: ctx.deepseekAccount.getBalance(), the call dsh's own account page makes
//   (dsh refreshes the token and sends the platform headers). Adds a bonus-wallet line.
// - API key: ctx.credentials resolves DEEPSEEK_API_KEY like dsh does (stored key, then the environment and
//   .env); we ask the public GET https://api.deepseek.com/user/balance with it. Without the credentials
//   service (older dsh) only the process environment is read.
// Both are asked at once. The account result wins when it answers (a failed account query is asked once more
// first); otherwise the key's. Both show the same way: the topped-up balance, plus a bonus line for granted
// money (the key's endpoint reports both parts too). When neither works, any network or server failure reads
// as "failed" (try again later), and only rejected credentials as "invalid".
// The key and the token never leave this process except to deepseek.com.

export interface BalanceAmount { currency: string; value: number }

export type BalanceView =
  | { kind: 'ok'; amounts: BalanceAmount[]; bonus: BalanceAmount[]; low: boolean; source: 'account' | 'key' }
  | { kind: 'no-key' }
  | { kind: 'invalid' }
  | { kind: 'failed' }

type Outcome = Exclude<BalanceView, { kind: 'no-key' }>

export interface BalanceClient {
  /** Plugin version, reported as the client version to the platform. */
  version: string
  /** UI language of the page that asked. */
  locale: string
  /** Offset from UTC in seconds, positive east of Greenwich. */
  timezoneOffsetSeconds: number
}

const KEY_ENDPOINT = 'https://api.deepseek.com/user/balance'
const KEY_REF = 'DEEPSEEK_API_KEY'
const TIMEOUT_MS = 8000

// Balances are decimal strings: two places from the public API ("597.39"), sixteen from the platform, maybe
// exponent form. Anything else is a malformed reply: show "failed" rather than a made-up number.
const DECIMAL = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu
const amount = (currency: unknown, value: unknown): BalanceAmount | null =>
  typeof currency === 'string' && /^[A-Z]{3}$/u.test(currency) && typeof value === 'string' && value.length <= 48 &&
  DECIMAL.test(value) && Number.isFinite(Number(value))
    ? { currency, value: Number(value) }
    : null

function amounts(list: unknown, field: 'balance' | 'total_balance' | 'topped_up_balance' | 'granted_balance'): BalanceAmount[] | null {
  if (!Array.isArray(list)) return null
  const out: BalanceAmount[] = []
  for (const item of list) {
    const a = amount(item?.currency, item?.[field])
    if (!a) return null
    out.push(a)
  }
  return out
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS) }),
  ]).finally(() => clearTimeout(timer))
}

/** null: no account service, or not signed in. */
async function viaAccount(ctx: any, client: BalanceClient, retries = 1): Promise<Outcome | null> {
  const account = ctx.get?.('deepseekAccount')
  if (typeof account?.getBalance !== 'function') return null
  const r = await withTimeout(Promise.resolve(account.getBalance(client)))
  if (r === null || r === undefined) return null
  if (r.status !== 'ready') {
    if (retries <= 0) return { kind: 'failed' }
    await new Promise((resolve) => setTimeout(resolve, 800))
    return viaAccount(ctx, client, retries - 1)
  }
  const normal = amounts(r.value, 'balance')
  const bonus = amounts(r.bonusWallets, 'balance')
  if (!normal || !bonus) return { kind: 'failed' }
  // The platform has no is_available: low means recharge and bonus together are spent.
  const total = [...normal, ...bonus].reduce((sum, a) => sum + a.value, 0)
  return { kind: 'ok', amounts: normal, bonus: bonus.filter((a) => a.value > 0), low: total <= 0, source: 'account' }
}

/** A usable key: no whitespace or control characters, not absurdly long. */
function cleanKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  return key && key.length <= 512 && !/[\s\u0000-\u001f\u007f]/u.test(key) ? key : null
}

async function resolveKey(ctx: any): Promise<string | null> {
  const credentials = ctx.get?.('credentials')
  if (typeof credentials?.resolve === 'function') return cleanKey((await credentials.resolve(KEY_REF))?.value)
  return cleanKey(process.env[KEY_REF])
}

/** null: no key configured. */
async function viaKey(ctx: any): Promise<Outcome | null> {
  const key = await resolveKey(ctx)
  if (!key) return null
  let res: Response
  try {
    res = await fetch(KEY_ENDPOINT, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { kind: 'failed' }
  }
  if (res.status === 401 || res.status === 403) return { kind: 'invalid' }
  if (res.status !== 200) return { kind: 'failed' }
  let data: any
  try { data = JSON.parse((await res.text()).slice(0, 64 * 1024)) } catch { return { kind: 'failed' } }
  const low = data?.is_available === false
  const topped = amounts(data?.balance_infos, 'topped_up_balance')
  const granted = amounts(data?.balance_infos, 'granted_balance')
  if (topped && granted) return { kind: 'ok', amounts: topped, bonus: granted.filter((a) => a.value > 0), low, source: 'key' }
  // No split reported: the total alone.
  const total = amounts(data?.balance_infos, 'total_balance')
  return total ? { kind: 'ok', amounts: total, bonus: [], low, source: 'key' } : { kind: 'failed' }
}

export async function queryBalance(ctx: any, client: BalanceClient, note?: (m: string) => void): Promise<BalanceView> {
  const failed = (): Outcome => ({ kind: 'failed' })
  const [account, key] = await Promise.all([viaAccount(ctx, client).catch(failed), viaKey(ctx).catch(failed)])
  if (account && account.kind !== 'ok' && key?.kind === 'ok') note?.(`balance: the DeepSeek sign-in answered ${account.kind}; showing the API key's balance`)
  const outcomes = [account, key].filter((o): o is Outcome => o !== null)
  if (!outcomes.length) return { kind: 'no-key' }
  const ok = [account, key].find((o) => o?.kind === 'ok')
  if (ok?.kind === 'ok') {
    // No currency at all = never topped up: show zero rather than an error.
    const list = ok.amounts.length ? ok.amounts.slice(0, 3) : [{ currency: 'CNY', value: 0 }]
    return { kind: 'ok', amounts: list, bonus: ok.bonus.slice(0, 2), low: ok.low, source: ok.source }
  }
  return outcomes.some((o) => o.kind === 'failed') ? { kind: 'failed' } : { kind: 'invalid' }
}
