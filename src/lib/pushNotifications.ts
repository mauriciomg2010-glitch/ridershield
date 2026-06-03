// Push notifications disabled
export async function registerPushToken(_userId: string): Promise<string | null> {
  return null
}

export async function onForegroundMessage(_callback: (payload: any) => void): Promise<() => void> {
  return () => {}
}
