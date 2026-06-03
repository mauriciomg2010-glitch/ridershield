declare global {
  interface Window { __audioCtx?: AudioContext }
}

let soundInterval: ReturnType<typeof setInterval> | null = null

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

export function playEmergencySound() {
  if (soundInterval) return
  playCycle()
  soundInterval = setInterval(playCycle, 4500)
}

export async function ensureAudioUnlocked() {
  getCtx()
  if (window.__audioCtx?.state === 'suspended') {
    await window.__audioCtx.resume()
  }
}

export function stopEmergencySound() {
  if (soundInterval) {
    clearInterval(soundInterval)
    soundInterval = null
  }
  try {
    if (window.__audioCtx && window.__audioCtx.state !== 'closed') {
      window.__audioCtx.suspend()
    }
  } catch {}
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
