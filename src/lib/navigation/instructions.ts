// src/lib/navigation/instructions.ts
// Textos das manobras em português (Brasil) e o "guia de voz" no estilo Google Maps:
// avisa com antecedência (ex.: "Em 300 metros, vire à direita") e de novo na hora da manobra.

const MOD: Record<string, string> = {
  uturn: 'faça o retorno',
  'sharp right': 'vire acentuadamente à direita',
  right: 'vire à direita',
  'slight right': 'mantenha-se à direita',
  straight: 'siga em frente',
  'slight left': 'mantenha-se à esquerda',
  left: 'vire à esquerda',
  'sharp left': 'vire acentuadamente à esquerda',
}
const side = (m?: string) => (!m ? '' : m.includes('left') ? ' à esquerda' : m.includes('right') ? ' à direita' : '')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Instrução em pt-BR montada a partir do tipo/modificador da manobra (reserva quando não vem pronta). */
export function buildInstruction(step: any): string {
  const m = step?.maneuver ?? {}
  const type: string = m.type ?? ''
  const mod: string | undefined = m.modifier
  const road: string = step?.name || step?.ref || ''
  const na = road ? ` na ${road}` : ''
  const pela = road ? ` pela ${road}` : ''
  switch (type) {
    case 'depart': return `Siga${pela || ' em frente'}`
    case 'arrive': return mod && (mod.includes('left') || mod.includes('right')) ? `O destino está${side(mod)}` : 'Você chegou ao destino'
    case 'turn': case 'end of road':
      if (mod === 'straight') return `Siga em frente${pela}`
      return cap(MOD[mod ?? ''] ?? 'continue') + na
    case 'continue': case 'new name': case 'notification':
      if (mod === 'uturn') return `Faça o retorno${na}`
      if (mod && mod !== 'straight' && type === 'continue') return cap(MOD[mod] ?? 'continue') + pela
      return `Continue${pela}`
    case 'merge': return `Entre${side(mod)}${road ? ` na ${road}` : ' na via'}`
    case 'on ramp': return `Pegue o acesso${side(mod)}${road ? ` para ${road}` : ''}`
    case 'off ramp': return `Pegue a saída${side(mod)}${road ? ` para ${road}` : ''}`
    case 'fork': return `Na bifurcação, mantenha-se${side(mod) || ' em frente'}${na}`
    case 'roundabout': case 'rotary':
      return m.exit ? `Na rotatória, pegue a ${m.exit}ª saída${road ? ` para ${road}` : ''}` : `Entre na rotatória${road ? ` em direção a ${road}` : ''}`
    case 'roundabout turn': return `Na rotatória, ${MOD[mod ?? ''] ?? 'continue'}`
    case 'exit roundabout': case 'exit rotary': return `Saia da rotatória${road ? ` para ${road}` : ''}`
    case 'use lane': return cap(MOD[mod ?? ''] ?? 'continue') + pela
    default: return `Continue${pela}`
  }
}

// Detecta instrução que veio em inglês (ex.: rota antiga sem language=pt-BR)
const EN = /\b(turn|left|right|continue|head|keep|merge|roundabout|exit|arrive|destination|onto|toward|slight)\b/i

/** Texto da manobra para o painel: usa o do servidor (pt-BR) e cai para o nosso se faltar ou vier em inglês. */
export function instructionText(step: any): string {
  const t: string = step?.maneuver?.instruction ?? ''
  if (!t || EN.test(t)) return buildInstruction(step)
  return t.replace(/\.$/, '')
}

/** Distância no estilo do Google: "50 m", "350 m", "1,2 km", "12 km". */
export function formatDistance(m: number): string {
  if (!isFinite(m) || m < 0) return ''
  if (m < 1000) {
    const r = m < 100 ? Math.round(m / 5) * 5 : m < 500 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50
    return r >= 1000 ? '1 km' : `${r} m`
  }
  const km = m / 1000
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`
}

/** Distância falada: "300 metros", "1 quilômetro", "1,5 quilômetros". */
export function spokenDistance(m: number): string {
  if (m >= 950) {
    const km = Math.round(m / 100) / 10
    if (km === 1) return '1 quilômetro'
    return `${String(km).replace('.', ',')} quilômetros`
  }
  const r = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10)
  return `${r} metros`
}

/** Tempo: "8 min", "1 h 05 min". */
export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), r = min % 60
  return r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * Decide o que falar a cada atualização de posição.
 * - aviso antecipado (distâncias maiores em velocidade alta)
 * - aviso "agora" alguns segundos antes da manobra, encadeando a seguinte se estiver perto
 * - cada aviso é falado uma única vez por manobra
 */
export class VoiceGuide {
  private said = new Set<string>()
  private lastStep = -1
  private lastPromptAt = new Map<number, number>()  // distância em que o último aviso da manobra foi falado

  reset() { this.said.clear(); this.lastStep = -1; this.lastPromptAt.clear() }

  next(steps: any[], stepIdx: number, distToManeuver: number, speedMps: number, nextGap?: number): string | null {
    const step = steps[stepIdx]
    if (!step) return null
    const type = step.maneuver?.type
    const v = Math.max(0, speedMps || 0)
    const text = instructionText(step)

    // Acabou de completar uma manobra e a próxima está longe → "Siga por 2 km"
    if (stepIdx !== this.lastStep) {
      const first = this.lastStep === -1
      this.lastStep = stepIdx
      if (first) {
        // início da navegação: "Siga para norte na Rua X por 2 quilômetros"
        const start = steps[0]?.maneuver?.type === 'depart' ? instructionText(steps[0]) : 'Siga a rota'
        if (distToManeuver > 1500 && type !== 'arrive') return `${start} por ${spokenDistance(distToManeuver)}`
        if (distToManeuver > 250) return start
      } else if (distToManeuver > 1500 && type !== 'arrive') {
        this.said.add(`${stepIdx}:start`)
        return `Siga em frente por ${spokenDistance(distToManeuver)}`
      }
    }

    // limiares por velocidade
    const far = v > 14 ? [1000, 400] : v > 5 ? [400, 150] : [200, 60]
    const nowAt = Math.max(v > 5 ? 35 : 15, v * 4)

    if (type === 'arrive') {
      // "Você chegou ao destino" é falado pela tela quando a chegada é confirmada
      if (distToManeuver <= nowAt + 10) { this.said.add(`${stepIdx}:now`); return null }
      if (distToManeuver <= far[1] && distToManeuver > nowAt + 30 && !this.said.has(`${stepIdx}:f1`)) {
        this.said.add(`${stepIdx}:f1`)
        return `Em ${spokenDistance(distToManeuver)}, o destino`
      }
      return null
    }

    if (distToManeuver <= nowAt) {
      if (this.said.has(`${stepIdx}:now`)) return null
      this.said.add(`${stepIdx}:now`); this.said.add(`${stepIdx}:f0`); this.said.add(`${stepIdx}:f1`)
      const nx = steps[stepIdx + 1]
      if (nx && nextGap != null && nextGap < 120 && nx.maneuver?.type !== 'arrive') {
        return `${text}. Depois, ${lower(instructionText(nx))}`
      }
      return text
    }
    for (let k = 0; k < far.length; k++) {
      const key = `${stepIdx}:f${k}`
      // fala quando entra na faixa do limiar (com folga para GPS que pula)
      if (distToManeuver <= far[k] && distToManeuver > (far[k + 1] ?? nowAt) + 20 && !this.said.has(key)) {
        for (let j = 0; j <= k; j++) this.said.add(`${stepIdx}:f${j}`)
        // não repete o mesmo aviso se o anterior foi há menos de 100 m (trechos curtos)
        const prev = this.lastPromptAt.get(stepIdx)
        if (prev != null && prev - distToManeuver < 100) return null
        this.lastPromptAt.set(stepIdx, distToManeuver)
        return `Em ${spokenDistance(distToManeuver)}, ${lower(text)}`
      }
    }
    return null
  }
}
