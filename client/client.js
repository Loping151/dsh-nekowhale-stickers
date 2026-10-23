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
    const [dead, setDead] = React.useState(false)
    const height = Math.max(120, Math.min(480, Number(cfg.height) || 211))
    const width = Math.round(height * ASPECT)

    React.useEffect(() => {
      const el = box.current
      const iframe = frame.current
      if (!el || !iframe) return undefined
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

        // ---- messages from the pet
        let ready = false
        let drag = null
        const timer = setTimeout(() => { if (!ready) setDead(true) }, READY_TIMEOUT_MS)
        cleanups.push(() => clearTimeout(timer))
        const onMessage = (e) => {
          if (e.source !== iframe.contentWindow || e.origin !== origin) return
          const d = e.data
          if (!d || d.channel !== CHANNEL) return
          if (d.type === 'ready') {
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
              drag = null
              send('dragging', false)
              try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch {}
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
    }, [cfg, width, height])

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
    pet: '在网页界面显示大肥鱼桌宠', petHeight: '桌宠大小（高度，像素）', petBubbles: '桌宠对话气泡',
    persona: '模型身份', promptMode: '常驻提示', frequency: '发表情的频率（提示模式为 hint / index 时生效）',
    indexLimit: 'index 模式最多列出的表情数', searchLimit: '每次搜索返回的条数',
    returnImageToModel: '把图片附给模型看（消耗图像 token）', agentCuration: '允许 agent 自己挑选、开关表情',
    templates: '启用模板制图（想 / 举牌 / 葱卷 / 对联 / 抱）', banwords: '模板文字自动屏蔽敏感词',
    blacklist: '黑名单：一行一条，名字、编号或 tag: / pack: / emotion: 前缀', whitelist: '白名单：非空时只使用匹配的表情',
  }
  // Same groups and order as the 0.1.5 settings section; dsh 0.2 hands over one flat object.
  const GROUPS = [
    ['网页桌宠', ['pet', 'petHeight', 'petBubbles']],
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

  function Field({ field, value, overridden, disabled, onEdit, onReset }) {
    const n = field.node
    const kind = kindOf(n)
    const id = `nekowhale-${field.key}`
    let input
    if (kind === 'bool') input = h('input', { id, type: 'checkbox', checked: !!value, disabled, onChange: (e) => onEdit(e.target.checked) })
    else if (kind === 'enum') input = h('select', { id, value: value == null ? '' : value, disabled, style: S.input, onChange: (e) => onEdit(e.target.value) },
      n.list.map((c) => h('option', { key: String(c.value), value: c.value }, OPTION_LABELS[c.value] || String(c.value))))
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
