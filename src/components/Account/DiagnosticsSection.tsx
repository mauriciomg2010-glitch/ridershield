// src/components/Account/DiagnosticsSection.tsx
'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { diagOn, setDiag, diagCount, onDiagChange, clearDiag, exportDiag } from '@/lib/diagnostics'

export default function DiagnosticsSection() {
  const [on, setOn] = useState(false)
  const [count, setCount] = useState(0)
  useEffect(() => {
    const upd = () => { setOn(diagOn()); setCount(diagCount()) }
    upd()
    const off = onDiagChange(upd)
    const t = setInterval(upd, 2000)
    return () => { off(); clearInterval(t) }
  }, [])

  return (
    <div className="px-4 pt-2">
      <div className="rounded-xl p-4" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>🩺 Modo diagnóstico</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {on ? `A gravar · ${count} registos` : 'Grava GPS, bússola e navegação para análise'}
            </p>
          </div>
          <button onClick={() => { setDiag(!on); toast(on ? 'Diagnóstico desligado' : '🔴 Diagnóstico a gravar') }}
            className="rounded-full text-xs font-bold px-3 py-1.5"
            style={{ background: on ? '#dc2626' : '#f59e0b', color: on ? 'white' : '#0a0e1a' }}>
            {on ? 'Parar' : 'Ligar'}
          </button>
        </div>
        {count > 1 && (
          <div className="flex gap-2 mt-3">
            <button onClick={() => exportDiag().catch(() => toast.error('Não foi possível exportar'))}
              className="flex-[2] py-2 rounded-lg text-xs font-bold"
              style={{ background: '#f59e0b', color: '#0a0e1a' }}>
              📤 Exportar ficheiro
            </button>
            <button onClick={() => { if (confirm('Apagar os registos do diagnóstico?')) clearDiag() }}
              className="flex-1 py-2 rounded-lg text-xs"
              style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              Limpar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
