/**
 * useI18n Hook
 * React hook for internationalization with automatic re-rendering
 */

import { useState, useEffect, useCallback } from 'react'
import { i18n, t as translate, Language } from '../utils/i18n'

export function useI18n() {
  const [, setForceUpdate] = useState(0)

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setForceUpdate(n => n + 1)
    })
    return unsubscribe
  }, [])

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    return translate(key, params)
  }, [])

  const setLanguage = useCallback((lang: Language) => {
    i18n.setLanguage(lang)
  }, [])

  const getLanguage = useCallback((): Language => {
    return i18n.getLanguage()
  }, [])

  const getAvailableLanguages = useCallback(() => {
    return i18n.getAvailableLanguages()
  }, [])

  return {
    t,
    setLanguage,
    getLanguage,
    getAvailableLanguages,
    currentLanguage: i18n.getLanguage(),
  }
}
