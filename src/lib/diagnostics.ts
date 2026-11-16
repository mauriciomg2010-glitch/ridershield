// src/lib/diagnostics.ts
// Modo diagnóstico: grava GPS, bússola, câmara e eventos da navegação num ficheiro
// para comparar iPhone × Android. Só grava quando o rider liga no menu. Fica no aparelho
// até ele exportar e enviar.
const FLAG = 'zivo_diag_on'
const STORE = 'zivo_diag_log'
const MAX = 20000

type Entry = [number, string, Record<string, unknown>]   // [ms desde o início, tipo, dados]

let on = false
let t0 = Date.now()
let buf: Entry[] = []
const lastByKey = new Map<string, number>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function persist() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { localStorage.setItem(STORE, JSON.stringify({ t0, buf })) } catch { /* cheio: fica só em memória */ }
  }, 3000)
}

if (typeof window !== 'undefined') {
  try {
    on = localStorage.getItem(FLAG) === '1'
    const raw = localStorage.getItem(STORE)
    if (raw) { const j = JSON.parse(raw); t0 = j.t0 ?? Date.now(); buf = Array.isArray(j.buf) ? j.buf : [] }
  } catch {}
  window.addEventListener('error', e => diag('erro', { msg: String(e.message).slice(0, 200), src: String(e.filename ?? '').slice(-60), line: e.lineno }))
  window.addEventListener('unhandledrejection', e => diag('erro', { msg: String((e as any).reason?.message ?? (e as any).reason).slice(0, 200) }))
}

export function diagOn() { return on }

/** Regista um evento. `everyMs` limita a frequência por tipo (ex.: bússola a 5 por segundo). */
export function diag(type: string, data: Record<string, unknown> = {}, everyMs = 0, key = type) {
  if (!on) return
  const now = Date.now()
  if (everyMs > 0) {
    const last = lastByKey.get(key) ?? 0
    if (now - last < everyMs) return
    lastByKey.set(key, now)
  }
  buf.push([now - t0, type, data])
  if (buf.length > MAX) buf.splice(0, buf.length - MAX)
  persist()
  if (buf.length % 50 === 0) listeners.forEach(f => f())
}

export function setDiag(enabled: boolean) {
  on = enabled
  try { localStorage.setItem(FLAG, enabled ? '1' : '0') } catch {}
  if (enabled) diag('inicio', deviceInfo())
  listeners.forEach(f => f())
}

export function diagCount() { return buf.length }
export function onDiagChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } }

export function clearDiag() {
  buf = []; t0 = Date.now()
  try { localStorage.removeItem(STORE) } catch {}
  if (on) diag('inicio', deviceInfo())
  listeners.forEach(f => f())
}

function deviceInfo(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}
  const nav: any = navigator
  return {
    ua: nav.userAgent,
    plataforma: /iPhone|iPad|iPod/.test(nav.userAgent) ? 'iOS' : /Android/.test(nav.userAgent) ? 'Android' : 'outro',
    ecra: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
    pwa: window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true,
    versao: (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7),
    hora: new Date().toISOString(),
  }
}

/** Gera o ficheiro e abre a partilha do sistema (WhatsApp, e-mail, Ficheiros…) ou descarrega. */
export async function exportDiag(): Promise<void> {
  const info = deviceInfo()
  const nome = `zivo-diag-${info.plataforma}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
  const conteudo = JSON.stringify({ formato: 'zivo-diag-1', info, t0: new Date(t0).toISOString(), campos: '[ms, tipo, dados]', eventos: buf })
  const file = new File([conteudo], nome, { type: 'application/json' })
  const nav: any = navigator
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: 'Diagnóstico ZIVO' }); return } catch (e: any) { if (e?.name === 'AbortError') return }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
