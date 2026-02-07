/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for useI18n hook
 * Targets:
 * - Line 29: getLanguage callback
 * - Line 32-34: getAvailableLanguages callback
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useI18n } from '../renderer/hooks/useI18n'
import { i18n } from '../renderer/utils/i18n'

describe('useI18n - coverage gaps', () => {
    beforeEach(() => {
        i18n.setLanguage('en')
    })

    describe('getLanguage callback', () => {
        it('returns the current language', () => {
            const { result } = renderHook(() => useI18n())

            expect(result.current.getLanguage()).toBe('en')
        })

        it('returns updated language after setLanguage', () => {
            const { result } = renderHook(() => useI18n())

            act(() => {
                result.current.setLanguage('zh-CN')
            })

            expect(result.current.getLanguage()).toBe('zh-CN')
        })

        it('getLanguage is memoized and stable across renders', () => {
            const { result, rerender } = renderHook(() => useI18n())

            const getLanguage1 = result.current.getLanguage
            rerender()
            const getLanguage2 = result.current.getLanguage

            expect(getLanguage1).toBe(getLanguage2)
        })
    })

    describe('getAvailableLanguages callback', () => {
        it('returns array of available languages', () => {
            const { result } = renderHook(() => useI18n())

            const languages = result.current.getAvailableLanguages()

            expect(Array.isArray(languages)).toBe(true)
            expect(languages.length).toBeGreaterThan(0)
            expect(languages.find(l => l.code === 'en')).toBeDefined()
            expect(languages.find(l => l.code === 'zh-CN')).toBeDefined()
        })

        it('getAvailableLanguages is memoized', () => {
            const { result, rerender } = renderHook(() => useI18n())

            const getAvail1 = result.current.getAvailableLanguages
            rerender()
            const getAvail2 = result.current.getAvailableLanguages

            expect(getAvail1).toBe(getAvail2)
        })

        it('each language has code and name', () => {
            const { result } = renderHook(() => useI18n())

            const languages = result.current.getAvailableLanguages()

            languages.forEach(lang => {
                expect(lang).toHaveProperty('code')
                expect(lang).toHaveProperty('name')
                expect(typeof lang.code).toBe('string')
                expect(typeof lang.name).toBe('string')
            })
        })
    })

    describe('currentLanguage property', () => {
        it('reflects current language from i18n', () => {
            const { result } = renderHook(() => useI18n())

            expect(result.current.currentLanguage).toBe('en')
        })

        it('updates when language changes', () => {
            const { result } = renderHook(() => useI18n())

            act(() => {
                result.current.setLanguage('zh-CN')
            })

            expect(result.current.currentLanguage).toBe('zh-CN')
        })
    })

    describe('t function', () => {
        it('translates simple keys', () => {
            const { result } = renderHook(() => useI18n())

            expect(result.current.t('app.name')).toBe('P2P Conference')
        })

        it('translates with parameters', () => {
            const { result } = renderHook(() => useI18n())

            const translated = result.current.t('room.participantsConnected', { count: 3 })
            expect(translated).toContain('3')
        })

        it('t function is memoized', () => {
            const { result, rerender } = renderHook(() => useI18n())

            const t1 = result.current.t
            rerender()
            const t2 = result.current.t

            expect(t1).toBe(t2)
        })
    })

    describe('subscription and re-rendering', () => {
        it('re-renders component when language changes externally', () => {
            let renderCount = 0

            renderHook(() => {
                renderCount++
                return useI18n()
            })

            const initialRenderCount = renderCount

            // Change language externally (not via hook's setLanguage)
            act(() => {
                i18n.setLanguage('zh-CN')
            })

            expect(renderCount).toBeGreaterThan(initialRenderCount)
        })

        it('cleans up subscription on unmount', () => {
            const { unmount } = renderHook(() => useI18n())

            // Should not throw when unmounted and language changes
            unmount()

            expect(() => {
                i18n.setLanguage('en')
            }).not.toThrow()
        })
    })
})
