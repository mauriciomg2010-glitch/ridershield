// "Come-come" da rota: a linha azul tem de acabar EXATAMENTE debaixo da seta, a cada quadro.
// O Mapbox corta a linha com `line-trim-offset`, que usa a fração do comprimento da linha medida
// no plano do mapa (Mercator). O tracker mede em metros — esta tabela converte uma na outra, para
// não ficar um "rabo" (ou um buraco) de vários metros em rotas longas norte–sul.
import type { LngLat } from './geo'

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** Comprimento acumulado no plano Mercator, normalizado (0 … 1). */
export function progressoMercator(coords: LngLat[]): number[] {
  const out = [0]
  let tot = 0
  for (let i = 1; i < coords.length; i++) {
    const dx = ((coords[i][0] - coords[i - 1][0]) * Math.PI) / 180
    const dy = mercY(coords[i][1]) - mercY(coords[i - 1][1])
    tot += Math.hypot(dx, dy)
    out.push(tot)
  }
  return tot > 0 ? out.map(v => v / tot) : out.map(() => 0)
}

/** Fração da linha (0…1) correspondente a `along` metros, dado o acumulado em metros do tracker. */
export function fracaoNaLinha(cumM: number[], cumMerc: number[], along: number): number {
  const n = Math.min(cumM.length, cumMerc.length)
  if (n < 2 || along <= 0) return 0
  if (along >= cumM[n - 1]) return 1
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cumM[mid] <= along) lo = mid; else hi = mid }
  const seg = cumM[hi] - cumM[lo]
  const t = seg > 0 ? (along - cumM[lo]) / seg : 0
  return cumMerc[lo] + t * (cumMerc[hi] - cumMerc[lo])
}
