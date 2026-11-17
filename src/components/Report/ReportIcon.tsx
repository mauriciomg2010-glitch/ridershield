// src/components/Report/ReportIcon.tsx
// Ícones desenhados dos reports (policial, ladrão de máscara, buraco, cone de obra…).
// O mesmo SVG serve para o menu, os avisos e o MAPA (convertido em imagem do Mapbox).
'use client'
import { INCIDENT_TYPES } from '@/data/incidentTypes'

const W = '#ffffff'
const D = '#111827'

function glyph(type: string, bg: string): string {
  switch (type) {
    case 'assault_robbery':
    case 'attempted_robbery':
    case 'robbery':
      // cabeça com máscara de ladrão
      return `<path d="M11 41c2-7 7-10 13-10s11 3 13 10" fill="${W}"/>
        <circle cx="24" cy="20" r="10" fill="${W}"/>
        <rect x="12.5" y="16" width="23" height="7" rx="3.5" fill="${D}"/>
        <ellipse cx="19.5" cy="19.5" rx="2.4" ry="1.8" fill="${W}"/><ellipse cx="28.5" cy="19.5" rx="2.4" ry="1.8" fill="${W}"/>`
    case 'bike_theft':
      return `<g fill="none" stroke="${W}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="14" cy="30" r="6"/><circle cx="34" cy="30" r="6"/>
        <path d="M14 30 L21 30 L28 19 L34 30 M21 30 L18 19 M15.5 19 H21 M28 19 L27 15 H31"/></g>`
    case 'physical_assault':
    case 'aggression':
      // impacto (soco)
      return `<path d="M24 8 L27.5 17.5 L37 14 L31.5 22.5 L40 27 L30 28.5 L32 38.5 L24 32.5 L16 38.5 L18 28.5 L8 27 L16.5 22.5 L11 14 L20.5 17.5 Z" fill="${W}"/>
        <circle cx="24" cy="24" r="4" fill="${bg}"/>`
    case 'suspicious_activity':
      return `<path d="M7 24 C13 14 35 14 41 24 C35 34 13 34 7 24 Z" fill="${W}"/>
        <circle cx="24" cy="24" r="6.5" fill="${D}"/><circle cx="26" cy="22" r="2" fill="${W}"/>`
    case 'police':
      // policial com boné
      return `<path d="M11 42c2-6 7-9 13-9s11 3 13 9" fill="${W}"/>
        <circle cx="24" cy="25" r="7.5" fill="${W}"/>
        <path d="M14 18 L16.5 9.5 Q24 6.5 31.5 9.5 L34 18 Z" fill="${W}"/>
        <rect x="12.5" y="17" width="23" height="3.5" rx="1.5" fill="${D}"/>
        <circle cx="24" cy="12.5" r="2.4" fill="#fbbf24"/>`
    case 'accident':
      // carro batido + estrela de impacto
      return `<path d="M8 33 V26 Q8 24 10 24 L14 24 L18 17.5 H28 L32.5 24 H36 Q38 24 38 26 V33 Z" fill="${W}"/>
        <path d="M19.5 19.5 H27 L30 24 H16.5 Z" fill="${bg}"/>
        <circle cx="15" cy="33.5" r="3.5" fill="${D}"/><circle cx="31" cy="33.5" r="3.5" fill="${D}"/>
        <path d="M38 8 L39.5 12 L43.5 11 L41 14.5 L44 17.5 L40 17.5 L39.5 21.5 L37 18.5 L33.5 20 L35 16 L32 13.5 L36 13 Z" fill="#fde047"/>`
    case 'traffic_jam':
      // carro de frente
      return `<path d="M12 33 V25 Q12 22 15 21.5 L18 14.5 Q18.8 13 20.5 13 H27.5 Q29.2 13 30 14.5 L33 21.5 Q36 22 36 25 V33 Z" fill="${W}"/>
        <path d="M19.8 15.8 H28.2 L30.5 21 H17.5 Z" fill="${bg}"/>
        <circle cx="17" cy="27" r="2.3" fill="#fde047"/><circle cx="31" cy="27" r="2.3" fill="#fde047"/>
        <rect x="13" y="33" width="5" height="4" rx="1" fill="${D}"/><rect x="30" y="33" width="5" height="4" rx="1" fill="${D}"/>`
    case 'construction':
      // cone de obra
      return `<path d="M21 9 H27 L35 36 H13 Z" fill="${W}"/>
        <path d="M18.6 17 H29.4 L30.8 22 H17.2 Z M15.9 26 H32.1 L33.5 31 H14.5 Z" fill="${bg}"/>
        <rect x="10" y="35.5" width="28" height="4" rx="1.5" fill="${W}"/>`
    case 'road_closed':
    case 'no_entry_zone':
      return `<rect x="11" y="20.5" width="26" height="7" rx="2" fill="${W}"/>`
    case 'pothole':
      // buraco com rachas
      return `<ellipse cx="24" cy="27" rx="14" ry="7.5" fill="${D}" stroke="${W}" stroke-width="2.5"/>
        <path d="M10 27 L5 24 M38 27 L43 23.5 M18 20.5 L15 15 M30 20.5 L33.5 15.5" stroke="${W}" stroke-width="2.5" stroke-linecap="round"/>`
    case 'road_hazard':
      // caixa / objeto na via
      return `<path d="M24 9 L38 16 L24 23 L10 16 Z" fill="${W}"/>
        <path d="M10 18.5 L22.5 25 V39 L10 32.5 Z" fill="${W}" fill-opacity="0.85"/>
        <path d="M38 18.5 L25.5 25 V39 L38 32.5 Z" fill="${W}" fill-opacity="0.65"/>`
    case 'flooding':
      return `<g fill="none" stroke="${W}" stroke-width="3.2" stroke-linecap="round">
        <path d="M8 18 q4 -4 8 0 t8 0 t8 0 t8 0"/><path d="M8 26 q4 -4 8 0 t8 0 t8 0 t8 0"/><path d="M8 34 q4 -4 8 0 t8 0 t8 0 t8 0"/></g>`
    case 'confirmed_safe':
      return `<path d="M13 25 L21 33 L36 16" fill="none" stroke="${W}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`
    default:
      return `<path d="M24 10 L39 37 H9 Z" fill="${W}"/><rect x="22.3" y="19" width="3.4" height="10" rx="1.5" fill="${D}"/><circle cx="24" cy="32.5" r="2" fill="${D}"/>`
  }
}

/** SVG completo (círculo colorido com anel branco + desenho). */
export function reportIconSvg(type: string, size = 48): string {
  const bg = INCIDENT_TYPES.find(t => t.id === type)?.color
    ?? ({ robbery: '#dc2626', aggression: '#b91c1c' } as Record<string, string>)[type] ?? '#6b7280'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="22.5" fill="${bg}" stroke="${W}" stroke-width="3"/>
    <g transform="translate(24 24) scale(0.78) translate(-24 -24)">${glyph(type, bg)}</g></svg>`
}

export default function ReportIcon({ type, size = 32 }: { type: string; size?: number }) {
  return (
    <span aria-hidden style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: reportIconSvg(type, size) }} />
  )
}
