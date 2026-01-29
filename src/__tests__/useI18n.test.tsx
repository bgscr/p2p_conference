/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useI18n } from '../renderer/hooks/useI18n'
import { i18n } from '../renderer/utils/i18n'

describe('useI18n Hook', () => {
    beforeEach(() => {
        // Reset language to English before each test
        i18n.setLanguage('en')
    })

    it('should return translation functions', () => {
        const { result } = renderHook(() => useI18n())

        expect(typeof result.current.t).toBe('function')
        expect(typeof result.current.setLanguage).toBe('function')
    })

    it('should translate keys', () => {
        const { result } = renderHook(() => useI18n())
        expect(result.current.t('app.name')).toBe('P2P Conference')
    })

    it('should update on language change', () => {
        const { result } = renderHook(() => useI18n())

        expect(result.current.currentLanguage).toBe('en')

        act(() => {
            result.current.setLanguage('zh-CN')
        })

        expect(result.current.currentLanguage).toBe('zh-CN')
        expect(result.current.t('app.name')).toBe('P2P 会议')
    })

    it('should list available languages', () => {
        const { result } = renderHook(() => useI18n())
        const languages = result.current.getAvailableLanguages()

        expect(languages.length).toBeGreaterThan(0)
        expect(languages.some(l => l.code === 'en')).toBe(true)
    })
})
