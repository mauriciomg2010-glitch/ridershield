// Incident type definitions with scoring and map display metadata

export interface SubCategory {
  id: string
  label: string
}

export interface IncidentTypeDef {
  id: string
  label: string
  emoji: string
  color: string
  priority: number       // 1 = highest risk
  initialScore: number   // 0–100 base confidence weight for score formula
  affectsMap: boolean
  mapWeight: number      // 1–3 (zone risk impact); -1 for confirmed_safe
  description: string
  subcategories: SubCategory[]
  isUnique?: boolean
}

export const INCIDENT_TYPES: IncidentTypeDef[] = [
  {
    id: 'assault_robbery',
    label: 'Assalto / Roubo',
    emoji: '🔴',
    color: '#ef4444',
    priority: 1,
    initialScore: 90,
    affectsMap: true,
    mapWeight: 3,
    description: 'Roubo com confronto direto',
    subcategories: [
      { id: 'at_gunpoint', label: 'À mão armada' },
      { id: 'knife', label: 'Com faca' },
      { id: 'group_attack', label: 'Ataque em grupo' },
      { id: 'snatching', label: 'Snatch & ride' },
    ],
  },
  {
    id: 'bike_theft',
    label: 'Furto de Bicicleta',
    emoji: '🚲',
    color: '#f97316',
    priority: 2,
    initialScore: 75,
    affectsMap: true,
    mapWeight: 2,
    description: 'Bicicleta ou trotinete furtada',
    subcategories: [
      { id: 'locked_theft', label: 'Bicicleta acorrentada' },
      { id: 'ride_by_theft', label: 'Em movimento' },
      { id: 'scooter', label: 'Trotinete elétrica' },
    ],
  },
  {
    id: 'physical_assault',
    label: 'Agressão Física',
    emoji: '👊',
    color: '#fb923c',
    priority: 3,
    initialScore: 80,
    affectsMap: true,
    mapWeight: 3,
    description: 'Agressão física ao rider',
    subcategories: [
      { id: 'unprovoked', label: 'Sem provocação' },
      { id: 'road_rage', label: 'Road rage' },
      { id: 'group_attack', label: 'Grupo de agressores' },
    ],
  },
  {
    id: 'attempted_robbery',
    label: 'Tentativa de Roubo',
    emoji: '🟠',
    color: '#f59e0b',
    priority: 4,
    initialScore: 65,
    affectsMap: true,
    mapWeight: 2,
    description: 'Tentativa sem conclusão',
    subcategories: [
      { id: 'followed', label: 'Seguido' },
      { id: 'threatened', label: 'Ameaçado verbalmente' },
      { id: 'escaped', label: 'Consegui escapar' },
    ],
  },
  {
    id: 'suspicious_activity',
    label: 'Atividade Suspeita',
    emoji: '👀',
    color: '#8b5cf6',
    priority: 5,
    initialScore: 45,
    affectsMap: true,
    mapWeight: 1,
    description: 'Comportamento suspeito na área',
    subcategories: [
      { id: 'loitering', label: 'Grupo parado' },
      { id: 'vehicle_following', label: 'Veículo a seguir' },
      { id: 'unusual_behavior', label: 'Comportamento incomum' },
    ],
  },
  {
    id: 'road_hazard',
    label: 'Perigo na Via',
    emoji: '🚧',
    color: '#10b981',
    priority: 6,
    initialScore: 55,
    affectsMap: true,
    mapWeight: 1,
    description: 'Obstáculo ou perigo na estrada',
    subcategories: [
      { id: 'pothole', label: 'Buraco / pavimento' },
      { id: 'glass_debris', label: 'Vidro / detritos' },
      { id: 'flooding', label: 'Inundação' },
      { id: 'obstacle', label: 'Obstáculo na via' },
    ],
  },
  {
    id: 'no_entry_zone',
    label: 'Zona Restrita',
    emoji: '🚫',
    color: '#dc2626',
    priority: 2,
    initialScore: 70,
    affectsMap: true,
    mapWeight: 2,
    description: 'Zona com restrição de acesso',
    subcategories: [
      { id: 'police_cordon', label: 'Cordão policial' },
      { id: 'road_blocked', label: 'Estrada bloqueada' },
      { id: 'unsafe_area', label: 'Área monitorizada' },
    ],
  },
  {
    id: 'confirmed_safe',
    label: 'Área Segura',
    emoji: '✅',
    color: '#22c55e',
    priority: 7,
    initialScore: 30,
    affectsMap: false,
    mapWeight: -1,
    description: 'Confirmo que esta área está segura',
    subcategories: [
      { id: 'police_present', label: 'Polícia presente' },
      { id: 'false_alarm', label: 'Falso alarme anterior' },
      { id: 'area_clear', label: 'Área calma' },
    ],
    isUnique: true,
  },
]

export function getIncidentType(id: string): IncidentTypeDef | undefined {
  return INCIDENT_TYPES.find(t => t.id === id)
}
