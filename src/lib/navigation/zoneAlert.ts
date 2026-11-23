// src/lib/navigation/zoneAlert.ts
// MODO ALERTA: quando o rider escolhe (ou é obrigado a seguir) uma rota que passa por zonas de risco,
// o app fica em alerta o tempo todo até ele mudar de rota ou passar por TODAS as zonas.
// Lógica pura (sem React) para poder ser testada.
import { LngLat } from './geo'
import { AvoidZone, entryExitAlong } from './zones'

export interface ZoneSpan {
  zone: AvoidZone
  entry: number   // metros ao longo da rota onde a rota entra na zona
  exit: number    // metros ao longo da rota onde sai
}

export type AlertPhase = 'none' | 'ahead' | 'approaching' | 'inside' | 'clear'

export interface ZoneAlertState {
  phase: AlertPhase
  zoneId?: string
  zoneName?: string
  level?: AvoidZone['level']
  distToEntry?: number
  distToExit?: number
  remaining: number   // zonas que ainda faltam (inclui a atual)
  total: number
}

/** Trechos da rota dentro de cada zona, em ordem de chegada. */
export function zoneSpansOnRoute(coords: LngLat[], zones: AvoidZone[]): ZoneSpan[] {
  const spans: ZoneSpan[] = []
  for (const z of zones) {
    const ee = entryExitAlong(coords, z)
    if (ee) spans.push({ zone: z, entry: ee.entry, exit: ee.exit })
  }
  return spans.sort((a, b) => a.entry - b.entry)
}

const REMINDER_MS = 60000

export class ZoneAlertGuide {
  private said = new Set<string>()
  private lastReminder = 0
  private clearAnnounced = false
  private insideId: string | null = null
  /** zona onde fica o destino (entrega dentro de zona): avisos com outra frase e um aviso a ~1 km */
  destinoId: string | null = null

  constructor(readonly spans: ZoneSpan[]) {}

  setDestino(id: string | null): this { this.destinoId = id; return this }

  /** Depois de um recálculo: mantém o que já foi falado (não repete "você entrou" na mesma zona). */
  adoptFrom(prev: ZoneAlertGuide | null): this {
    if (prev) {
      prev.said.forEach(k => this.said.add(k))
      this.insideId = prev.insideId
      this.lastReminder = prev.lastReminder
    }
    return this
  }

  /**
   * @param along     metros percorridos na rota
   * @param gpsInside ids das zonas onde o GPS está agora (mesmo fora da rota)
   * @param speedMps  velocidade
   * @param now       relógio (ms)
   * @param extraZones zonas fora da rota (para identificar a zona quando o GPS entra numa delas)
   */
  update(along: number, gpsInside: Set<string>, speedMps: number, now = Date.now(), extraZones: AvoidZone[] = []): { state: ZoneAlertState; speak: string | null } {
    const total = this.spans.length
    if (!total && !gpsInside.size && !this.insideId) return { state: { phase: 'none', remaining: 0, total: 0 }, speak: null }

    // zona atual / próxima na rota
    const idx = this.spans.findIndex(s => s.exit > along - 5)
    const remaining = idx < 0 ? 0 : total - idx
    const cur = idx < 0 ? null : this.spans[idx]
    let speak: string | null = null

    // saiu de uma zona (pela rota ou pelo GPS)
    if (this.insideId) {
      const stillOnSpan = cur && cur.zone.id === this.insideId && along >= cur.entry - 5
      if (!stillOnSpan && !gpsInside.has(this.insideId)) {
        this.insideId = null
        speak = remaining > 0
          ? `Você saiu da zona de risco. ${remaining === 1 ? 'Falta 1 zona' : `Faltam ${remaining} zonas`} na rota.`
          : 'Você saiu da zona de risco. Rota livre de zonas de risco.'
        if (remaining === 0) this.clearAnnounced = true
      }
    }

    // dentro de uma zona: pela posição na rota ou porque o GPS está dentro de uma zona
    const gpsZone = gpsInside.size
      ? this.spans.find(s => gpsInside.has(s.zone.id))?.zone ?? extraZones.find(z => gpsInside.has(z.id)) ?? null
      : null
    const onSpan = cur && along >= cur.entry - 5 && along <= cur.exit ? cur : null
    const insideZone = onSpan?.zone ?? gpsZone
    if (insideZone) {
      if (this.insideId !== insideZone.id) {
        this.insideId = insideZone.id
        this.lastReminder = now
        if (!this.said.has(`in:${insideZone.id}`)) {
          this.said.add(`in:${insideZone.id}`); this.said.add(`warn:${insideZone.id}`)
          speak = `Atenção: você entrou em zona de risco${insideZone.name ? `, ${insideZone.name}` : ''}. Fique atento.`
        }
      } else if (now - this.lastReminder >= REMINDER_MS && !speak) {
        this.lastReminder = now
        const left = onSpan ? Math.max(0, onSpan.exit - along) : null
        speak = left != null && left > 30
          ? `Ainda em zona de risco. Saída em ${spoken(left)}.`
          : 'Ainda em zona de risco. Fique atento.'
      }
      return {
        state: {
          phase: 'inside', zoneId: insideZone.id, zoneName: insideZone.name, level: insideZone.level,
          distToExit: onSpan ? Math.max(0, onSpan.exit - along) : undefined, remaining: Math.max(remaining, 1), total,
        },
        speak,
      }
    }

    if (!cur) {
      if (total && !this.clearAnnounced) { this.clearAnnounced = true; speak = speak ?? 'Rota livre de zonas de risco.' }
      return { state: { phase: total ? 'clear' : 'none', remaining: 0, total }, speak }
    }

    const distToEntry = Math.max(0, cur.entry - along)
    const warnAt = Math.max(300, speedMps * 30)   // ~30 s antes, nunca menos de 300 m
    const phase: AlertPhase = distToEntry <= warnAt ? 'approaching' : 'ahead'
    const eDestino = !!this.destinoId && cur.zone.id === this.destinoId
    // destino dentro de zona: lembrete extra a ~1 km (numa viagem longa é fácil esquecer)
    if (eDestino && phase === 'ahead' && distToEntry <= 1000 && !this.said.has(`early:${cur.zone.id}`) && !speak) {
      this.said.add(`early:${cur.zone.id}`)
      speak = `Lembrete: o destino fica dentro de zona de risco${cur.zone.name ? `, ${cur.zone.name}` : ''}. Entras em ${spoken(distToEntry)}.`
    }
    if (phase === 'approaching' && !this.said.has(`warn:${cur.zone.id}`) && !speak) {
      this.said.add(`warn:${cur.zone.id}`)
      speak = eDestino
        ? `Atenção: vais entrar em zona de risco em ${spoken(distToEntry)}${cur.zone.name ? `, ${cur.zone.name}` : ''}. O destino fica lá dentro.`
        : `Atenção: zona de risco em ${spoken(distToEntry)}${cur.zone.name ? `, ${cur.zone.name}` : ''}.`
    }
    return {
      state: { phase, zoneId: cur.zone.id, zoneName: cur.zone.name, level: cur.zone.level, distToEntry, remaining, total },
      speak,
    }
  }
}

function spoken(m: number): string {
  if (m >= 950) return `${String(Math.round(m / 100) / 10).replace('.', ',')} quilômetros`
  return `${m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10)} metros`
}
