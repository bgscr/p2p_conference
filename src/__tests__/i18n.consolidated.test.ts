/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n, t } from '../renderer/utils/i18n'

async function loadFreshI18nWithBrowserLanguage(lang: string) {
  vi.resetModules()
  localStorage.removeItem('p2p-conf-language')

  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'language')
  Object.defineProperty(navigator, 'language', {
    get: () => lang,
    configurable: true
  })

  const module = await import('../renderer/utils/i18n')

  if (originalDescriptor) {
    Object.defineProperty(navigator, 'language', originalDescriptor)
  }

  return module
}

describe('i18n consolidated suite', () => {
  beforeEach(() => {
    i18n.setLanguage('en')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['app.name', undefined, 'P2P Conference'],
    ['room.participantsConnected', { count: 5 }, '5 participant(s) connected'],
    ['missing.key.123', undefined, 'missing.key.123']
  ])('resolves translation key %s', (key, params, expected) => {
    expect(i18n.t(key, params as Record<string, string | number> | undefined)).toBe(expected)
  })

  it('returns the key when namespace resolves to an object', () => {
    expect(i18n.t('app')).toBe('app')
    expect(i18n.t('room')).toBe('room')
  })

  it('leaves missing template placeholders intact', () => {
    expect(i18n.t('room.participantsConnected', {})).toBe('{count} participant(s) connected')
  })

  it('supports language switching and invalid-language guard', () => {
    expect(i18n.getLanguage()).toBe('en')
    i18n.setLanguage('zh-CN')
    expect(i18n.getLanguage()).toBe('zh-CN')
    expect(i18n.t('app.name')).not.toBe('P2P Conference')

    i18n.setLanguage('invalid-lang' as never)
    expect(i18n.getLanguage()).toBe('zh-CN')
  })

  it('notifies subscribers on language changes and supports unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = i18n.subscribe(listener)

    i18n.setLanguage('zh-CN')
    i18n.setLanguage('en')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    i18n.setLanguage('zh-CN')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('persists language preference', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    i18n.setLanguage('zh-CN')
    expect(setItemSpy).toHaveBeenCalledWith('p2p-conf-language', 'zh-CN')
  })

  it('exposes available languages', () => {
    const langs = i18n.getAvailableLanguages()
    expect(langs).toHaveLength(2)
    expect(langs[0]).toEqual({ code: 'en', name: 'English' })
    expect(langs[1].code).toBe('zh-CN')
    expect(typeof langs[1].name).toBe('string')
    expect(langs[1].name.length).toBeGreaterThan(0)
  })

  it('exported t() delegates to i18n instance', () => {
    i18n.setLanguage('en')
    expect(t('app.name')).toBe('P2P Conference')
  })

  it.each([
    ['zh-TW', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['fr-FR', 'en']
  ])('constructor language auto-detects %s -> %s', async (browserLang, expected) => {
    const fresh = await loadFreshI18nWithBrowserLanguage(browserLang)
    expect(fresh.i18n.getLanguage()).toBe(expected)
    fresh.i18n.setLanguage('en')
  })
})
