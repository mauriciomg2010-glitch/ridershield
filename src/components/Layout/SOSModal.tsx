// src/components/Layout/SOSModal.tsx
'use client'
import { useMemo, useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { useLang } from '@/contexts/LangContext'

interface Props {
  onClose: () => void
}

function phoneE164(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

export default function SOSModal({ onClose }: Props) {
  const { t } = useLang()
  const user = useStore((s) => s.user)
  const currentLocation = useStore((s) => s.currentLocation)
  const emergencyContacts = useStore((s) => s.emergencyContacts)

  const refNumber = useMemo(() => `RS-${Math.floor(1000 + Math.random() * 9000)}`, [])

  const [contact1Sent, setContact1Sent] = useState(false)
  const [contact2Sent, setContact2Sent] = useState(false)
  const [notified, setNotified] = useState(false)

  const gpsLink = currentLocation
    ? `https://maps.google.com/?q=${currentLocation.lat},${currentLocation.lng}`
    : '(localização não disponível)'

  const buildSosMsg = (name: string) =>
    encodeURIComponent(
      `🚨 SOS — ${user?.name ?? 'Rider'} pode estar em perigo!\n📍 Localização: ${gpsLink}\n🔖 Ref: ${refNumber}`
    )

  const buildCancelMsg = (name: string) =>
    encodeURIComponent(
      `✅ CANCELADO: ${user?.name ?? 'Rider'} cancelou o SOS ${refNumber}. Está bem.`
    )

  function handleNotify() {
    if (!emergencyContacts?.contact1) return
    const c1 = emergencyContacts.contact1
    window.open(`https://wa.me/${phoneE164(c1.phone)}?text=${buildSosMsg(c1.name)}`, '_blank')
    setContact1Sent(true)
    setNotified(true)
    if (emergencyContacts.contact2) {
      const c2 = emergencyContacts.contact2
      setTimeout(() => {
        window.open(`https://wa.me/${phoneE164(c2.phone)}?text=${buildSosMsg(c2.name)}`, '_blank')
        setContact2Sent(true)
      }, 1500)
    }
  }

  function handleCancel() {
    onClose()
  }

  const guardaNumber = emergencyContacts?.guardaNumber ?? '112'

  return (
    <>
      <style>{`
        @keyframes sosScale {
          from { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
          to   { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
        }
        @keyframes sosPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220,53,69,0.5); }
          50%       { box-shadow: 0 0 0 14px rgba(220,53,69,0); }
        }
        .sos-modal { animation: sosScale 0.2s ease-out forwards; }
        .sos-pulse { animation: sosPulse 1.8s ease-in-out infinite; }
      `}</style>

      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 8000 }} />

      {/* Modal card */}
      <div className="sos-modal" style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 8001, width: 'min(380px, 92vw)',
        background: '#1a1035', borderRadius: 20,
        overflow: 'hidden', border: '1px solid rgba(220,53,69,0.35)',
      }}>
        {/* Red header */}
        <div style={{ background: '#dc3545', padding: '28px 24px 22px', textAlign: 'center' }}>
          <div className="sos-pulse" style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px', fontSize: 32,
          }}>🚨</div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'white', letterSpacing: 0.5 }}>
            SOS Activado
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
            Localização GPS partilhada em tempo real
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px 28px' }}>

          {/* Reference */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>
              Referência
            </p>
            <span style={{ fontSize: 26, fontWeight: 800, color: '#a78bfa', letterSpacing: 2 }}>
              {refNumber}
            </span>
          </div>

          {/* Notified contacts */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 10px' }}>
              Contactos notificados
            </p>
            {!emergencyContacts?.contact1 ? (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ margin: 0, fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>
                  Sem contactos configurados — adiciona no perfil
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ContactRow
                  name={emergencyContacts.contact1.name}
                  phone={emergencyContacts.contact1.phone}
                  sent={contact1Sent}
                />
                {emergencyContacts.contact2 && (
                  <ContactRow
                    name={emergencyContacts.contact2.name}
                    phone={emergencyContacts.contact2.phone}
                    sent={contact2Sent}
                  />
                )}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {emergencyContacts?.contact1 && (
              <button
                onClick={handleNotify}
                disabled={notified}
                style={{
                  width: '100%', textAlign: 'center',
                  background: notified ? 'rgba(16,185,129,0.2)' : 'rgba(37,211,102,0.15)',
                  color: notified ? '#10b981' : '#25d366',
                  border: `1px solid ${notified ? 'rgba(16,185,129,0.4)' : 'rgba(37,211,102,0.35)'}`,
                  borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 700,
                  cursor: notified ? 'default' : 'pointer',
                }}
              >
                {notified ? '✅ Contactos notificados' : '📱 Notificar contactos'}
              </button>
            )}
            <a
              href={`tel:${guardaNumber}`}
              style={{
                display: 'block', width: '100%', textAlign: 'center',
                background: '#dc3545', color: 'white',
                borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 700,
                textDecoration: 'none', boxShadow: '0 4px 14px rgba(220,53,69,0.4)',
              }}
            >
              📞 Ligar Garda — {guardaNumber}
            </a>
            <button
              onClick={handleCancel}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.07)',
                color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ✅ Estou bem — Cancelar
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function ContactRow({ name, phone, sent }: { name: string; phone: string; sent: boolean }) {
  return (
    <div style={{
      background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
      borderRadius: 12, padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: 'rgba(16,185,129,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, flexShrink: 0,
      }}>👤</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: '#e5e7eb' }}>{name}</p>
        <p style={{ margin: 0, fontSize: 11, color: '#9ca3af' }}>{phone}</p>
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
        background: sent ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
        color: sent ? '#10b981' : '#6b7280',
        whiteSpace: 'nowrap',
        transition: 'all 0.4s',
      }}>
        {sent ? 'WhatsApp enviado ✅' : 'Por enviar'}
      </span>
    </div>
  )
}
