// Parceiros do ZIVO (restaurantes com desconto para riders, mecânicos, etc.)
// Cada parceiro tem uma oferta, onde fica (uma ou várias moradas) e, opcionalmente, dias/horas em
// que o desconto vale (ex.: só nas horas menos movimentadas). Funções puras → testadas.

export type PartnerCategory = 'restaurante' | 'cafe' | 'mecanico' | 'outro'
export type OfferType = 'percent' | 'item' | 'gratis' | 'outro'

export interface PartnerLocation { lat: number; lng: number; address?: string }
/** dias: 0=domingo … 6=sábado; horas "HH:MM" (pode passar da meia-noite: 22:00–02:00) */
export interface PartnerWindow { days: number[]; from: string; to: string }

export interface PartnerDoc {
  id: string
  name: string
  category?: PartnerCategory | string
  emoji?: string
  color?: string
  /** texto curto do desconto, ex.: "15% OFF", "Menu rider €6" */
  offer: string
  offerType?: OfferType
  /** detalhe/condições, ex.: "Só no menu X", "Não acumula" */
  offerDetail?: string
  description?: string
  howTo?: string
  locations?: PartnerLocation[]
  /** sem janelas = vale sempre que o restaurante está aberto */
  windows?: PartnerWindow[]
  active?: boolean
  /** anúncio pago: aparece como pin no mapa e no fim da entrega (só plano Free) */
  sponsored?: boolean
  // legado
  lat?: number | null
  lng?: number | null
  mapboxQuery?: string
  impressoes?: number
  cliques?: number
}

export const CATEGORIAS: { key: PartnerCategory; label: string; emoji: string }[] = [
  { key: 'restaurante', label: 'Comida', emoji: '🍔' },
  { key: 'cafe', label: 'Café', emoji: '☕' },
  { key: 'mecanico', label: 'Mecânico', emoji: '🔧' },
  { key: 'outro', label: 'Outros', emoji: '🤝' },
]

export const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function categoriaDe(p: PartnerDoc): PartnerCategory {
  const c = (p.category ?? '').toLowerCase()
  if (c === 'restaurante' || c === 'food' || c === 'comida') return 'restaurante'
  if (c === 'cafe' || c === 'café' || c === 'coffee') return 'cafe'
  if (c === 'mecanico' || c === 'mechanic') return 'mecanico'
  return c ? 'outro' : 'restaurante'
}

export function moradasDe(p: PartnerDoc): PartnerLocation[] {
  const out = (p.locations ?? []).filter(l => isFinite(l?.lat) && isFinite(l?.lng))
  if (!out.length && p.lat != null && p.lng != null && isFinite(p.lat) && isFinite(p.lng)) out.push({ lat: p.lat, lng: p.lng })
  return out
}

const min = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim())
  if (!m) return NaN
  return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2])
}

/** O desconto vale agora? (sem janelas = sempre) */
export function disponivelAgora(p: PartnerDoc, agora: Date = new Date()): boolean {
  if (p.active === false) return false
  const ws = (p.windows ?? []).filter(w => w?.days?.length && isFinite(min(w.from)) && isFinite(min(w.to)))
  if (!ws.length) return true
  const d = agora.getDay(), t = agora.getHours() * 60 + agora.getMinutes()
  for (const w of ws) {
    const a = min(w.from), b = min(w.to)
    if (a <= b) { if (w.days.includes(d) && t >= a && t < b) return true }
    else {
      // passa da meia-noite: conta a partir do dia de início até de manhã do dia seguinte
      if (w.days.includes(d) && t >= a) return true
      if (w.days.includes((d + 6) % 7) && t < b) return true
    }
  }
  return false
}

/** "Seg–Sex 14:00–17:00 · Sáb 10:00–12:00" */
export function textoHorario(p: PartnerDoc): string {
  const ws = (p.windows ?? []).filter(w => w?.days?.length)
  if (!ws.length) return 'Todos os dias'
  return ws.map(w => `${textoDias(w.days)} ${w.from}–${w.to}`).join(' · ')
}

export function textoDias(days: number[]): string {
  const s = Array.from(new Set(days)).filter(d => d >= 0 && d <= 6).sort((a, b) => a - b)
  if (s.length === 7) return 'Todos os dias'
  if (s.join() === '1,2,3,4,5') return 'Seg–Sex'
  if (s.join() === '0,6') return 'Fim de semana'
  // sequência contínua
  if (s.length >= 3 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)) return `${DIAS_CURTO[s[0]]}–${DIAS_CURTO[s[s.length - 1]]}`
  return s.map(d => DIAS_CURTO[d]).join(', ')
}

/** Próxima vez que o desconto vale (para mostrar "Volta às 14:00" / "Seg 14:00"). */
export function proximaAbertura(p: PartnerDoc, agora: Date = new Date()): string | null {
  const ws = (p.windows ?? []).filter(w => w?.days?.length && isFinite(min(w.from)))
  if (!ws.length || disponivelAgora(p, agora)) return null
  const t0 = agora.getHours() * 60 + agora.getMinutes()
  for (let k = 0; k < 8; k++) {
    const d = (agora.getDay() + k) % 7
    const hoje = ws.filter(w => w.days.includes(d)).map(w => min(w.from)).filter(a => k > 0 || a > t0).sort((a, b) => a - b)
    if (hoje.length) {
      const a = hoje[0]
      const hh = `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
      return k === 0 ? `Hoje às ${hh}` : k === 1 ? `Amanhã às ${hh}` : `${DIAS_CURTO[d]} às ${hh}`
    }
  }
  return null
}

export function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Morada mais próxima do rider (ou a primeira, sem GPS). */
export function maisProxima(p: PartnerDoc, aqui?: { lat: number; lng: number } | null): { loc: PartnerLocation; dist: number | null } | null {
  const ls = moradasDe(p)
  if (!ls.length) return null
  if (!aqui) return { loc: ls[0], dist: null }
  let best = ls[0], bd = Infinity
  for (const l of ls) { const d = distanciaM(aqui, l); if (d < bd) { bd = d; best = l } }
  return { loc: best, dist: bd }
}

export function textoDistancia(m: number | null | undefined): string {
  if (m == null || !isFinite(m)) return ''
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

export interface FiltroParceiros { categorias: PartnerCategory[]; soAgora: boolean }

/** Lista filtrada e ordenada: disponíveis primeiro, depois mais perto. */
export function filtrarParceiros(ps: PartnerDoc[], f: FiltroParceiros, aqui?: { lat: number; lng: number } | null, agora: Date = new Date()) {
  return ps
    .filter(p => p.active !== false)
    .filter(p => !f.categorias.length || f.categorias.includes(categoriaDe(p)))
    .map(p => ({ p, agora: disponivelAgora(p, agora), perto: maisProxima(p, aqui) }))
    .filter(x => !f.soAgora || x.agora)
    .sort((a, b) => (Number(b.agora) - Number(a.agora)) || ((a.perto?.dist ?? Infinity) - (b.perto?.dist ?? Infinity)) || a.p.name.localeCompare(b.p.name))
}

/** Escolhe o anúncio para o fim da entrega: patrocinado, disponível agora e perto (≤ raio). */
export function anuncioPerto(ps: PartnerDoc[], aqui: { lat: number; lng: number } | null, raioM = 1500, agora: Date = new Date()) {
  if (!aqui) return null
  const c = ps
    .filter(p => p.active !== false && p.sponsored && disponivelAgora(p, agora))
    .map(p => ({ p, perto: maisProxima(p, aqui) }))
    .filter(x => x.perto && (x.perto.dist ?? Infinity) <= raioM)
    .sort((a, b) => (a.perto!.dist ?? 0) - (b.perto!.dist ?? 0))
  return c[0] ?? null
}
