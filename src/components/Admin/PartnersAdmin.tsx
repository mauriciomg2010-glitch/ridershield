'use client'
// Painel admin → Parceiros: registar restaurantes/cafés com desconto para riders.
// Cada parceiro: nome, tipo, oferta (+ condições), dias/horas do desconto, uma ou várias moradas,
// como usar, ativo e "destaque pago" (anúncio no mapa e no fim da entrega, só plano Free).
import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { limparCacheParceiros } from '@/lib/ads'
import { PartnerDoc, PartnerWindow, PartnerLocation, CATEGORIAS, DIAS_CURTO, textoHorario, disponivelAgora } from '@/lib/partners'

const VAZIO: Omit<PartnerDoc, 'id'> = {
  name: '', category: 'restaurante', emoji: '🍔', color: '#f59e0b', offer: '', offerType: 'percent',
  offerDetail: '', description: '', howTo: '', locations: [], windows: [], active: true, sponsored: false,
}

const cartao: React.CSSProperties = { background: '#111827', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12, padding: 14, marginBottom: 10 }
const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#0a0e1a', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 11, color: '#9ca3af', fontWeight: 700, margin: '10px 0 4px', display: 'block' }
const btn = (bg: string, color = '#fff'): React.CSSProperties => ({ padding: '9px 14px', background: bg, border: 'none', color, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' })

export default function PartnersAdmin({ aviso }: { aviso: (msg: string) => void }) {
  const [lista, setLista] = useState<PartnerDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<(Omit<PartnerDoc, 'id'> & { id?: string }) | null>(null)
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<PartnerLocation[]>([])
  const [aBuscar, setABuscar] = useState(false)
  const [aGravar, setAGravar] = useState(false)

  const carregar = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'partners'))
      setLista(snap.docs.map(d => ({ id: d.id, ...d.data() } as PartnerDoc)).sort((a, b) => a.name.localeCompare(b.name)))
    } catch { aviso('Erro a carregar parceiros') }
    setLoading(false)
  }
  useEffect(() => { carregar() }, [])

  const set = (k: string, v: any) => setEdit(e => (e ? { ...e, [k]: v } : e))

  async function procurarMorada() {
    const q = busca.trim()
    if (!q) return
    setABuscar(true); setAchados([])
    try {
      const out: PartnerLocation[] = []
      // Eircode (ex.: D08 X2Y3) → coordenadas exatas pelo nosso /api/eircode
      if (/^[A-Za-z]\d{2}\s?[A-Za-z0-9]{4}$/.test(q)) {
        const r = await fetch(`/api/eircode?code=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => null)
        if (r?.lat && r?.lng) out.push({ lat: r.lat, lng: r.lng, address: r.label || q.toUpperCase() })
      }
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=ie&limit=5&types=poi,address&proximity=-6.26,53.35&access_token=${token}`
      const g = await fetch(url).then(r => r.json()).catch(() => null)
      for (const f of g?.features ?? []) out.push({ lng: f.center[0], lat: f.center[1], address: f.place_name })
      setAchados(out)
      if (!out.length) aviso('Nada encontrado — tenta com o Eircode')
    } finally { setABuscar(false) }
  }

  async function gravar() {
    if (!edit) return
    if (!edit.name.trim() || !edit.offer.trim()) { aviso('Nome e oferta são obrigatórios'); return }
    const janelas = (edit.windows ?? []).filter(w => w.days.length && /^\d{1,2}:\d{2}$/.test(w.from) && /^\d{1,2}:\d{2}$/.test(w.to))
    const dados: any = {
      ...edit, name: edit.name.trim(), offer: edit.offer.trim(), windows: janelas,
      locations: (edit.locations ?? []).filter(l => isFinite(l.lat) && isFinite(l.lng)),
      updatedAt: serverTimestamp(),
    }
    delete dados.id
    // moradas fixas substituem a pesquisa antiga por nome
    if (dados.locations.length) { dados.mapboxQuery = null; dados.lat = null; dados.lng = null }
    setAGravar(true)
    try {
      if (edit.id) await updateDoc(doc(db, 'partners', edit.id), dados)
      else await addDoc(collection(db, 'partners'), { ...dados, impressoes: 0, cliques: 0, createdAt: serverTimestamp() })
      limparCacheParceiros()
      aviso('✅ Parceiro guardado')
      setEdit(null); setAchados([]); setBusca('')
      carregar()
    } catch { aviso('Erro a guardar') }
    setAGravar(false)
  }

  async function apagar(p: PartnerDoc) {
    if (!confirm(`Apagar ${p.name}? Não dá para desfazer.`)) return
    try { await deleteDoc(doc(db, 'partners', p.id)); limparCacheParceiros(); aviso('Parceiro apagado'); carregar() } catch { aviso('Erro a apagar') }
  }

  if (edit) {
    const ws = edit.windows ?? []
    const ls = edit.locations ?? []
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button onClick={() => setEdit(null)} style={btn('rgba(255,255,255,0.08)')}>← Voltar</button>
          <span style={{ fontWeight: 800 }}>{edit.id ? 'Editar parceiro' : 'Novo parceiro'}</span>
        </div>
        <div style={cartao}>
          <label style={lbl}>Nome *</label>
          <input style={inp} value={edit.name} onChange={e => set('name', e.target.value)} placeholder="Ex.: Burrito Bros Camden St" />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Tipo</label>
              <select style={inp} value={String(edit.category)} onChange={e => { const c = CATEGORIAS.find(x => x.key === e.target.value); set('category', e.target.value); if (c && (!edit.emoji || CATEGORIAS.some(x => x.emoji === edit.emoji))) set('emoji', c.emoji) }}>
                {CATEGORIAS.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
              </select>
            </div>
            <div style={{ width: 80 }}>
              <label style={lbl}>Ícone</label>
              <input style={{ ...inp, textAlign: 'center', fontSize: 18 }} value={edit.emoji ?? ''} onChange={e => set('emoji', e.target.value.slice(0, 4))} />
            </div>
            <div style={{ width: 70 }}>
              <label style={lbl}>Cor</label>
              <input type="color" style={{ ...inp, padding: 2, height: 38 }} value={edit.color ?? '#f59e0b'} onChange={e => set('color', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={cartao}>
          <div style={{ fontWeight: 800, color: '#f59e0b' }}>🎁 Desconto</div>
          <label style={lbl}>Tipo de desconto</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['percent', '% na conta'], ['item', 'Só 1 prato/menu'], ['gratis', 'Grátis'], ['outro', 'Outro']] as const).map(([k, t]) => (
              <button key={k} onClick={() => set('offerType', k)} style={btn(edit.offerType === k ? '#f59e0b' : 'rgba(255,255,255,0.08)', edit.offerType === k ? '#0a0e1a' : '#fff')}>{t}</button>
            ))}
          </div>
          <label style={lbl}>Oferta (curta, aparece em destaque) *</label>
          <input style={inp} value={edit.offer} onChange={e => set('offer', e.target.value)} placeholder={edit.offerType === 'item' ? 'Ex.: Menu rider €6' : edit.offerType === 'gratis' ? 'Ex.: Café grátis' : 'Ex.: 15% OFF'} />
          <label style={lbl}>Condições (opcional)</label>
          <input style={inp} value={edit.offerDetail ?? ''} onChange={e => set('offerDetail', e.target.value)} placeholder="Ex.: Só no Burrito Clássico · não acumula" />
          <label style={lbl}>Como usar (opcional)</label>
          <input style={inp} value={edit.howTo ?? ''} onChange={e => set('howTo', e.target.value)} placeholder="Padrão: Mostra o Cartão ZIVO no balcão antes de pagar." />
          <label style={lbl}>Descrição (opcional)</label>
          <textarea style={{ ...inp, minHeight: 60 }} value={edit.description ?? ''} onChange={e => set('description', e.target.value)} />
        </div>

        <div style={cartao}>
          <div style={{ fontWeight: 800, color: '#f59e0b' }}>🕒 Quando vale</div>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 8px' }}>Sem horários = vale sempre que o restaurante está aberto. Para "horas menos movimentadas", adiciona os dias e horas.</p>
          {ws.map((w, i) => (
            <div key={i} style={{ background: '#0a0e1a', borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {DIAS_CURTO.map((d, di) => {
                  const on = w.days.includes(di)
                  return <button key={d} onClick={() => set('windows', ws.map((x, xi) => xi !== i ? x : { ...x, days: on ? x.days.filter(y => y !== di) : [...x.days, di] }))}
                    style={{ ...btn(on ? '#f59e0b' : 'rgba(255,255,255,0.08)', on ? '#0a0e1a' : '#fff'), padding: '6px 9px' }}>{d}</button>
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <input type="time" style={{ ...inp, width: 'auto' }} value={w.from} onChange={e => set('windows', ws.map((x, xi) => xi !== i ? x : { ...x, from: e.target.value }))} />
                <span>até</span>
                <input type="time" style={{ ...inp, width: 'auto' }} value={w.to} onChange={e => set('windows', ws.map((x, xi) => xi !== i ? x : { ...x, to: e.target.value }))} />
                <button onClick={() => set('windows', ws.filter((_, xi) => xi !== i))} style={btn('rgba(239,68,68,0.2)', '#f87171')}>✕</button>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => set('windows', [...ws, { days: [1, 2, 3, 4, 5], from: '14:30', to: '17:00' } as PartnerWindow])} style={btn('rgba(255,255,255,0.08)')}>+ Seg–Sex tarde</button>
            <button onClick={() => set('windows', [...ws, { days: [0, 1, 2, 3, 4, 5, 6], from: '11:00', to: '22:00' } as PartnerWindow])} style={btn('rgba(255,255,255,0.08)')}>+ Todos os dias</button>
          </div>
          <p style={{ fontSize: 12, color: '#d1d5db', marginTop: 8 }}>Fica: <b>{textoHorario({ ...(edit as any), windows: ws })}</b></p>
        </div>

        <div style={cartao}>
          <div style={{ fontWeight: 800, color: '#f59e0b' }}>📍 Moradas ({ls.length})</div>
          {ls.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <span style={{ flex: 1, fontSize: 12 }}>{l.address || `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`}</span>
              <button onClick={() => set('locations', ls.filter((_, xi) => xi !== i))} style={btn('rgba(239,68,68,0.2)', '#f87171')}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input style={inp} value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && procurarMorada()} placeholder="Eircode, morada ou nome do sítio" />
            <button onClick={procurarMorada} disabled={aBuscar} style={btn('#2563eb')}>{aBuscar ? '…' : 'Procurar'}</button>
          </div>
          {achados.map((a, i) => (
            <button key={i} onClick={() => { set('locations', [...ls, a]); setAchados([]); setBusca('') }}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 6, padding: '8px 10px', background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.35)', borderRadius: 8, color: '#fff', fontSize: 12 }}>
              + {a.address}
            </button>
          ))}
        </div>

        <div style={cartao}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
            <input type="checkbox" checked={edit.active !== false} onChange={e => set('active', e.target.checked)} /> Ativo (aparece na app)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, marginTop: 10 }}>
            <input type="checkbox" checked={!!edit.sponsored} onChange={e => set('sponsored', e.target.checked)} /> ⭐ Destaque pago — pin no mapa e cartão no fim da entrega (só plano Free)
          </label>
        </div>

        <button onClick={gravar} disabled={aGravar} style={{ ...btn('#10b981'), width: '100%', padding: 14, fontSize: 15 }}>{aGravar ? 'A guardar…' : '💾 Guardar parceiro'}</button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b' }}>🍔 Parceiros ({lista.length})</div>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>Restaurantes com desconto para riders. "Destaque" = anúncio pago.</div>
        </div>
        <button onClick={() => setEdit({ ...VAZIO })} style={btn('#10b981')}>+ Novo</button>
      </div>
      {loading ? <p style={{ color: '#9ca3af' }}>A carregar…</p> : lista.map(p => (
        <div key={p.id} style={{ ...cartao, opacity: p.active === false ? 0.5 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{p.emoji ?? '🍔'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800 }}>{p.name} {p.sponsored && <span style={{ fontSize: 10, background: '#f59e0b', color: '#0a0e1a', borderRadius: 6, padding: '1px 6px' }}>DESTAQUE</span>} {p.active === false && <span style={{ fontSize: 10, color: '#f87171' }}>inativo</span>}</div>
              <div style={{ fontSize: 12, color: p.color ?? '#f59e0b', fontWeight: 700 }}>{p.offer}{p.offerDetail ? ` · ${p.offerDetail}` : ''}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>
                {textoHorario(p)} · {disponivelAgora(p) ? '🟢 vale agora' : '🔴 fora do horário'} · {(p.locations?.length ?? 0) || (p.mapboxQuery ? 'pesquisa por nome' : 0)} morada(s)
                {(p.impressoes || p.cliques) ? ` · 👁 ${p.impressoes ?? 0} · 👆 ${p.cliques ?? 0}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => setEdit({ ...VAZIO, ...p })} style={{ ...btn('rgba(255,255,255,0.08)'), flex: 1 }}>✏️ Editar</button>
            <button onClick={() => apagar(p)} style={btn('rgba(239,68,68,0.2)', '#f87171')}>🗑</button>
          </div>
        </div>
      ))}
    </div>
  )
}
