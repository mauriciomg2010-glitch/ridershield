// src/app/safety-tips/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLang } from '@/contexts/LangContext'

interface VideoTip {
  id: string; title: string; duration: string; thumbnail: string; description: string; tips: string[]
}

const VIDEO_TIPS: VideoTip[] = [
  {
    id: 'v1', title: 'How to Lock Your Bike Properly', duration: '2:30', thumbnail: '🔐',
    description: 'Learn the D-lock + chain technique used by professional couriers.',
    tips: [
      'Always lock through the frame AND rear wheel',
      'Use a D-lock on rear wheel + chain through frame to fixed object',
      'Leave minimal slack in the lock — harder to use tools',
      'Lock at hip height — harder to attack with leverage',
      'Never use a cable lock alone — they can be cut in seconds',
    ],
  },
  {
    id: 'v2', title: 'Safe Parking During Deliveries', duration: '1:45', thumbnail: '🏪',
    description: 'Where and how to park during short stops at restaurants and customers.',
    tips: [
      'Park as close to entrance as possible — always in sight',
      'Choose busy, well-lit spots even if slightly further',
      "Never leave bike/moto more than 2 min without locking",
      "Ask restaurant staff if there's a safe area at the back",
      'Face your bike towards the exit for quick departure',
    ],
  },
  {
    id: 'v3', title: 'Spotting & Avoiding Risky Areas', duration: '3:00', thumbnail: '👁️',
    description: 'How to identify and avoid areas with high theft risk.',
    tips: [
      'Check the red zones on the ZIVO map before your route',
      'Trust your instincts — if it feels wrong, leave',
      'Avoid stopping in blind alleys or dark side streets',
      'Keep engine running when possible in unknown areas',
      "Vary your route — don't create predictable patterns",
    ],
  },
  {
    id: 'v4', title: 'GPS Trackers — Hidden Installation', duration: '4:15', thumbnail: '📡',
    description: 'Best places to hide AirTag and GPS trackers on bikes and motos.',
    tips: [
      'Inside handlebar tube (bikes) — use waterproof case',
      'Under seat compartment (moto) — wrap in foam',
      'Inside frame bag or under bottle cage',
      'Register tracker with An Garda Síochána bike register',
      'Use 2 trackers in different locations for redundancy',
    ],
  },
  {
    id: 'v5', title: 'What To Do If Your Bike Is Stolen', duration: '2:00', thumbnail: '🚨',
    description: 'Immediate steps to take if your bike or moto is stolen.',
    tips: [
      'Call An Garda Síochána immediately: 999 or 112',
      'Share GPS tracker location with Gardaí immediately',
      'Post on DublinBikes Facebook group with description',
      'Contact your insurer within 24 hours',
      'Check nearby CCTV — ask businesses for footage',
      'File online report at garda.ie for insurance purposes',
    ],
  },
]

function FullModal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[500] flex flex-col" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center justify-between px-5 pt-14 pb-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>{title}</h2>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--card)', color: 'var(--muted)' }}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {children}
        <div style={{ height: '100px' }} />
      </div>
    </div>
  )
}

export default function SafetyTipsPage() {
  const router = useRouter()
  const { t } = useLang()
  const [selectedVideo, setSelectedVideo] = useState<VideoTip | null>(null)

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-14 pb-4 border-b flex-shrink-0"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <button onClick={() => router.back()} className="p-2 -ml-2" style={{ color: 'var(--text)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>🎥 {t('safety_tips_nav')}</h1>
      </div>

      <div className="px-5 py-4 space-y-4 pb-20">
        {/* Under Construction banner */}
        <div className="rounded-2xl p-5 flex flex-col items-center text-center"
          style={{ background: 'rgba(45,111,232,0.08)', border: '1px solid rgba(45,111,232,0.25)' }}>
          <span className="text-3xl mb-2">🚧</span>
          <p className="font-bold text-sm mb-1" style={{ color: '#93c5fd' }}>{t('videos_under_construction')}</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('videos_uc_desc')}</p>
        </div>

        {/* Video list */}
        <div className="space-y-3">
          {VIDEO_TIPS.map((video) => (
            <button key={video.id} onClick={() => setSelectedVideo(video)}
              className="w-full rounded-2xl p-4 text-left flex items-center gap-4"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
                style={{ background: 'rgba(45,111,232,0.15)' }}>{video.thumbnail}</div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm leading-tight" style={{ color: 'var(--text)' }}>{video.title}</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{video.description}</p>
                <span className="text-xs mt-1 inline-block" style={{ color: '#4f8ef7' }}>⏱ {video.duration} · {video.tips.length} tips</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* Video detail modal */}
      {selectedVideo && (
        <FullModal onClose={() => setSelectedVideo(null)} title={selectedVideo.title}>
          <div className="w-full rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(45,111,232,0.1)', border: '1px solid rgba(45,111,232,0.2)', height: '120px', fontSize: '48px' }}>
            {selectedVideo.thumbnail}
          </div>
          <div className="rounded-xl p-3 mb-4 flex flex-col items-center gap-1"
            style={{ background: 'rgba(45,111,232,0.08)', border: '1px solid rgba(45,111,232,0.2)' }}>
            <p className="text-sm font-bold" style={{ color: '#93c5fd' }}>🚧 {t('videos_under_construction')}</p>
            <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>{t('videos_uc_desc')}</p>
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>{selectedVideo.description}</p>
          <p className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>🔑 {t('key_tips')} ({selectedVideo.tips.length}):</p>
          <div className="space-y-3">
            {selectedVideo.tips.map((tip, i) => (
              <div key={i} className="flex gap-3 items-start p-3 rounded-xl" style={{ background: 'var(--card)' }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white"
                  style={{ background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)', minWidth: '24px' }}>{i + 1}</div>
                <p className="text-sm" style={{ color: 'var(--text)' }}>{tip}</p>
              </div>
            ))}
          </div>
        </FullModal>
      )}
    </div>
  )
}
