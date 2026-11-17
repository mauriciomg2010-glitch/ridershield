declare global {
  interface Window { __audioCtx?: AudioContext }
}

// ── Alarme por <audio> (iPhone) ─────────────────────────────────────────────
// No iPhone o Web Audio fica MUDO com o botão de silêncio ligado e só toca depois de um toque
// no ecrã. Um elemento <audio> desbloqueado no 1º toque do utilizador toca mesmo com o silêncio
// ligado e pode voltar a tocar mais tarde sem novo toque. Gera-se o som (WAV) no próprio aparelho.
let sosAudio: HTMLAudioElement | null = null
let audioUnlocked = false

function sirenWavUrl(): string {
  const rate = 16000, secs = 4.5, n = Math.floor(rate * secs)
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, n * 2, true)
  // mesmo padrão do Web Audio: 3 curtos (880 Hz), 3 longos (660 Hz), 3 curtos
  const bips: [number, number, number][] = [
    [0, 0.15, 880], [0.25, 0.15, 880], [0.5, 0.15, 880],
    [0.95, 0.45, 660], [1.5, 0.45, 660], [2.05, 0.45, 660],
    [2.7, 0.15, 880], [2.95, 0.15, 880], [3.2, 0.15, 880],
  ]
  for (let i = 0; i < n; i++) {
    const t = i / rate
    let val = 0
    for (const [st, du, f] of bips) {
      if (t >= st && t < st + du) {
        const env = Math.min(1, (t - st) / 0.01, (st + du - t) / 0.01)
        val = (Math.sin(2 * Math.PI * f * t) >= 0 ? 1 : -1) * 0.55 * env   // onda quadrada
        break
      }
    }
    v.setInt16(44 + i * 2, Math.round(val * 32767), true)
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

function getSosAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!sosAudio) {
    try {
      sosAudio = new Audio(sirenWavUrl())
      sosAudio.loop = true
      sosAudio.preload = 'auto'
      ;(sosAudio as any).playsInline = true
    } catch { sosAudio = null }
  }
  return sosAudio
}

/** Desbloqueia o som no 1º toque/clique em qualquer parte do app (exigência do iPhone/Chrome). */
export function installAudioUnlock() {
  if (typeof window === 'undefined' || (window as any).__zivoAudioUnlock) return
  ;(window as any).__zivoAudioUnlock = true
  const unlock = () => {
    const a = getSosAudio()
    if (a && !audioUnlocked) {
      a.muted = true
      a.play().then(() => {
        if (!isEmergencySoundPlaying()) { a.pause(); a.currentTime = 0 }
        a.muted = false
        audioUnlocked = true
      }).catch(() => { a.muted = false })
    }
    getCtx()
    if (audioUnlocked) {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('touchend', unlock, true)
    }
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('touchend', unlock, true)
}
if (typeof window !== 'undefined') installAudioUnlock()

let soundInterval: ReturnType<typeof setInterval> | null = null
let soundTimeout: ReturnType<typeof setTimeout> | null = null
// osciladores agendados — para conseguir parar o som na hora sem suspender o AudioContext
const liveNodes = new Set<OscillatorNode>()
// alarme toca no máximo 2 minutos se ninguém parar
const MAX_ALARM_MS = 2 * 60 * 1000

function getCtx(): AudioContext | null {
  try {
    if (!window.__audioCtx || window.__audioCtx.state === 'closed') {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return null
      window.__audioCtx = new AC()
    }
    if (window.__audioCtx.state === 'suspended') {
      window.__audioCtx.resume()
    }
    return window.__audioCtx
  } catch {
    return null
  }
}

export function initAudioContext() {
  getCtx()
}

function beep(ctx: AudioContext, freq: number, start: number, duration: number, volume = 0.4) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'square'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.01)
  gain.gain.setValueAtTime(volume, start + duration - 0.01)
  gain.gain.linearRampToValueAtTime(0, start + duration)
  osc.start(start)
  osc.stop(start + duration + 0.05)
  liveNodes.add(osc)
  osc.onended = () => liveNodes.delete(osc)
}

function playCycle() {
  const ctx = getCtx()
  if (!ctx) return
  try {
    const t = ctx.currentTime
    // SOS: 3 short, 3 long, 3 short
    beep(ctx, 880, t + 0.0,  0.15)
    beep(ctx, 880, t + 0.25, 0.15)
    beep(ctx, 880, t + 0.50, 0.15)
    beep(ctx, 660, t + 0.95, 0.45)
    beep(ctx, 660, t + 1.50, 0.45)
    beep(ctx, 660, t + 2.05, 0.45)
    beep(ctx, 880, t + 2.70, 0.15)
    beep(ctx, 880, t + 2.95, 0.15)
    beep(ctx, 880, t + 3.20, 0.15)
  } catch (e) {
    console.warn('[Sound] Playback failed:', e)
  }
}

let htmlPlaying = false

export function playEmergencySound() {
  if (soundInterval || htmlPlaying) return
  // 1º tenta o <audio> (funciona no iPhone em modo silêncio); se falhar, usa o Web Audio
  const a = getSosAudio()
  if (a) {
    a.currentTime = 0
    a.muted = false
    a.play().then(() => {
      htmlPlaying = true
      soundTimeout = setTimeout(stopEmergencySound, MAX_ALARM_MS)
    }).catch(() => playWebAudio())
    return
  }
  playWebAudio()
}

function playWebAudio() {
  if (soundInterval) return
  const ctx = getCtx()
  // se o contexto ainda estiver retomando, espera ele ficar ativo antes de agendar os bipes
  if (ctx && ctx.state !== 'running') ctx.resume().then(playCycle).catch(() => {})
  else playCycle()
  soundInterval = setInterval(playCycle, 4500)
  soundTimeout = setTimeout(stopEmergencySound, MAX_ALARM_MS)
}

export function isEmergencySoundPlaying() {
  return soundInterval !== null || htmlPlaying
}

export async function ensureAudioUnlocked() {
  getCtx()
  if (window.__audioCtx?.state === 'suspended') {
    await window.__audioCtx.resume()
  }
}

// BUG CORRIGIDO: antes esta função SUSPENDIA o AudioContext. Como o alarme chamava
// stop() logo antes de play(), o contexto era suspenso por cima dos bipes recém-agendados
// e o som não tocava. Agora só interrompe os bipes; o contexto continua ativo.
export function stopEmergencySound() {
  if (sosAudio) { try { sosAudio.pause(); sosAudio.currentTime = 0 } catch {} }
  htmlPlaying = false
  if (soundInterval) {
    clearInterval(soundInterval)
    soundInterval = null
  }
  if (soundTimeout) {
    clearTimeout(soundTimeout)
    soundTimeout = null
  }
  liveNodes.forEach(o => { try { o.stop() } catch {} })
  liveNodes.clear()
  try { navigator.vibrate?.(0) } catch {}
}

export function playEmergencyConfirmSound() {
  try {
    const ctx = getCtx()
    if (!ctx) return
    const t = ctx.currentTime
    beep(ctx, 1000, t + 0.0,  0.1)
    beep(ctx, 1000, t + 0.15, 0.1)
    beep(ctx, 1000, t + 0.30, 0.3)
  } catch {}
}

export function vibrateEmergency() {
  if ('vibrate' in navigator) {
    navigator.vibrate([
      200, 100, 200, 100, 200, 300,
      500, 100, 500, 100, 500, 300,
      200, 100, 200, 100, 200,
    ])
  }
}
