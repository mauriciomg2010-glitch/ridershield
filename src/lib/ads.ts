// Anúncios só para o plano Free (nunca durante a navegação — isso é decidido em quem mostra).
// Admins são Pro: para verem os anúncios como um rider Free, o menu tem "Ver como Free" (só neste aparelho).
import { doc, updateDoc, increment, collection, getDocs } from 'firebase/firestore'
import { db } from './firebase'
import type { PartnerDoc } from './partners'

const PREVIEW_KEY = 'zivo_ver_como_free'

export function verComoFree(): boolean {
  try { return localStorage.getItem(PREVIEW_KEY) === '1' } catch { return false }
}
export function setVerComoFree(on: boolean) {
  try { on ? localStorage.setItem(PREVIEW_KEY, '1') : localStorage.removeItem(PREVIEW_KEY) } catch { /* modo privado */ }
  try { window.dispatchEvent(new Event('zivo-ads-pref')) } catch { /* SSR */ }
}

export function mostraAnuncios(user: { isPremium?: boolean } | null | undefined): boolean {
  if (!user) return false
  return !user.isPremium || verComoFree()
}

/** Conta impressões/cliques no próprio parceiro (para mostrar ao anunciante quantos riders viram). */
export function registarAnuncio(partnerId: string, tipo: 'impressao' | 'clique') {
  if (!partnerId) return
  updateDoc(doc(db, 'partners', partnerId), tipo === 'impressao' ? { impressoes: increment(1) } : { cliques: increment(1) }).catch(() => {})
}

let cache: { t: number; ps: PartnerDoc[] } | null = null
/** Parceiros (cache de 5 min — o mapa e o fim de entrega pedem várias vezes). */
export async function carregarParceiros(force = false): Promise<PartnerDoc[]> {
  if (!force && cache && Date.now() - cache.t < 5 * 60_000) return cache.ps
  const snap = await getDocs(collection(db, 'partners'))
  const ps = snap.docs.map(d => ({ id: d.id, ...d.data() } as PartnerDoc))
  cache = { t: Date.now(), ps }
  return ps
}
export function limparCacheParceiros() { cache = null }
