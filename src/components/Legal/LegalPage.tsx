// Página legal simples (Privacidade / Termos): EN + PT na mesma página, sem login.
import Link from 'next/link'

export const ATUALIZADO = '25 November 2026'
/** Contacto para privacidade — trocar pelo email oficial do ZIVO antes da Play Store. */
export const CONTACTO = process.env.NEXT_PUBLIC_PRIVACY_EMAIL || 'zivo.app.ie@gmail.com'

export type Secao = { t: string; p: (string | string[])[] }

export default function LegalPage({ titulo, en, pt }: { titulo: string; en: Secao[]; pt: Secao[] }) {
  const bloco = (secs: Secao[]) => secs.map((s, i) => (
    <section key={i} style={{ marginTop: 22 }}>
      <h2 style={{ fontSize: 17, margin: '0 0 6px', color: '#111' }}>{s.t}</h2>
      {s.p.map((x, j) => Array.isArray(x)
        ? <ul key={j} style={{ margin: '6px 0', paddingLeft: 22, listStyle: 'disc' }}>{x.map((li, k) => <li key={k} style={{ margin: '4px 0' }}>{li}</li>)}</ul>
        : <p key={j} style={{ margin: '6px 0' }}>{x}</p>)}
    </section>
  ))
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '28px 18px 60px', fontFamily: 'system-ui, sans-serif', fontSize: 15, lineHeight: 1.6, color: '#333', background: '#fff', minHeight: '100vh' }}>
      <Link href="/" style={{ color: '#b8860b', fontWeight: 700, textDecoration: 'none' }}>← ZIVO</Link>
      <h1 style={{ fontSize: 26, margin: '14px 0 2px', color: '#111' }}>{titulo}</h1>
      <p style={{ color: '#777', margin: 0 }}>Last updated / Atualizado: {ATUALIZADO}</p>
      <nav style={{ marginTop: 10, fontSize: 14 }}><a href="#en">English</a> · <a href="#pt">Português</a></nav>
      <div id="en">{bloco(en)}</div>
      <hr style={{ margin: '36px 0', border: 0, borderTop: '1px solid #eee' }} />
      <div id="pt">{bloco(pt)}</div>
    </main>
  )
}
