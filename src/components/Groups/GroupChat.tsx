// src/components/Groups/GroupChat.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { subscribeToGroupChat, sendChatMessage, ChatMessage } from '@/lib/firestore'
import toast from 'react-hot-toast'

function fmtTime(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface Props {
  groupId: string
  groupName: string
  onClose: () => void
  currentUserId: string
  currentUserName: string
}

export default function GroupChat({ groupId, groupName, onClose, currentUserId, currentUserName }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showEmojis, setShowEmojis] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const EMOJIS = ['😊','😂','👍','🙏','🔥','💪','❤️','😭','🤔','😅','👋','🥲','😎','🤣','😁','💯','🚴','📦','⚡','✅']

  useEffect(() => {
    const unsub = subscribeToGroupChat(groupId, setMessages)
    return unsub
  }, [groupId])

  useEffect(() => {
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [messages.length])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    const saved = text
    setText('')
    try {
      await sendChatMessage(groupId, currentUserId, currentUserName, trimmed)
    } catch {
      toast.error('Failed to send')
      setText(saved)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 120px)',
      background: 'var(--bg)',
      width: '100%',
    }}>

      {/* Header */}
      <div style={{
        flexShrink: 0,
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '0 16px',
        borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={onClose}
          style={{ color: 'var(--muted)', padding: '8px', marginLeft: '-8px', display: 'flex', alignItems: 'center' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p style={{ flex: 1, fontSize: '14px', fontWeight: 700, textAlign: 'center', color: 'var(--text)', margin: 0 }}>
          💬 Chat — {groupName}
        </p>
        <div style={{ width: '36px', flexShrink: 0 }} />
      </div>

      {/* Messages — flex:1 + minHeight:0 so it shrinks and scrolls */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '12px 16px',
        overscrollBehavior: 'contain',
      }}>
        {messages.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <p style={{ fontSize: '14px', textAlign: 'center', color: 'var(--muted)' }}>
              Sem mensagens. Diz olá! 👋
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {messages.map((msg) => {
              const isOwn = msg.userId === currentUserId
              const isEmergency = msg.emergency === true || msg.type === 'emergency'
              const initial = msg.userName?.charAt(0).toUpperCase() ?? '?'

              // Emergency message — full-width red card
              if (isEmergency) {
                return (
                  <div key={msg.id} style={{
                    borderLeft: '4px solid #ef4444',
                    background: '#7f1d1d',
                    borderRadius: '8px',
                    padding: '12px',
                    color: 'white',
                    fontWeight: 'bold',
                  }}>
                    <div style={{ fontSize: '11px', color: '#fca5a5', marginBottom: '4px' }}>
                      🚨 RiderShield Alert · {fmtTime(msg.timestamp)}
                    </div>
                    <div style={{ fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
                      {msg.text}
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={msg.id}
                  style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', flexDirection: isOwn ? 'row-reverse' : 'row' }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 700, color: 'white', flexShrink: 0,
                    background: isOwn ? 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' : '#6b7280',
                  }}>
                    {initial}
                  </div>

                  {/* Content */}
                  <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '72%', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', padding: '0 4px', flexDirection: isOwn ? 'row-reverse' : 'row' }}>
                      {!isOwn && (
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#93c5fd' }}>
                          {msg.userName}
                        </span>
                      )}
                      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {fmtTime(msg.timestamp)}
                      </span>
                    </div>
                    <div style={{
                      padding: '8px 12px',
                      fontSize: '14px',
                      lineHeight: 1.4,
                      background: isOwn ? 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' : 'var(--card)',
                      color: isOwn ? 'white' : 'var(--text)',
                      borderRadius: isOwn ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                      border: isOwn ? 'none' : '1px solid var(--border)',
                      wordBreak: 'break-word',
                    }}>
                      {msg.text}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Emoji picker */}
      {showEmojis && (
        <div style={{
          flexShrink: 0,
          padding: '8px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
        }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => { setText(t => t + e); inputRef.current?.focus() }}
              style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Input bar — always visible at bottom */}
      <div style={{
        flexShrink: 0,
        padding: '8px 16px 20px',
        borderTop: showEmojis ? 'none' : '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
      }}>
        <button
          onClick={() => setShowEmojis(s => !s)}
          style={{
            fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
            color: showEmojis ? '#4f8ef7' : 'var(--muted)', flexShrink: 0,
          }}>
          😊
        </button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
          }}
          placeholder="Escreve uma mensagem..."
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: '20px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            opacity: (!text.trim() || sending) ? 0.4 : 1,
            cursor: (!text.trim() || sending) ? 'not-allowed' : 'pointer',
            border: 'none',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
