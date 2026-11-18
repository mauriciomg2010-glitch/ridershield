// src/lib/sun.ts — altura do sol (graus acima do horizonte) para o mapa escurecer à noite,
// como o Google Maps: de madrugada/à noite mapa escuro com a rota azul néon, de dia mapa claro.
// Fórmula aproximada do NOAA (erro < 0,5°, chega para decidir dia/noite).

const RAD = Math.PI / 180

export function sunAltitudeDeg(date: Date, lat: number, lng: number): number {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0       // dias desde J2000
  const g = (357.529 + 0.98560028 * d) * RAD                         // anomalia média
  const q = 280.459 + 0.98564736 * d                                 // longitude média
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD // longitude eclíptica
  const e = (23.439 - 0.00000036 * d) * RAD                          // obliquidade
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24           // horas
  const lst = (gmst * 15 + lng) * RAD
  const ha = lst - ra
  const la = lat * RAD
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha))
  return alt / RAD
}

/** Mapa noturno: sol abaixo de −4° (crepúsculo já escuro). Em Dublin, ~20 min depois do pôr do sol. */
export const NIGHT_SUN_ALT = -4
export const isNight = (date: Date, lat: number, lng: number) => sunAltitudeDeg(date, lat, lng) < NIGHT_SUN_ALT
