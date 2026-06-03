// src/lib/demo.ts
// Demo mode: 15 days from first install, all premium features unlocked

const DEMO_START_KEY = 'rs-demo-start'
const DEMO_DAYS = 15

export function getDemoInfo(): { isDemo: boolean; daysLeft: number; startDate: Date } {
    if (typeof window === 'undefined') return { isDemo: true, daysLeft: DEMO_DAYS, startDate: new Date() }

    let startStr = localStorage.getItem(DEMO_START_KEY)
    if (!startStr) {
        const now = new Date().toISOString()
        localStorage.setItem(DEMO_START_KEY, now)
        startStr = now
    }

    const startDate = new Date(startStr)
    const now = new Date()
    const daysPassed = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const daysLeft = Math.max(0, DEMO_DAYS - daysPassed)

    return { isDemo: daysLeft > 0, daysLeft, startDate }
}

export function isDemoPremium(): boolean {
    const { isDemo } = getDemoInfo()
    return isDemo
}
