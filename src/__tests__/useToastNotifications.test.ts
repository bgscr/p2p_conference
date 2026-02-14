import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastNotifications } from '../renderer/hooks/useToastNotifications'

describe('useToastNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('adds toasts and auto-dismisses after timeout', () => {
    const { result } = renderHook(() => useToastNotifications({ autoDismissMs: 1000 }))

    act(() => {
      result.current.showToast('Connected', 'success')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Connected')
    expect(result.current.toasts[0].type).toBe('success')

    act(() => {
      vi.advanceTimersByTime(1001)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('dismisses toast immediately and clears pending timeout', () => {
    const { result } = renderHook(() => useToastNotifications({ autoDismissMs: 5000 }))

    act(() => {
      result.current.showToast('Dismiss me', 'info')
    })

    const id = result.current.toasts[0].id
    act(() => {
      result.current.dismissToast(id)
      vi.advanceTimersByTime(6000)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('clears all toasts and timers via clearToasts', () => {
    const { result } = renderHook(() => useToastNotifications({ autoDismissMs: 5000 }))

    act(() => {
      result.current.showToast('one', 'info')
      result.current.showToast('two', 'warning')
    })
    expect(result.current.toasts).toHaveLength(2)

    act(() => {
      result.current.clearToasts()
      vi.advanceTimersByTime(6000)
    })

    expect(result.current.toasts).toHaveLength(0)
  })
})
