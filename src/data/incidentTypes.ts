// Tipos de report — segurança (o diferencial do ZIVO) + estrada (estilo Google Maps).
// Os tipos antigos continuam aqui com `hidden: true` para os reports já gravados aparecerem bem.

export interface SubCategory {
  id: string
  label: string
}

export type ReportGroup = 'seguranca' | 'estrada'

export interface IncidentTypeDef {
  id: string
  label: string
  emoji: string          // reserva para textos (toast/voz); a interface usa o ícone desenhado
  color: string
  group: ReportGroup
  priority: number       // 1 = maior risco
  initialScore: number   // 0–100 peso base de confiança
  affectsMap: boolean
  mapWeight: number      // 1–3 (impacto na zona); -1 para confirmed_safe
  description: string
  subcategories: SubCategory[]
  isUnique?: boolean
  hidden?: boolean       // não aparece no menu de report (tipo antigo)
}

export const INCIDENT_TYPES: IncidentTypeDef[] = [
  // ── Segurança ─────────────────────────────────────────────────────────────
  {
    id: 'assault_robbery', label: 'Assalto', emoji: '🦹', color: '#dc2626', group: 'seguranca',
    priority: 1, initialScore: 90, affectsMap: true, mapWeight: 3,
    description: 'Roubo ou tentativa de roubo',
    subcategories: [
      { id: 'attempt', label: 'Tentativa (consegui escapar)' },
      { id: 'knife', label: 'Com faca' },
      { id: 'group_attack', label: 'Em grupo' },
      { id: 'snatching', label: 'Snatch & ride' },
    ],
  },
  {
    id: 'bike_theft', label: 'Roubo de bike/moto', emoji: '🚲', color: '#ea580c', group: 'seguranca',
    priority: 2, initialScore: 80, affectsMap: true, mapWeight: 2,
    description: 'Bicicleta, mota ou trotinete roubada',
    subcategories: [
      { id: 'locked_theft', label: 'Estava presa' },
      { id: 'ride_by_theft', label: 'Em movimento' },
      { id: 'scooter', label: 'Trotinete' },
    ],
  },
  {
    id: 'physical_assault', label: 'Agressão', emoji: '👊', color: '#b91c1c', group: 'seguranca',
    priority: 1, initialScore: 85, affectsMap: true, mapWeight: 3,
    description: 'Agressão física',
    subcategories: [
      { id: 'unprovoked', label: 'Sem provocação' },
      { id: 'road_rage', label: 'Road rage' },
      { id: 'group_attack', label: 'Em grupo' },
    ],
  },
  {
    id: 'suspicious_activity', label: 'Suspeito', emoji: '👀', color: '#7c3aed', group: 'seguranca',
    priority: 4, initialScore: 50, affectsMap: true, mapWeight: 1,
    description: 'Atividade suspeita',
    subcategories: [
      { id: 'loitering', label: 'Grupo parado' },
      { id: 'vehicle_following', label: 'Veículo a seguir' },
      { id: 'unusual_behavior', label: 'Comportamento estranho' },
    ],
  },
  // ── Estrada ───────────────────────────────────────────────────────────────
  {
    id: 'police', label: 'Polícia', emoji: '👮', color: '#1d4ed8', group: 'estrada',
    priority: 5, initialScore: 60, affectsMap: false, mapWeight: 0,
    description: 'Polícia ou controlo na via', subcategories: [],
  },
  {
    id: 'accident', label: 'Acidente', emoji: '💥', color: '#c2410c', group: 'estrada',
    priority: 3, initialScore: 70, affectsMap: false, mapWeight: 0,
    description: 'Acidente na via', subcategories: [],
  },
  {
    id: 'traffic_jam', label: 'Trânsito', emoji: '🚗', color: '#b45309', group: 'estrada',
    priority: 6, initialScore: 50, affectsMap: false, mapWeight: 0,
    description: 'Trânsito parado ou lento', subcategories: [],
  },
  {
    id: 'construction', label: 'Obras', emoji: '🚧', color: '#d97706', group: 'estrada',
    priority: 6, initialScore: 60, affectsMap: false, mapWeight: 0,
    description: 'Obras na via', subcategories: [],
  },
  {
    id: 'road_closed', label: 'Via fechada', emoji: '⛔', color: '#991b1b', group: 'estrada',
    priority: 3, initialScore: 70, affectsMap: false, mapWeight: 0,
    description: 'Rua ou faixa fechada', subcategories: [],
  },
  {
    id: 'pothole', label: 'Buraco', emoji: '🕳️', color: '#57534e', group: 'estrada',
    priority: 5, initialScore: 60, affectsMap: false, mapWeight: 0,
    description: 'Buraco ou pavimento danificado', subcategories: [],
  },
  {
    id: 'road_hazard', label: 'Objeto na via', emoji: '📦', color: '#78716c', group: 'estrada',
    priority: 5, initialScore: 55, affectsMap: false, mapWeight: 0,
    description: 'Objeto, vidro ou detritos na via',
    subcategories: [
      { id: 'glass_debris', label: 'Vidro / detritos' },
      { id: 'obstacle', label: 'Objeto grande' },
    ],
  },
  {
    id: 'flooding', label: 'Alagamento', emoji: '🌊', color: '#0369a1', group: 'estrada',
    priority: 5, initialScore: 60, affectsMap: false, mapWeight: 0,
    description: 'Água na via', subcategories: [],
  },
  // ── Tipos antigos (só para mostrar reports já gravados) ───────────────────
  {
    id: 'attempted_robbery', label: 'Tentativa de assalto', emoji: '🦹', color: '#dc2626', group: 'seguranca',
    priority: 2, initialScore: 75, affectsMap: true, mapWeight: 2,
    description: 'Tentativa de roubo', subcategories: [], hidden: true,
  },
  {
    id: 'no_entry_zone', label: 'Zona a evitar', emoji: '⛔', color: '#991b1b', group: 'seguranca',
    priority: 2, initialScore: 70, affectsMap: true, mapWeight: 2,
    description: 'Área a evitar', subcategories: [], hidden: true,
  },
  {
    id: 'confirmed_safe', label: 'Área segura', emoji: '✅', color: '#16a34a', group: 'seguranca',
    priority: 7, initialScore: 30, affectsMap: false, mapWeight: -1,
    description: 'Área confirmada como segura', subcategories: [], isUnique: true, hidden: true,
  },
]

/** Só os que aparecem no menu de report. */
export const REPORT_MENU_TYPES = INCIDENT_TYPES.filter(t => !t.hidden)

export function getIncidentType(id: string): IncidentTypeDef | undefined {
  return INCIDENT_TYPES.find(t => t.id === id)
}
