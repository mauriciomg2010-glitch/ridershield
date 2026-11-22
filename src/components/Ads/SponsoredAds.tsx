'use client'
// Anúncios do plano Free feitos com os próprios parceiros (sem rede de anúncios externa):
//  • pin patrocinado no mapa (fora da navegação), até 3, a menos de 3 km;
//  • cartão pequeno logo a seguir a "Concluir entrega" com o parceiro patrocinado mais perto.
// Nunca aparecem durante a navegação (quem chama garante) e nunca no plano Pro.
import { useEffect, useRef, useState } from 'react'
import { Marker } from 'react-map-gl/mapbox'
import { carregarParceiros, registarAnuncio } from '@/lib/ads'
import { PartnerDoc, disponivelAgora, maisProxima, textoDistancia, textoHorario } from '@/lib/partners'

type Pt = { lat: number; lng: number }
const vistosNestaSessao = new Set<string>()

export function SponsoredPins({ ativo, aqui, onSelect }: { ativo: boolean; aqui: Pt | null; onSelect: (p: PartnerDoc) => void }) {
  const [ps, setPs] = useState<PartnerDoc[]>([])
  useEffect(() => {
    if (!ativo) return
    let vivo = true
    const ler = () => carregarParceiros().then(l => { if (vivo) setPs(l.filter(p => p.sponsored && p.active !== false)) }).catch(() => {})
    ler()
    const id = setInterval(ler, 5 * 60_000)
    return () => { vivo = false; clearInterval(id) }
  }, [ativo])
  if (!ativo || !aqui) return null
  const pins = ps
    .filter(p => disponivelAgora(p))
    .map(p => ({ p, perto: maisProxima(p, aqui) }))
    .filter(x => x.perto && (x.perto.dist ?? Infinity) < 3000)
    .sort((a, b) => (a.perto!.dist ?? 0) - (b.perto!.dist ?? 0))
    .slice(0, 3)
  return (
    <>
      {pins.map(({ p, perto }) => {
        if (!vistosNestaSessao.has(p.id)) { vistosNestaSessao.add(p.id); registarAnuncio(p.id, 'impressao') }
        const cor = p.color ?? '#f59e0b'
        return (
          <Marker key={p.id} longitude={perto!.loc.lng} latitude={perto!.loc.lat} anchor="bottom"
            onClick={(e: any) => { e?.originalEvent?.stopPropagation?.(); registarAnuncio(p.id, 'clique'); onSelect(p) }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', color: '#111827', borderRadius: 14, padding: '3px 8px 3px 4px', boxShadow: '0 2px 8px rgba(0,0,0,0.35)', border: `2px solid ${cor}`, whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 16, background: `${cor}22`, borderRadius: 10, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.emoji ?? '🍔'}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: cor }}>{p.offer}</span>
              </div>
              <div style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `7px solid ${cor}` }} />
            </div>
          </Marker>
        )
      })}
    </>
  )
}

export function SponsorCard({ p, aqui, onClose, onIr, onMaisParceiros }: { p: PartnerDoc; aqui: Pt | null; onClose: () => void; onIr: (lat: number, lng: number) => void; onMaisParceiros?: () => void }) {
  const cor = p.color ?? '#f59e0b'
  const perto = maisProxima(p, aqui)
  return (
    <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(92px + env(safe-area-inset-bottom, 0px))', zIndex: 640 }}>
      <div style={{ background: 'var(--surface, #fff)', color: 'var(--text, #111)', borderRadius: 18, padding: 14, boxShadow: '0 8px 28px rgba(0,0,0,0.4)', border: `1px solid ${cor}66` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: `${cor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{p.emoji ?? '🍔'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#9ca3af', letterSpacing: 0.5 }}>PATROCINADO · PARCEIRO ZIVO</div>
            <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: cor }}>{p.offer}{p.offerDetail ? <span style={{ fontWeight: 500, color: 'var(--muted, #6b7280)' }}> · {p.offerDetail}</span> : null}</div>
            <div style={{ fontSize: 11, color: 'var(--muted, #6b7280)' }}>{textoHorario(p)}{perto?.dist != null ? ` · ${textoDistancia(perto.dist)}` : ''}</div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'rgba(0,0,0,0.06)', border: 'none', borderRadius: 999, width: 30, height: 30, fontSize: 14, color: 'var(--muted, #6b7280)' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {onMaisParceiros && <button onClick={onMaisParceiros} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1px solid var(--border, #e5e7eb)', background: 'transparent', color: 'var(--text, #111)', fontWeight: 700, fontSize: 13 }}>🎫 Ver desconto</button>}
          {perto && <button onClick={() => onIr(perto.loc.lat, perto.loc.lng)} style={{ flex: 1, padding: '10px', borderRadius: 12, border: 'none', background: '#10b981', color: '#fff', fontWeight: 800, fontSize: 13 }}>➜ Ir até lá</button>}
        </div>
      </div>
    </div>
  )
}

/** Cartão no fim da entrega: some sozinho em 15 s. */
export function PostDeliveryAd({ p, aqui, onVer, onClose }: { p: PartnerDoc; aqui: Pt | null; onVer: () => void; onClose: () => void }) {
  const fechou = useRef(false)
  useEffect(() => {
    registarAnuncio(p.id, 'impressao')
    const id = setTimeout(() => { if (!fechou.current) onClose() }, 15_000)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id])
  const cor = p.color ?? '#f59e0b'
  const perto = maisProxima(p, aqui)
  return (
    <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(92px + env(safe-area-inset-bottom, 0px))', zIndex: 640, animation: 'zivoAdIn .35s ease-out' }}>
      <style>{`@keyframes zivoAdIn{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}`}</style>
      <div onClick={() => { fechou.current = true; registarAnuncio(p.id, 'clique'); onVer() }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface, #fff)', color: 'var(--text, #111)', borderRadius: 16, padding: '10px 12px', boxShadow: '0 6px 22px rgba(0,0,0,0.35)', border: `1px solid ${cor}66`, cursor: 'pointer' }}>
        <span style={{ fontSize: 24 }}>{p.emoji ?? '🍔'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#9ca3af' }}>ENTREGA FEITA ✓ · PATROCINADO</div>
          <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p.name} <span style={{ color: cor }}>{p.offer}</span>
          </div>
          {perto?.dist != null && <div style={{ fontSize: 11, color: 'var(--muted, #6b7280)' }}>a {textoDistancia(perto.dist)} daqui</div>}
        </div>
        <button onClick={e => { e.stopPropagation(); fechou.current = true; onClose() }} aria-label="Fechar"
          style={{ background: 'rgba(0,0,0,0.06)', border: 'none', borderRadius: 999, width: 28, height: 28, fontSize: 13, color: 'var(--muted, #6b7280)' }}>✕</button>
      </div>
    </div>
  )
}
