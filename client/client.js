// Browser half of dsh-nekowhale-stickers: floats the kiriyuki.com web pet (大肥鱼) over the dsh web UI.
//
// Hand-written in the shape dsh's client loader expects (a closure handed to window.__ModuleLoader__ whose
// `require` only answers the shared modules). The exported cordis plugin adds one entry to the `shell.overlay`
// slot. It must never throw: a failing client plugin blanks the whole web UI.
//
// Security: no remote script runs in the dsh page. The pet is a cross-origin, sandboxed iframe
// (https://kiriyuki.com/hakimi-pet/pet.html) driven over the documented `core-pet-v1` postMessage channel,
// with every message checked against the iframe window and the service origin.
window.__ModuleLoader__.load({ id: 'dsh-nekowhale-stickers', factory: (require) => {
  const module = { exports: {} }
  const React = require('react')
  const h = React.createElement
  const CONFIG_URL = '/x-nekowhale-stickers/pet/config.json'
  const POS_KEY = 'nekowhale-pet-position'
  const CHANNEL = 'core-pet-v1'
  const POLL_MS = 5000
  const READY_TIMEOUT_MS = 30000
  const ASPECT = 176 / 211

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1))

  function loadPos() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
      if (p && Number.isFinite(p.rx) && Number.isFinite(p.ry)) return { rx: clamp01(p.rx), ry: clamp01(p.ry) }
    } catch {}
    return { rx: 0.985, ry: 1 }
  }

  // ---------------------------------------------------------------- balance card (double-click the pet)
  // The card the kiriyuki.com desktop pet shows (sticker-gallery pet/src/pet/balance.ts): same artwork, font and
  // CSS, drawn here over the iframe because the web pet itself has no balance. The CSS below is that file's,
  // with `.pet-balance` renamed and `vw` (the pet window's width there) turned into the pet box's width.
  // The balance comes from this plugin's server half (dsh's own DeepSeek sign-in or API key, see src/balance.ts).
  const DOUBLE_TAP_MS = 380
  const HOLD_OK = 6000
  const HOLD_ERROR = 8500
  const QUERY_TIMEOUT_MS = 20000
  const BALANCE_TEXT = {
    'zh-CN': { title: 'DeepSeek 余额', loading: '查询中…', low: '余额不足', bonus: '赠送 {amount}', noKey: '没找到 API Key', noKeyHint: '在 dsh 里登录 DeepSeek 账号或设置 API Key', invalid: 'API Key 无效', invalidHint: '在 dsh 里重新登录，或换一个 Key', failed: '查询失败', failedHint: '检查网络后再双击', localHint: '只能在运行 dsh 的这台电脑上查' },
    'zh-Hant': { title: 'DeepSeek 餘額', loading: '查詢中…', low: '餘額不足', bonus: '贈送 {amount}', noKey: '沒找到 API Key', noKeyHint: '在 dsh 裡登入 DeepSeek 帳號或設定 API Key', invalid: 'API Key 無效', invalidHint: '在 dsh 裡重新登入，或換一個 Key', failed: '查詢失敗', failedHint: '檢查網路後再雙擊', localHint: '只能在執行 dsh 的這台電腦上查' },
    en: { title: 'DeepSeek balance', loading: 'Checking…', low: 'Balance too low', bonus: 'Bonus {amount}', noKey: 'No API key found', noKeyHint: 'Sign in to DeepSeek or set an API key in dsh', invalid: 'Invalid API key', invalidHint: 'Sign in again in dsh, or use another key', failed: "Couldn't check", failedHint: 'Check your network, then double-click', localHint: 'Only on the computer running dsh' },
    ja: { title: 'DeepSeek 残高', loading: '確認中…', low: '残高不足', bonus: 'ボーナス {amount}', noKey: 'API キーがありません', noKeyHint: 'dsh で DeepSeek にログインするか API キーを設定してね', invalid: 'API キーが無効です', invalidHint: 'dsh で再ログインするか、別のキーを使ってね', failed: '確認できませんでした', failedHint: '接続を確かめてもう一度ダブルクリック', localHint: 'dsh を動かしているパソコンでだけ見られます' },
    ko: { title: 'DeepSeek 잔액', loading: '확인 중…', low: '잔액 부족', bonus: '보너스 {amount}', noKey: 'API 키가 없어요', noKeyHint: 'dsh에서 DeepSeek에 로그인하거나 API 키를 설정하세요', invalid: 'API 키가 올바르지 않아요', invalidHint: 'dsh에서 다시 로그인하거나 다른 키를 써 보세요', failed: '확인하지 못했어요', failedHint: '네트워크 확인 후 다시 더블클릭', localHint: 'dsh를 실행 중인 컴퓨터에서만 볼 수 있어요' },
  }
  function balanceLocale() {
    const tag = String(document.documentElement.lang || navigator.language || 'zh-CN')
    const t = tag.toLowerCase()
    if (t.startsWith('zh')) return /hant|tw|hk|mo/.test(t) && !/hans/.test(t) ? ['zh-Hant', tag] : ['zh-CN', tag]
    if (t.startsWith('ja')) return ['ja', tag]
    if (t.startsWith('ko')) return ['ko', tag]
    return ['en', tag]
  }
  const SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', GBP: '£' }
  function formatAmount(item, locale) {
    const magnitude = Math.abs(item.value)
    const sign = item.value < 0 ? '-' : ''
    let digits
    try { digits = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(magnitude) } catch { digits = magnitude.toFixed(2) }
    const symbol = SYMBOLS[item.currency]
    return symbol ? `${sign}${symbol}${digits}` : `${sign}${item.currency} ${digits}`
  }
  const SLICE = 40
  const HAND = "'ZCOOL KuaiLe Balance','KaiTi','STKaiti','Segoe Print','Comic Sans MS',cursive"
  const SYSTEM = "system-ui,'Segoe UI','Microsoft YaHei',sans-serif"
  const balanceCss = (ui) => {
    const font = JSON.stringify(`${ui}/font/zcool-kuaile-balance.woff2`)
    const panel = JSON.stringify(`${ui}/balance/panel.png`)
    const parts = JSON.stringify(`${ui}/balance/parts.png`)
    return `
@font-face{font-family:'ZCOOL KuaiLe Balance';src:url(${font}) format('woff2');font-display:swap}
.pet-balance{position:absolute;left:50%;top:2.5%;z-index:3;display:flex;flex-direction:column;align-items:center;max-width:98vw;pointer-events:none;opacity:0;transform:translateX(-50%) translateY(5px) scale(.9);transform-origin:50% 100%;transition:opacity .16s ease-out,transform .24s cubic-bezier(.3,1.5,.6,1)}
.pet-balance[hidden]{display:none}
.pet-balance.show{opacity:1;transform:translateX(-50%)}
.pet-balance-panel{position:relative;min-width:58vw;max-width:98vw;padding:4.6vw 9vw 5vw}
.pet-balance[data-kind=no-key] .pet-balance-panel,.pet-balance[data-kind=invalid] .pet-balance-panel,.pet-balance[data-kind=failed] .pet-balance-panel{min-width:72vw}
.pet-balance-panel::before{content:'';position:absolute;inset:3.2vw;border-radius:5vw;background:#fff}
.pet-balance-panel>i{position:absolute;inset:0;border:7.5vw solid transparent;border-image:url(${panel}) ${SLICE}/9.375vw/1.875vw stretch}
.pet-balance-body{position:relative;display:flex;flex-direction:column;align-items:center;gap:.6vw;text-align:center;color:#1b1b1f}
.pet-balance-title{font:500 max(9px,5vw)/1.15 ${SYSTEM};letter-spacing:.02em;color:#6b7280;white-space:nowrap}
.pet-balance-main{display:flex;align-items:center;justify-content:center;gap:1.6vw;white-space:nowrap;font:400 max(13px,11.5vw)/1 ${HAND}}
.pet-balance[data-kind=no-key] .pet-balance-main,.pet-balance[data-kind=invalid] .pet-balance-main,.pet-balance[data-kind=failed] .pet-balance-main,.pet-balance[data-kind=loading] .pet-balance-main{font-size:max(11px,7.6vw)}
.pet-balance-amounts{display:flex;flex-direction:column;align-items:flex-start}
.pet-balance-coin{flex:none;width:.9em;height:.9em;margin-top:-.06em;background:url(${parts}) 50% 100%/300% 200% no-repeat}
.pet-balance-coin[hidden]{display:none}
.pet-balance-hint{font:max(8.5px,4.8vw)/1.25 ${SYSTEM};color:#6b7280;max-width:78vw;text-wrap:balance}
.pet-balance-hint:empty,.pet-balance-bonus:empty{display:none}
.pet-balance-bonus{font:500 max(8.5px,4.8vw)/1.15 ${SYSTEM};color:#4d6bfe;white-space:nowrap}
.pet-balance[data-low] .pet-balance-hint{color:#c2410c}
.pet-balance[data-hand] .pet-balance-title{font:400 max(9.5px,5.4vw)/1.15 ${HAND};letter-spacing:.03em}
.pet-balance[data-hand] .pet-balance-bonus{font-family:${HAND};font-weight:400;font-size:max(9px,5.2vw)}
.pet-balance-whale{position:absolute;right:-5vw;top:-4.6vw;width:15vw;aspect-ratio:1;background:url(${parts}) 0 100%/300% 200% no-repeat;animation:pet-balance-bob 1.6s ease-in-out infinite}
.pet-balance[data-kind=no-key] .pet-balance-whale,.pet-balance[data-kind=invalid] .pet-balance-whale,.pet-balance[data-kind=failed] .pet-balance-whale{background-position:100% 100%}
.pet-balance-trail{width:12vw;aspect-ratio:1;margin-top:-2.6vw;margin-left:15vw;background:url(${parts}) 0 0/300% 200% no-repeat}
@keyframes pet-balance-bob{0%,100%{transform:scaleX(-1) translateY(0) rotate(-4deg)}50%{transform:scaleX(-1) translateY(-1.2vw) rotate(3deg)}}
@media(prefers-reduced-motion:reduce){
  .pet-balance{transition:none}
  .pet-balance-whale{animation:none}
  .pet-balance-whale{transform:scaleX(-1)}
}`.replace(/\.pet-balance/g, '.nkw-balance').replace(/pet-balance-bob/g, 'nkw-balance-bob')
      .replace(/(-?\d*\.?\d+)vw/g, 'calc($1 * var(--nkw-u))')
  }
  // Differences from the desktop card: hints point at dsh instead of a tray menu, and keep the system font
  // (the handwriting subset only has the desktop's simplified hint characters); bubbles inside the iframe stay.
  function createBalanceCard(box, ui, query, onFace, calm) {
    const style = document.createElement('style')
    style.textContent = balanceCss(ui)
    const el = document.createElement('div')
    el.className = 'nkw-balance'
    el.hidden = true
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    const make = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n }
    const panel = make('div', 'nkw-balance-panel')
    panel.append(make('i'))
    const body = make('div', 'nkw-balance-body')
    const title = make('span', 'nkw-balance-title')
    const main = make('span', 'nkw-balance-main')
    const coin = make('i', 'nkw-balance-coin')
    const amounts = make('span', 'nkw-balance-amounts')
    const bonus = make('span', 'nkw-balance-bonus')
    const hint = make('span', 'nkw-balance-hint')
    main.append(coin, amounts)
    body.append(title, main, bonus, hint)
    panel.append(body)
    el.append(panel, make('i', 'nkw-balance-whale'), make('i', 'nkw-balance-trail'))
    box.append(style, el)
    let busy = false
    let destroyed = false
    let hideTimer = 0
    const fit = () => {
      if (destroyed || el.hidden) return
      main.style.fontSize = ''
      let size = parseFloat(getComputedStyle(main).fontSize)
      while (size > 9 && body.scrollWidth > body.clientWidth + 0.5) {
        size = Math.max(9, size - 0.5)
        main.style.fontSize = `${size}px`
      }
    }
    const onFonts = () => fit()
    try { document.fonts && document.fonts.addEventListener('loadingdone', onFonts) } catch {}
    const render = (view) => {
      const [lang, tag] = balanceLocale()
      const t = BALANCE_TEXT[lang]
      const lines = []
      let hintText = ''
      let bonusText = ''
      if (view.kind === 'ok') {
        for (const a of view.amounts) lines.push(formatAmount(a, tag))
        bonusText = view.bonus.map((a) => t.bonus.replace('{amount}', formatAmount(a, tag))).join(' · ')
        if (view.low) hintText = t.low
      } else if (view.kind === 'loading') lines.push(t.loading)
      else if (view.kind === 'no-key') { lines.push(t.noKey); hintText = t.noKeyHint }
      else if (view.kind === 'invalid') { lines.push(t.invalid); hintText = t.invalidHint }
      else { lines.push(t.failed); hintText = view.kind === 'local-only' ? t.localHint : t.failedHint }
      el.dataset.kind = view.kind === 'local-only' ? 'failed' : view.kind
      el.toggleAttribute('data-low', view.kind === 'ok' && view.low)
      el.lang = tag
      el.toggleAttribute('data-hand', lang === 'zh-CN' || lang === 'en')
      title.textContent = t.title
      coin.hidden = view.kind !== 'ok'
      amounts.replaceChildren(...lines.map((line) => { const n = document.createElement('span'); n.textContent = line; return n }))
      bonus.textContent = bonusText
      hint.textContent = hintText
      el.setAttribute('aria-label', [t.title, ...lines, bonusText, hintText].filter(Boolean).join(' '))
      if (el.hidden) { el.hidden = false; void el.offsetWidth }
      el.classList.add('show')
      fit()
    }
    const hide = () => {
      clearTimeout(hideTimer)
      el.classList.remove('show')
      hideTimer = setTimeout(() => { if (!busy) el.hidden = true }, 260)
    }
    return {
      async show() {
        if (destroyed || busy) return
        busy = true
        clearTimeout(hideTimer)
        const asked = Promise.race([query(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), QUERY_TIMEOUT_MS))])
        asked.catch(() => {})
        await calm()
        if (destroyed) return
        render({ kind: 'loading' })
        let view
        try { view = await asked } catch {}
        busy = false
        if (destroyed) return
        if (!view || typeof view.kind !== 'string' || (view.kind === 'ok' && !Array.isArray(view.amounts))) view = { kind: 'failed' }
        render(view)
        const hold = view.kind === 'ok' && !view.low ? HOLD_OK : HOLD_ERROR
        hideTimer = setTimeout(hide, hold)
        if (view.kind === 'ok') onFace(view.low ? 'teary-eyes' : 'money-eyes', hold)
      },
      destroy() {
        destroyed = true
        clearTimeout(hideTimer)
        try { document.fonts && document.fonts.removeEventListener('loadingdone', onFonts) } catch {}
        el.remove()
        style.remove()
      },
    }
  }

  function PetHost() {
    const [cfg, setCfg] = React.useState(() => globalThis.__NEKOWHALE_PET__ || null)
    React.useEffect(() => {
      let alive = true
      const pull = () => fetch(CONFIG_URL, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((next) => { if (alive && next) setCfg((prev) => (same(prev, next) ? prev : next)) })
        .catch(() => {})
      pull()
      const timer = setInterval(pull, POLL_MS)
      return () => { alive = false; clearInterval(timer) }
    }, [])
    if (!cfg || !cfg.pet || !cfg.base) return null
    return h(PetFrame, { cfg, key: [cfg.base, cfg.character, cfg.height, cfg.bubbles].join('|') })
  }

  function PetFrame({ cfg }) {
    const box = React.useRef(null)
    const frame = React.useRef(null)
    const layer = React.useRef(null)
    // Read at tap time: flipping the balance switch must not reload the iframe.
    const latest = React.useRef(cfg)
    latest.current = cfg
    const [dead, setDead] = React.useState(false)
    const height = Math.max(120, Math.min(480, Number(cfg.height) || 211))
    const width = Math.round(height * ASPECT)

    React.useEffect(() => {
      const el = box.current
      const iframe = frame.current
      if (!el || !iframe || !layer.current) return undefined
      const cleanups = []
      try {
        const service = new URL(`${cfg.base.replace(/\/+$/, '')}/pet.html`)
        service.searchParams.set('character', cfg.character || 'dafeiyu')
        service.searchParams.set('parentOrigin', location.origin)
        service.searchParams.set('bubbles', cfg.bubbles === false ? '0' : '1')
        service.searchParams.set('tap', '1')
        service.searchParams.set('sill', '0')
        service.searchParams.set('crop', '0.06')
        const origin = service.origin
        const send = (command, value) => {
          try { iframe.contentWindow && iframe.contentWindow.postMessage({ channel: CHANNEL, type: 'command', command, value }, origin) } catch {}
        }

        // ---- position: a ratio of the free space, so it survives window resizes
        let pos = loadPos()
        const place = () => {
          const left = pos.rx * Math.max(0, innerWidth - width)
          const top = pos.ry * Math.max(0, innerHeight - height)
          el.style.left = `${Math.round(left)}px`
          el.style.top = `${Math.round(top)}px`
        }
        place()
        addEventListener('resize', place)
        cleanups.push(() => removeEventListener('resize', place))

        // ---- screen px -> CSS px. Drags arrive as screen coordinates from the cross-origin iframe; with page
        // zoom or display scaling they are not 1:1 with CSS pixels, so learn the ratio from ordinary pointer
        // moves over the dsh page (same mapping the browser uses) instead of assuming it.
        let kx = 1
        let ky = 1
        let sample = null
        const learn = (e) => {
          if (sample) {
            const dcx = e.clientX - sample.cx
            const dcy = e.clientY - sample.cy
            if (Math.abs(dcx) >= 24) { const k = (e.screenX - sample.sx) / dcx; if (k > 0.2 && k < 5) kx = k }
            if (Math.abs(dcy) >= 24) { const k = (e.screenY - sample.sy) / dcy; if (k > 0.2 && k < 5) ky = k }
            if (Math.abs(dcx) < 24 && Math.abs(dcy) < 24) return
          }
          sample = { cx: e.clientX, cy: e.clientY, sx: e.screenX, sy: e.screenY }
        }

        // ---- balance card: two taps on the pet within DOUBLE_TAP_MS. A tap is a press the pet reports
        // (drag start / end) that did not move; the pet still plays its own tap reaction for each.
        const local = String(cfg.local || '/x-nekowhale-stickers/pet')
        let faceTimer = 0
        const card = createBalanceCard(layer.current, `${local}/ui`, () => {
          const [, tag] = balanceLocale()
          const qs = new URLSearchParams({ lang: tag, tz: String(-new Date().getTimezoneOffset() * 60) })
          return fetch(`${local}/balance.json?${qs}`, { cache: 'no-store' }).then((r) => r.json())
        }, (face, hold) => {
          clearTimeout(faceTimer)
          send('expression', face)
          faceTimer = setTimeout(() => send('expression', null), hold)
        }, () => took.then(() => new Promise((resolve) => {
          // After the takeover is answered: until the pet is off an action that can carry a bubble (at most
          // BUBBLE_WAIT_MS), then a moment for the bubble to fade.
          const start = performance.now()
          let waited = false
          const check = () => {
            if (!BUBBLY.has(petAction)) { setTimeout(resolve, waited ? 160 : 0); return }
            if (performance.now() - start > BUBBLE_WAIT_MS) { resolve(); return }
            waited = true
            setTimeout(check, 50)
          }
          check()
        })))
        cleanups.push(() => { clearTimeout(faceTimer); card.destroy() })
        let lastTap = 0
        const onTap = () => {
          const now = performance.now()
          const double = latest.current.balance !== false && now - lastTap < DOUBLE_TAP_MS
          lastTap = double ? 0 : now
          if (!double) return
          took = takeOver()
          void card.show()
        }

        // The pet already reacted to both taps, and a tap reaction may be one with a speech bubble ("打招呼",
        // "想一想" = 吃啥?, "开饭啦"), which would sit under the card. Playing a bubble-free action replaces it at once
        // (and clears the pet's tap count, so the double-click does not add up to an annoyed reaction). The first
        // one the pet accepts wins; one it just played may still be cooling down.
        const CALM = ['curious', 'happy', 'nod-yes', 'wink']
        // Actions that show a bubble, and the hand-lowering step after "想一想" during which it lingers.
        const BUBBLY = new Set(['greet', 'think', 'food', 'hand-exit'])
        const BUBBLE_WAIT_MS = 1500
        let petAction = null
        let took = Promise.resolve()
        let seq = 0
        const asks = new Map()
        const ask = (command, value) => new Promise((resolve) => {
          const requestId = `nkw-${++seq}`
          const timer = setTimeout(() => { asks.delete(requestId); resolve(null) }, 1500)
          asks.set(requestId, (d) => { clearTimeout(timer); asks.delete(requestId); resolve(d) })
          try { iframe.contentWindow && iframe.contentWindow.postMessage({ channel: CHANNEL, type: 'command', command, value, requestId }, origin) } catch { resolve(null) }
        })
        const takeOver = async () => {
          for (const id of CALM) {
            const r = await ask('play', id)
            if (!r || (r.ok && r.value === true)) return
          }
        }
        cleanups.push(() => { for (const done of asks.values()) done(null) })

        // ---- messages from the pet
        let ready = false
        let drag = null
        const timer = setTimeout(() => { if (!ready) setDead(true) }, READY_TIMEOUT_MS)
        cleanups.push(() => clearTimeout(timer))
        const onMessage = (e) => {
          if (e.source !== iframe.contentWindow || e.origin !== origin) return
          const d = e.data
          if (!d || d.channel !== CHANNEL) return
          if (d.type === 'status' && d.status && typeof d.status.action === 'string') {
            petAction = d.status.action
          } else if (d.type === 'command-result') {
            const done = asks.get(d.requestId)
            if (done) done(d)
          } else if (d.type === 'ready') {
            ready = true
            send('play', 'greet')
          } else if (d.type === 'error') {
            setDead(true)
          } else if (d.type === 'drag') {
            if (d.phase === 'start' && Number.isFinite(d.screenX)) {
              const r = el.getBoundingClientRect()
              drag = { id: d.pointerId, sx: d.screenX, sy: d.screenY, left: r.left, top: r.top, moved: false }
              send('pointer-leave')
              send('dragging', true)
            } else if (d.phase === 'move' && drag && d.pointerId === drag.id && Number.isFinite(d.screenX)) {
              const dx = (d.screenX - drag.sx) / kx
              const dy = (d.screenY - drag.sy) / ky
              if (!drag.moved && Math.hypot(dx, dy) <= 5) return
              drag.moved = true
              const left = Math.min(Math.max(0, drag.left + dx), Math.max(0, innerWidth - width))
              const top = Math.min(Math.max(0, drag.top + dy), Math.max(0, innerHeight - height))
              pos = {
                rx: innerWidth > width ? left / (innerWidth - width) : 0,
                ry: innerHeight > height ? top / (innerHeight - height) : 0,
              }
              place()
            } else if ((d.phase === 'end' || d.phase === 'cancel') && drag) {
              const tap = d.phase === 'end' && !drag.moved
              drag = null
              send('dragging', false)
              try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch {}
              if (tap) onTap()
            }
          }
        }
        addEventListener('message', onMessage)
        cleanups.push(() => removeEventListener('message', onMessage))

        // ---- eyes follow the pointer (one message per animation frame at most)
        let rafId = 0
        let last = null
        const onPointer = (e) => {
          learn(e)
          last = { x: e.clientX, y: e.clientY }
          if (rafId) return
          rafId = requestAnimationFrame(() => {
            rafId = 0
            if (!ready || drag || !last) return
            const r = iframe.getBoundingClientRect()
            send('pointer', { x: last.x - r.left, y: last.y - r.top })
          })
        }
        const onLeave = () => { if (ready) send('pointer-leave') }
        const onVisibility = () => { if (ready) send('visibility', document.visibilityState === 'visible') }
        addEventListener('pointermove', onPointer, { passive: true })
        document.addEventListener('mouseleave', onLeave)
        addEventListener('blur', onLeave)
        document.addEventListener('visibilitychange', onVisibility)
        cleanups.push(() => {
          removeEventListener('pointermove', onPointer)
          document.removeEventListener('mouseleave', onLeave)
          removeEventListener('blur', onLeave)
          document.removeEventListener('visibilitychange', onVisibility)
          if (rafId) cancelAnimationFrame(rafId)
        })

        iframe.src = service.href
      } catch {
        setDead(true)
      }
      return () => { for (const fn of cleanups) { try { fn() } catch {} } }
    }, [cfg.base, cfg.character, cfg.bubbles, cfg.local, width, height])

    if (dead) return null
    return h('div', {
      ref: box,
      'data-nekowhale-pet': '',
      style: { position: 'fixed', width, height, pointerEvents: 'auto', zIndex: 2147483000 },
    }, h('iframe', {
      ref: frame,
      title: '大肥鱼',
      allow: 'autoplay',
      referrerPolicy: 'strict-origin-when-cross-origin',
      sandbox: 'allow-scripts allow-same-origin',
      style: { width: '100%', height: '100%', border: 0, display: 'block', background: 'transparent', colorScheme: 'normal' },
    }), h('div', {
      ref: layer,
      // The balance card goes here (plain DOM, not React's); 1% of the pet's width is the card's unit.
      style: { position: 'absolute', inset: 0, pointerEvents: 'none', '--nkw-u': `${width / 100}px` },
    }))
  }

  // ---------------------------------------------------------------- settings card (Settings → Plugins)
  // A schema-driven form over dsh's own settings channel (settingsScope: session-authenticated, validated,
  // pushed live). The plugin applies saved values immediately.
  const NS = 'nekowhale-stickers'
  const PKG = 'dsh-nekowhale-stickers'
  const OPTION_LABELS = {
    self: '我就是大肥鱼（适合 DeepSeek）', neutral: '第三方表情包',
    skill: '只挂 skill 目录（约 60 token）', hint: '再加一句提示', index: '提示 + 已启用表情清单', off: '关闭',
    rare: '偶尔', normal: '适中', often: '经常',
  }
  // dsh 0.2 serves the Config schema itself (English descriptions); show the same Chinese labels as 0.1.5.
  const FIELD_LABELS = {
    pet: '在网页界面显示大肥鱼桌宠', petHeight: '桌宠大小（高度，像素）', petBubbles: '桌宠对话气泡', petBalance: '双击桌宠查 DeepSeek 余额',
    persona: '模型身份', promptMode: '常驻提示', frequency: '发表情的频率（提示模式为 hint / index 时生效）',
    indexLimit: 'index 模式最多列出的表情数', searchLimit: '每次搜索返回的条数',
    returnImageToModel: '把图片附给模型看（消耗图像 token）', agentCuration: '允许 agent 自己挑选、开关表情',
    templates: '启用模板制图（想 / 举牌 / 葱卷 / 对联 / 抱）', banwords: '模板文字自动屏蔽敏感词',
    blacklist: '黑名单：一行一条，名字、编号或 tag: / pack: / emotion: 前缀', whitelist: '白名单：非空时只使用匹配的表情',
  }
  // Same groups and order as the 0.1.5 settings section; dsh 0.2 hands over one flat object.
  const GROUPS = [
    ['网页桌宠', ['pet', 'petHeight', 'petBubbles', 'petBalance']],
    ['角色与提示', ['persona', 'promptMode', 'frequency', 'indexLimit']],
    ['表情', ['searchLimit', 'returnImageToModel', 'agentCuration', 'templates', 'banwords', 'blacklist', 'whitelist']],
  ]
  const ORDER = GROUPS.flatMap(([g, keys]) => keys.map((key) => [key, g]))
  function fieldsOf(node, out) {
    out = out || []
    if (!node) return out
    if (node.type === 'intersect') { for (const n of node.list) fieldsOf(n, out); return out }
    if (node.type === 'object') for (const key of Object.keys(node.dict || {})) out.push({ key, node: node.dict[key] })
    const rank = (key) => { const i = ORDER.findIndex(([k]) => k === key); return i < 0 ? ORDER.length : i }
    out.sort((a, b) => rank(a.key) - rank(b.key))
    for (const f of out) { const hit = ORDER.find(([k]) => k === f.key); f.group = hit ? hit[1] : '其他' }
    return out
  }
  function kindOf(n) {
    if (n.type === 'boolean') return 'bool'
    if (n.type === 'union' && (n.list || []).every((x) => x.type === 'const')) return 'enum'
    if (n.type === 'number' || n.type === 'natural') return 'number'
    if (n.type === 'array' && n.inner && n.inner.type === 'string') return 'lines'
    if (n.type === 'string') return 'text'
    return 'json'
  }
  const S = {
    row: { display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(160px, 1.2fr) 64px', gap: 10, alignItems: 'center', margin: '6px 0' },
    label: { display: 'flex', flexDirection: 'column', gap: 2 },
    key: { fontSize: 11, opacity: 0.5, fontFamily: 'monospace' },
    input: { font: 'inherit', padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(127,127,127,.4)', background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' },
    group: { margin: '14px 0 4px', fontSize: 13, fontWeight: 600, opacity: 0.8 },
    btn: { font: 'inherit', padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,.4)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  }

  // Native dropdown lists ignore the page's theme: on a dark dsh theme the options inherited white text on the
  // browser's white list. Read the text colour dsh gives the select and colour the list to match.
  const OPTION_STYLE = { light: { background: '#ffffff', color: '#1b1b1f' }, dark: { background: '#26272d', color: '#ececf1' } }
  function useScheme(ref) {
    const [scheme, setScheme] = React.useState('light')
    React.useEffect(() => {
      const el = ref.current
      const m = el && /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color)
      if (m) setScheme(0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] > 140 ? 'dark' : 'light')
    })
    return scheme
  }

  function Field({ field, value, overridden, disabled, onEdit, onReset }) {
    const n = field.node
    const kind = kindOf(n)
    const id = `nekowhale-${field.key}`
    const picker = React.useRef(null)
    const scheme = useScheme(picker)
    let input
    if (kind === 'bool') input = h('input', { id, type: 'checkbox', checked: !!value, disabled, onChange: (e) => onEdit(e.target.checked) })
    else if (kind === 'enum') input = h('select', { id, ref: picker, value: value == null ? '' : value, disabled, style: { ...S.input, colorScheme: scheme }, onChange: (e) => onEdit(e.target.value) },
      n.list.map((c) => h('option', { key: String(c.value), value: c.value, style: OPTION_STYLE[scheme] }, OPTION_LABELS[c.value] || String(c.value))))
    else if (kind === 'number' && n.meta && n.meta.min != null && n.meta.max != null) input = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      h('input', { id, type: 'range', min: n.meta.min, max: n.meta.max, step: 1, value: value == null ? n.meta.min : value, disabled, style: { flex: 1 }, onChange: (e) => onEdit(Number(e.target.value)) }),
      h('span', { style: { minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, value == null ? '' : String(value)))
    else if (kind === 'number') input = h('input', { id, type: 'number', value: value == null ? '' : value, min: n.meta && n.meta.min, max: n.meta && n.meta.max, disabled, style: S.input, onChange: (e) => onEdit(e.target.value === '' ? undefined : Number(e.target.value)) })
    else if (kind === 'lines') input = h('textarea', { id, rows: 3, value: (value || []).join('\n'), disabled, style: S.input, onChange: (e) => onEdit(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)) })
    else input = h('input', { id, type: 'text', value: value == null ? '' : value, disabled, style: S.input, onChange: (e) => onEdit(e.target.value) })
    return h('div', { style: S.row },
      h('label', { htmlFor: id, style: S.label }, FIELD_LABELS[field.key] || (n.meta && n.meta.description) || field.key, h('span', { style: S.key }, field.key)),
      input,
      overridden ? h('button', { type: 'button', onClick: onReset, disabled, style: S.btn, title: '撤销修改，恢复默认值' }, '恢复默认') : h('span'))
  }

  function SettingsForm(props) {
    const snap = props.useScope((x) => x)
    const mirror = props.useDescribe((x) => x)
    const view = mirror.view && mirror.view.namespaces.find((v) => v.ns === NS)
    const schemaJson = view && view.schema
    const schema = React.useMemo(() => (schemaJson ? props.rehydrate(schemaJson) : undefined), [schemaJson])
    const [draft, setDraft] = React.useState({})
    const [status, setStatus] = React.useState('')
    if (snap.status !== 'ready' || !schema) return h('p', { style: { opacity: 0.6 } }, '加载中…')
    const value = snap.value || {}
    const user = snap.user || {}
    const disabled = !snap.writable
    const dirty = Object.keys(draft).length > 0
    const save = () => {
      const ops = Object.entries(draft).map(([k, v]) => (v === undefined ? { op: 'unset', path: [k] } : { op: 'set', path: [k], value: v }))
      setStatus('保存中…')
      props.mutate(ops, snap.revision).then((ok) => {
        if (ok === false) { setStatus('保存被拒绝，请检查取值后重试'); return }
        setDraft({}); setStatus('已保存，立即生效')
      }, (e) => setStatus(`保存失败：${e && e.message}`))
    }
    let lastGroup = null
    const rows = []
    for (const f of fieldsOf(schema)) {
      if (f.group !== lastGroup) { lastGroup = f.group; rows.push(h('div', { key: `g-${f.group}`, style: S.group }, f.group)) }
      rows.push(h(Field, {
        key: f.key, field: f, disabled,
        value: f.key in draft ? draft[f.key] : value[f.key],
        overridden: Object.prototype.hasOwnProperty.call(user, f.key),
        onEdit: (v) => setDraft((d) => ({ ...d, [f.key]: v })),
        onReset: () => { setStatus('恢复默认…'); props.unset(f.key).then((ok) => setStatus(ok === false ? `${f.key} 恢复默认被拒绝` : `${f.key} 已恢复默认`), (e) => setStatus(`失败：${e && e.message}`)) },
      }))
    }
    return h('div', { 'data-nekowhale-settings': '', style: { fontSize: 13, lineHeight: 1.45 } },
      rows,
      h('div', { style: { display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' } },
        h('button', { type: 'button', disabled: !dirty || disabled, onClick: save, style: S.btn }, '保存'),
        h('button', { type: 'button', disabled: !dirty, onClick: () => setDraft({}), style: S.btn }, '撤销'),
        h('span', { style: { opacity: 0.7, fontSize: 12 } }, status)))
  }

  function Tab(props) {
    return h('div', { style: { padding: 4, maxWidth: 760 } },
      h('p', { style: { margin: '0 0 6px', opacity: 0.65, fontSize: 12 } }, '保存后立即生效，无需重启。未改动的项沿用 cordis.patch.yml。'),
      h(SettingsForm, props))
  }

  module.exports.name = 'nekowhale-stickers-client'
  module.exports.inject = ['slots']
  module.exports.apply = function apply(ctx) {
    try {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'nekowhale-pet', order: 100, label: '大肥鱼' },
        PetHost,
      ))
    } catch (e) {
      try { console.warn('[nekowhale-stickers] pet overlay disabled:', e) } catch {}
    }
    // Settings card: only when the host has the settings services (dsh 0.1.5); a child fiber, so a missing
    // service can never fail the page boot.
    try {
      ctx.inject(['settingsScope', 'settingsSchema'], (sctx) => {
        try {
          const scope = sctx.settingsScope.bind({ namespace: NS })
          const mirror = sctx.settingsScope.describe()
          const face = {
            hooks: {
              scope: { getSnapshot: () => scope.getSnapshot(), subscribe: (l) => scope.subscribe(l) },
              describe: { getSnapshot: () => mirror.getSnapshot(), subscribe: (l) => mirror.subscribe(l) },
            },
            mutate: (ops, rev) => scope.mutate(ops, rev),
            unset: (k) => scope.unset(k),
            rehydrate: (json) => sctx.settingsSchema.rehydrate(json),
          }
          sctx.slots.inject('settings.plugins.tab', () => sctx.slots.register(
            { name: 'settings.plugins.tab', id: 'nekowhale-stickers', order: 50, label: '大肥鱼表情包', inject: () => face }, Tab))
        } catch (e) {
          try { console.warn('[nekowhale-stickers] settings card disabled:', e) } catch {}
        }
      })
    } catch {}
    // dsh 0.2: settingsScope is gone; plugin config lives on the Plugins page (this bundle's detail page),
    // read and written through configForms. Same form, same namespace.
    try {
      ctx.inject(['configForms', 'settingsSchema'], (sctx) => {
        try {
          const form = sctx.configForms.get(NS)
          const mirror = sctx.configForms.describe()
          void Promise.resolve(mirror.ensure && mirror.ensure()).catch(() => {})
          const face = {
            hooks: { scope: form, describe: mirror },
            mutate: (ops, rev) => form.mutate(ops, rev),
            unset: (k) => form.unset(k),
            rehydrate: (json) => sctx.settingsSchema.rehydrate(json),
          }
          sctx.slots.inject('plugins.bundle.config', () => sctx.slots.register(
            { name: 'plugins.bundle.config', key: PKG, inject: () => face },
            (props) => (props.view === 'page' ? h(SettingsForm, props) : null)))
        } catch (e) {
          try { console.warn('[nekowhale-stickers] plugin page config disabled:', e) } catch {}
        }
      })
    } catch {}
  }
  return module.exports
} })
