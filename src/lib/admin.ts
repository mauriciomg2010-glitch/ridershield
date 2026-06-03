export const ADMIN_UID = 'kXNpNTLYe5P55PhI8K4VrZSahOC2'

export type AdminRole = 'super' | 'editor'

// Lista de emails com acesso ao painel admin
// TODO: substituir os placeholders pelos emails reais do Thiago e contenpilot
const ADMIN_PERMISSIONS: Record<string, AdminRole> = {
  'mauriciomg_2010@hotmail.com':    'super',   // controlo total
  'daianeschlichting83@gmail.com':  'super',   // controlo total
  'thiago@placeholder.com':         'editor',  // TODO: email real do Thiago
  'contenpilot@placeholder.com':    'editor',  // TODO: email real do contenpilot
}

export const ADMIN_EMAILS = Object.keys(ADMIN_PERMISSIONS)

export function isAdminUser(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase() in ADMIN_PERMISSIONS
}

export function getAdminRole(email: string | null | undefined): AdminRole | null {
  if (!email) return null
  return ADMIN_PERMISSIONS[email.toLowerCase()] ?? null
}

export function canEditZones(email: string | null | undefined): boolean {
  const role = getAdminRole(email)
  return role === 'super' || role === 'editor'
}

export function canDeleteData(email: string | null | undefined): boolean {
  return getAdminRole(email) === 'super'
}
