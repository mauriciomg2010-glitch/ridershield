// Cores "estilo Google Maps" por cima dos estilos da Mapbox (streets-v12 de dia, navigation-night-v1
// à noite). Cores medidas nos vídeos e capturas do Google Maps que o Maurício gravou em Dublin
// (22 nov 2026). Feito por palavras no id da camada: se a Mapbox mudar um id, essa camada só fica
// com a cor original — nunca parte o mapa.

export interface Paleta {
  fundo: string; construido: string; parque: string; agua: string; predio: string; predio3d: string
  autoestrada: string; principal: string; secundaria: string; rua: string; servico: string; borda: string
  texto: string; textoHalo: string
  rota: string; rotaBorda: string; alternativa: string; alternativaBorda: string
  banner: string; bannerEscuro: string; painel: string; painelTexto: string; painelSub: string
  botao: string; botaoIcone: string; minutos: string
  seta: string; setaFundo: string; setaBorda: string
}

export const NOITE: Paleta = {
  fundo: '#1d4a62', construido: '#1d3049', parque: '#21536a', agua: '#0f2740', predio: '#223a57', predio3d: '#2a4565',
  autoestrada: '#5d7396', principal: '#657599', secundaria: '#56688a', rua: '#405675', servico: '#34495f', borda: '#14243a',
  texto: '#d5deea', textoHalo: '#1d3049',
  rota: '#60d0e8', rotaBorda: '#2b8fb4', alternativa: '#4b6a86', alternativaBorda: '#2a4058',
  banner: '#275d60', bannerEscuro: '#205052', painel: '#131314', painelTexto: '#ffffff', painelSub: '#bdc1c6',
  botao: '#131314', botaoIcone: '#e8eaed', minutos: '#81c995',
  seta: '#ffffff', setaFundo: '#3d6fd8', setaBorda: '#ffffff',
}

export const DIA: Paleta = {
  fundo: '#f5f3f0', construido: '#efebe7', parque: '#c4e5c9', agua: '#90daee', predio: '#e8e4e0', predio3d: '#ece8e4',
  autoestrada: '#ffffff', principal: '#ffffff', secundaria: '#ffffff', rua: '#ffffff', servico: '#ffffff', borda: '#c9c4bf',
  texto: '#4a4f57', textoHalo: '#ffffff',
  rota: '#3d1fe0', rotaBorda: '#2a12a8', alternativa: '#b8bfda', alternativaBorda: '#8d94b8',
  banner: '#005457', bannerEscuro: '#004649', painel: '#ffffff', painelTexto: '#202124', painelSub: '#5f6368',
  botao: '#ffffff', botaoIcone: '#3c4043', minutos: '#188038',
  seta: '#1a56ff', setaFundo: '#ffffff', setaBorda: '#1a56ff',
}

export const paleta = (noite: boolean): Paleta => (noite ? NOITE : DIA)

/** Categoria de uma camada de estrada pelo id (road-motorway-trunk, road-primary-case, bridge-street…). */
export function tipoEstrada(id: string): 'autoestrada' | 'principal' | 'secundaria' | 'rua' | 'servico' | null {
  if (!/^(road|bridge|tunnel)-/.test(id)) return null
  if (/label|shield|exit|number|arrow|oneway|rail|path|pedestrian|steps|ferry|construction/.test(id)) return null
  if (/motorway|trunk/.test(id)) return 'autoestrada'
  if (/primary/.test(id)) return 'principal'
  if (/secondary|tertiary/.test(id)) return 'secundaria'
  if (/service|track/.test(id)) return 'servico'
  if (/street|minor|road-simple|link/.test(id)) return 'rua'
  return null
}

const BUILD_3D = 'zivo-predios-3d'

/** Aplica a paleta ao mapa já carregado. Seguro de chamar várias vezes (a cada troca de estilo). */
export function aplicarVisualGoogle(map: any, noite: boolean) {
  if (!map?.getStyle) return
  const P = paleta(noite)
  const layers: any[] = map.getStyle()?.layers ?? []
  const set = (id: string, prop: string, v: any) => { try { map.setPaintProperty(id, prop, v) } catch { /* camada sem esta prop */ } }
  for (const l of layers) {
    const id: string = l.id
    // só as camadas do mapa base (fonte 'composite'); rotas, zonas e reports do ZIVO ficam como estão
    if (l.type !== 'background' && l.source !== 'composite') continue
    if (id.startsWith('zivo-')) continue
    if (l.type === 'background') { set(id, 'background-color', P.fundo); continue }
    if (l.type === 'fill') {
      if (/water/.test(id)) set(id, 'fill-color', P.agua)
      else if (id === 'building' || /^building/.test(id)) { set(id, 'fill-color', P.predio); set(id, 'fill-outline-color', P.borda) }
      else if (/national-park|park|landcover|wood|grass/.test(id)) set(id, 'fill-color', P.parque)
      else if (id === 'landuse' || /landuse/.test(id)) {
        set(id, 'fill-color', ['match', ['get', 'class'],
          ['park', 'grass', 'wood', 'scrub', 'cemetery', 'pitch', 'golf_course', 'agriculture', 'national_park'], P.parque,
          ['residential', 'commercial_area', 'industrial', 'school', 'hospital', 'parking', 'airport'], P.construido,
          P.fundo])
      } else if (id === 'land' || /land$/.test(id)) set(id, 'fill-color', P.fundo)
      continue
    }
    if (l.type === 'line') {
      if (/water/.test(id)) { set(id, 'line-color', P.agua); continue }
      const t = tipoEstrada(id)
      if (!t) continue
      if (/case/.test(id)) set(id, 'line-color', P.borda)
      else set(id, 'line-color', P[t])
      continue
    }
    if (l.type === 'symbol' && l.layout?.['text-field'] != null && !/shield/.test(id)) {
      set(id, 'text-color', P.texto); set(id, 'text-halo-color', P.textoHalo)
    }
  }
  // prédios em 3D baixos, como no Google quando se aproxima
  try {
    if (map.getSource('composite') && !map.getLayer(BUILD_3D)) {
      const firstSymbol = layers.find(l => l.type === 'symbol')?.id
      map.addLayer({
        id: BUILD_3D, type: 'fill-extrusion', source: 'composite', 'source-layer': 'building', minzoom: 15.5,
        filter: ['==', ['get', 'extrude'], 'true'],
        paint: {
          'fill-extrusion-color': P.predio3d,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15.5, 0, 16.2, ['*', 0.6, ['coalesce', ['get', 'height'], 6]]],
          'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.75,
        },
      }, firstSymbol)
    } else if (map.getLayer(BUILD_3D)) set(BUILD_3D, 'fill-extrusion-color', P.predio3d)
  } catch { /* estilo sem prédios */ }
}
