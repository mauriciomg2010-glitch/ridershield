// Versão visível ao rider (ecrã de abertura e menu): data/hora da publicação + código curto do commit.
// Ex.: "v22.11 10:20 · 3e9f1a2" — se dois telemóveis mostram o mesmo, estão na mesma versão.
const sha = process.env.NEXT_PUBLIC_BUILD_SHA || 'dev'
const quando = process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME) : null

export const VERSAO = (() => {
  if (!quando || isNaN(quando.getTime())) return `v${sha.slice(0, 7)}`
  const p = (n: number) => String(n).padStart(2, '0')
  const d = quando.toLocaleString('en-GB', { timeZone: 'Europe/Dublin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  // "22/11/2026, 10:20" ou "22/11, 10:20" → "22.11 10:20"
  const m = d.match(/(\d{2})\/(\d{2})(?:\/\d{4})?,?\s*(\d{2}):(\d{2})/)
  const txt = m ? `${m[1]}.${m[2]} ${m[3]}:${m[4]}` : `${p(quando.getDate())}.${p(quando.getMonth() + 1)}`
  return `v${txt} · ${sha.slice(0, 7)}`
})()
