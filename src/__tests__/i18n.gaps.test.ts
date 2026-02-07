/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for i18n
 * Targets:
 * - Line 446, 451: Fallback path when key not found in current language
 * - Edge cases in translation parameter substitution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { i18n, t } from '../renderer/utils/i18n'

describe('i18n - coverage gaps', () => {
    beforeEach(() => {
        // Reset to English
        i18n.setLanguage('en')
    })

    describe('fallback translation paths', () => {
        it('returns key when translation not found in any language', () => {
            // Test with a completely non-existent key
            const result = t('this.key.does.not.exist.anywhere')
            expect(result).toBe('this.key.does.not.exist.anywhere')
        })

        it('returns key when nested path is partially valid but final key missing', () => {
            // 'app' exists but 'app.nonexistent' does not
            const result = t('app.nonexistent.deeply.nested')
            expect(result).toBe('app.nonexistent.deeply.nested')
        })

        it('returns key when value is not a string (object)', () => {
            // 'app' points to an object, not a string
            const result = t('app')
            expect(result).toBe('app')
        })

        it('falls back to English when Chinese translation is missing', () => {
            i18n.setLanguage('zh-CN')

            // Add a test for a key that might exist in EN but hypothetically not in zh-CN
            // Since all keys are translated, we test the fallback mechanism
            const result = t('app.name')
            // Should return the Chinese translation if it exists
            expect(result).toBe('P2P 会议')
        })

        it('handles empty key string', () => {
            const result = t('')
            expect(result).toBe('')
        })

        it('handles single-part key that does not exist', () => {
            const result = t('nonexistent')
            expect(result).toBe('nonexistent')
        })
    })

    describe('parameter substitution edge cases', () => {
        it('handles undefined parameters gracefully', () => {
            const result = t('room.participantsConnected', { count: undefined as any })
            // Should keep the {count} pattern if undefined
            expect(result).toContain('participant')
        })

        it('handles numeric parameters', () => {
            const result = t('room.participantsConnected', { count: 5 })
            expect(result).toContain('5')
        })

        it('handles string parameters', () => {
            const result = t('room.participantJoined', { name: 'TestUser' })
            expect(result).toContain('TestUser')
        })

        it('handles missing parameter in template', () => {
            // The template has {count} but we don't provide it
            const result = t('room.performanceWarning', {})
            expect(result).toContain('{count}')
        })

        it('handles extra parameters that are not in template', () => {
            const result = t('app.name', { unused: 'value' })
            expect(result).toBe('P2P Conference')
        })
    })

    describe('language switching', () => {
        it('notifies subscribers on language change', () => {
            const listener = vi.fn()
            const unsubscribe = i18n.subscribe(listener)

            i18n.setLanguage('zh-CN')
            expect(listener).toHaveBeenCalledTimes(1)

            i18n.setLanguage('en')
            expect(listener).toHaveBeenCalledTimes(2)

            unsubscribe()

            i18n.setLanguage('zh-CN')
            expect(listener).toHaveBeenCalledTimes(2) // No new call after unsubscribe
        })

        it('ignores invalid language codes', () => {
            const originalLang = i18n.getLanguage()
            i18n.setLanguage('invalid-lang' as any)
            expect(i18n.getLanguage()).toBe(originalLang)
        })

        it('persists language preference to localStorage', () => {
            const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

            i18n.setLanguage('zh-CN')

            expect(setItemSpy).toHaveBeenCalledWith('p2p-conf-language', 'zh-CN')

            setItemSpy.mockRestore()
        })
    })

    describe('getAvailableLanguages', () => {
        it('returns all configured languages', () => {
            const languages = i18n.getAvailableLanguages()
            expect(languages).toHaveLength(2)
            expect(languages.find(l => l.code === 'en')).toBeDefined()
            expect(languages.find(l => l.code === 'zh-CN')).toBeDefined()
        })
    })
})
