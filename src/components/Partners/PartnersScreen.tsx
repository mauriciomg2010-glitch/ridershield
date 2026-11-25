'use client'
// Parceiros: restaurantes/cafés com desconto para riders, mecânicos, etc.
// Para não poluir o mapa, o rider filtra (tipo, "vale agora"), escolhe os que quer e só esses
// aparecem no mapa. Cada parceiro tem o "Cartão ZIVO" para mostrar no balcão.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/contexts/AuthContext'
import { getRiderID } from '@/lib/firestore'
import { carregarParceiros, registarAnuncio } from '@/lib/ads'
import {
  PartnerDoc, PartnerCategory, CATEGORIAS, filtrarParceiros, textoHorario, proximaAbertura,
  textoDistancia, maisProxima, disponivelAgora, moradasDe,
} from '@/lib/partners'

interface Props {
  onBack?: () => void
  /** mostra no mapa só os parceiros escolhidos */
  onShowOnMap?: (ids: string[]) => void
  /** abre a rota até à morada */
  onNavigate?: (lat: number, lng: number) => void
}

export default function PartnersScreen({ onBack, onShowOnMap, onNavigate }: Props) {
  const aqui = useStore(s => s.currentLocation)
  const [todos, setTodos] = useState<PartnerDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)
  const [cats, setCats] = useState<PartnerCategory[]>([])
  const [soAgora, setSoAgora] = useState(false)
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [aberto, setAberto] = useState<PartnerDoc | null>(null)
  const [cartao, setCartao] = useState<PartnerDoc | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    carregarParceiros(true)
      .then(ps => setTodos(ps.filter(p => p.active !== false)))
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
    // "vale agora" muda com a hora
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const lista = useMemo(() => filtrarParceiros(todos, { categorias: cats, soAgora }, aqui), [todos, cats, soAgora, aqui])
  const catsComParceiros = CATEGORIAS.filter(c => todos.some(p => (filtrarParceiros([p], { categorias: [c.key], soAgora: false }).length > 0)))

  const toggle = (id: string) => setEscolhidos(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id])
  const verNoMapa = (ids: string[]) => { if (ids.length) onShowOnMap?.(ids) }

  return (
    <div className="flex flex-col min-h-full" style={{ background: 'var(--bg)', paddingBottom: escolhidos.length ? 150 : 96 }}>
      {/* Cabeçalho */}
      <div className="px-4 pt-6 pb-3" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="p-2 -ml-2" style={{ color: 'var(--text)' }} aria-label="Voltar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>🍔 Restaurantes e parceiros</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Descontos para riders ZIVO · escolhe e vê no mapa</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          <Chip on={soAgora} onClick={() => setSoAgora(v => !v)}>🟢 Vale agora</Chip>
          {(catsComParceiros.length ? catsComParceiros : CATEGORIAS).map(c => (
            <Chip key={c.key} on={cats.includes(c.key)} onClick={() => setCats(cs => cs.includes(c.key) ? cs.filter(x => x !== c.key) : [...cs, c.key])}>
              {c.emoji} {c.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: '#d97706', borderTopColor: 'transparent' }} />
          </div>
        ) : erro ? (
          <Vazio titulo="Sem ligação" texto="Não foi possível carregar os parceiros. Tenta outra vez." />
        ) : !todos.length ? (
          <Vazio titulo="Em breve" texto="Restaurantes com desconto para riders vão aparecer aqui." />
        ) : !lista.length ? (
          <Vazio titulo="Nenhum parceiro com estes filtros" texto={soAgora ? 'Nenhum desconto vale a esta hora. Tira "Vale agora" para ver todos.' : 'Muda os filtros acima.'} />
        ) : (
          <>
            {lista.length > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{lista.length} parceiros · toca no ○ para escolher</span>
                <button onClick={() => setEscolhidos(lista.map(x => x.p.id))} className="text-xs font-bold" style={{ color: '#f59e0b' }}>Escolher todos</button>
              </div>
            )}
            {lista.map(({ p, agora, perto }) => {
              const cor = p.color ?? '#d97706'
              const on = escolhidos.includes(p.id)
              const prox = agora ? null : proximaAbertura(p)
              return (
                <div key={p.id} className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: `1px solid ${on ? cor : 'var(--border)'}` }}>
                  <div className="flex items-stretch">
                    <button onClick={() => toggle(p.id)} aria-label={on ? 'Tirar da seleção' : 'Escolher'}
                      className="flex items-center justify-center" style={{ width: 52, flexShrink: 0, background: on ? `${cor}22` : 'transparent', border: 'none' }}>
                      <span style={{ width: 24, height: 24, borderRadius: 999, border: `2px solid ${on ? cor : 'var(--muted)'}`, background: on ? cor : 'transparent', color: '#fff', fontSize: 14, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
                    </button>
                    <button onClick={() => setAberto(p)} className="flex-1 min-w-0 text-left px-3 py-3" style={{ background: 'none', border: 'none' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{p.emoji ?? '🍔'}</span>
                        <span className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>{p.name}</span>
                        {p.sponsored && <span className="text-[10px] font-bold px-1.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>Destaque</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold px-2 py-0.5 rounded-full" style={{ background: `${cor}22`, color: cor }}>{p.offer}</span>
                        {p.offerDetail && <span className="text-xs" style={{ color: 'var(--muted)' }}>{p.offerDetail}</span>}
                      </div>
                      <div className="mt-1 text-xs flex gap-2 flex-wrap" style={{ color: 'var(--muted)' }}>
                        <span style={{ color: agora ? '#10b981' : '#f87171', fontWeight: 700 }}>{agora ? '● Vale agora' : `● ${prox ?? 'Fora do horário'}`}</span>
                        {(p.windows?.length ?? 0) > 0 && <span>{textoHorario(p)}</span>}
                        {perto?.dist != null && <span>· {textoDistancia(perto.dist)}</span>}
                        {moradasDe(p).length > 1 && <span>· {moradasDe(p).length} lojas</span>}
                      </div>
                    </button>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Barra de ação: ver os escolhidos no mapa */}
      {escolhidos.length > 0 && (
        <div className="fixed left-0 right-0 z-[650] px-4" style={{ bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}>
          <div className="flex gap-2">
            <button onClick={() => setEscolhidos([])} className="px-4 rounded-xl text-sm font-semibold" style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>Limpar</button>
            <button onClick={() => verNoMapa(escolhidos)} className="flex-1 py-3.5 rounded-xl text-sm font-extrabold" style={{ background: '#f59e0b', color: '#0a0e1a', border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.35)' }}>
              🗺️ Ver {escolhidos.length} no mapa
            </button>
          </div>
        </div>
      )}

      {/* Detalhe do parceiro */}
      {aberto && (
        <Detalhe p={aberto} aqui={aqui}
          onClose={() => setAberto(null)}
          onCartao={() => { registarAnuncio(aberto.id, 'clique'); setCartao(aberto) }}
          onMapa={() => { const id = aberto.id; setAberto(null); verNoMapa([id]) }}
          onIr={(lat, lng) => { setAberto(null); onNavigate?.(lat, lng) }} />
      )}

      {cartao && <CartaoZivo p={cartao} onClose={() => setCartao(null)} />}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap"
      style={{ background: on ? '#f59e0b' : 'var(--card)', color: on ? '#0a0e1a' : 'var(--text)', border: `1px solid ${on ? '#f59e0b' : 'var(--border)'}` }}>
      {children}
    </button>
  )
}

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
      <p className="text-2xl mb-2">🍔</p>
      <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{titulo}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{texto}</p>
    </div>
  )
}

function Detalhe({ p, aqui, onClose, onCartao, onMapa, onIr }: {
  p: PartnerDoc; aqui: { lat: number; lng: number } | null
  onClose: () => void; onCartao: () => void; onMapa: () => void; onIr: (lat: number, lng: number) => void
}) {
  const cor = p.color ?? '#d97706'
  const agora = disponivelAgora(p)
  const perto = maisProxima(p, aqui)
  const temMapa = moradasDe(p).length > 0 || !!p.mapboxQuery
  return (
    <div className="fixed inset-0 z-[950] flex items-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full rounded-t-3xl px-5 pt-4" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 14px' }} />
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ background: `${cor}22` }}>{p.emoji ?? '🍔'}</div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>{p.name}</h2>
            <span className="text-xs font-bold" style={{ color: agora ? '#10b981' : '#f87171' }}>{agora ? '● Desconto válido agora' : `● ${proximaAbertura(p) ?? 'Fora do horário'}`}</span>
          </div>
        </div>
        <div className="mt-4 rounded-2xl px-4 py-3 text-center" style={{ background: `${cor}18`, border: `1px solid ${cor}55` }}>
          <div className="text-2xl font-extrabold" style={{ color: cor }}>{p.offer}</div>
          {p.offerDetail && <div className="text-sm mt-0.5" style={{ color: 'var(--text)' }}>{p.offerDetail}</div>}
        </div>
        <div className="mt-3 space-y-1.5 text-sm" style={{ color: 'var(--muted)' }}>
          <div>🕒 {textoHorario(p)}</div>
          {perto?.loc?.address && <div>📍 {perto.loc.address}{perto.dist != null ? ` · ${textoDistancia(perto.dist)}` : ''}</div>}
          {p.description && <div style={{ color: 'var(--text)' }}>{p.description}</div>}
          <div>ℹ️ {p.howTo || 'Mostra o Cartão ZIVO no balcão antes de pagar.'}</div>
        </div>
        <button onClick={onCartao} disabled={!agora} className="w-full mt-4 py-3.5 rounded-xl text-base font-extrabold"
          style={{ background: agora ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'var(--card)', color: agora ? '#0a0e1a' : 'var(--muted)', border: 'none' }}>
          {agora ? '🎫 Mostrar Cartão ZIVO' : '🎫 Cartão disponível no horário do desconto'}
        </button>
        <div className="flex gap-2 mt-2">
          {temMapa && <button onClick={onMapa} className="flex-1 py-3 rounded-xl text-sm font-bold" style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}>🗺️ Ver no mapa</button>}
          {perto && <button onClick={() => onIr(perto.loc.lat, perto.loc.lng)} className="flex-1 py-3 rounded-xl text-sm font-bold" style={{ background: '#10b981', color: '#fff', border: 'none' }}>➜ Ir até lá</button>}
        </div>
      </div>
    </div>
  )
}

/** Cartão para mostrar no balcão: nome, Rider ID, oferta e relógio a mexer (uma captura de ecrã antiga nota-se). */
function CartaoZivo({ p, onClose }: { p: PartnerDoc; onClose: () => void }) {
  const user = useStore(s => s.user)
  const { firebaseUser } = useAuth()
  const [riderId, setRiderId] = useState('')
  const [agora, setAgora] = useState(new Date())
  useEffect(() => {
    if (firebaseUser?.uid) getRiderID(firebaseUser.uid).then(setRiderId).catch(() => {})
    const id = setInterval(() => setAgora(new Date()), 1000)
    return () => clearInterval(id)
  }, [firebaseUser?.uid])
  const cor = p.color ?? '#d97706'
  const hora = agora.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dia = agora.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'short' })
  return (
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center px-6" style={{ background: '#0a0e1a' }} onClick={onClose}>
      <style>{`@keyframes zivoCard{0%{background-position:0% 50%}100%{background-position:200% 50%}}@keyframes zivoPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}`}</style>
      <div className="w-full max-w-sm rounded-3xl p-6 text-center" onClick={e => e.stopPropagation()}
        style={{ background: `linear-gradient(110deg, ${cor}, #7c3aed, ${cor})`, backgroundSize: '200% 100%', animation: 'zivoCard 4s linear infinite', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-center gap-2">
          <img src="/icons/v2/zivo-app.svg" alt="" width={28} height={28} style={{ borderRadius: 8 }} />
          <span className="text-white font-black tracking-wide">ZIVO RIDER</span>
        </div>
        <div className="mt-4 text-white/80 text-sm">{p.emoji ?? '🍔'} {p.name}</div>
        <div className="mt-1 text-white text-4xl font-black" style={{ animation: 'zivoPulse 2s ease-in-out infinite' }}>{p.offer}</div>
        {p.offerDetail && <div className="mt-1 text-white/90 text-sm">{p.offerDetail}</div>}
        <div className="mt-5 rounded-2xl py-3" style={{ background: 'rgba(0,0,0,0.25)' }}>
          <div className="text-white text-lg font-bold">{user?.name ?? 'Rider'}</div>
          {riderId && <div className="text-white/90 font-mono font-bold tracking-widest">{riderId}</div>}
        </div>
        <div className="mt-4 text-white text-3xl font-mono font-black">{hora}</div>
        <div className="text-white/80 text-xs capitalize">{dia} · válido agora</div>
      </div>
      <p className="mt-6 text-sm text-center" style={{ color: 'rgba(255,255,255,0.6)' }}>Mostra este ecrã no balcão · o relógio prova que é ao vivo</p>
      <button onClick={onClose} className="mt-4 px-8 py-3 rounded-xl text-sm font-bold" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none' }}>Fechar</button>
    </div>
  )
}
