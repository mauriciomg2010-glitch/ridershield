// src/contexts/LangContext.tsx
'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Lang, LANGUAGES, t as translate } from '@/lib/i18n'

interface LangContextType {
    lang: Lang
    setLang: (l: Lang) => void
    t: (key: string) => string
}

const LangContext = createContext<LangContextType>({ lang: 'en', setLang: () => { }, t: (k) => k })

export function LangProvider({ children }: { children: ReactNode }) {
    const [lang, setLangState] = useState<Lang>('en')
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        const saved = localStorage.getItem('rs-lang') as Lang
        if (saved && LANGUAGES.find((l) => l.code === saved)) {
            setLangState(saved)
        }
    }, [])

    function setLang(l: Lang) {
        setLangState(l)
        if (typeof window !== 'undefined') localStorage.setItem('rs-lang', l)
    }

    function t(key: string) { return translate(lang, key) }

    return (
        <LangContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LangContext.Provider>
    )
}

export function useLang() { return useContext(LangContext) }
