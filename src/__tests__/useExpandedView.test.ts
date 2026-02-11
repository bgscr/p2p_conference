/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useExpandedView } from '../renderer/hooks/useExpandedView'
import type { Peer } from '../types'

function makePeer(overrides: Partial<Peer> = {}): Peer {
  return {
    id: 'peer-1',
    name: 'Alice',
    isMuted: false,
    isVideoMuted: false,
    isSpeakerMuted: false,
    isScreenSharing: false,
    audioLevel: 0,
    connectionState: 'connected',
    ...overrides
  }
}

describe('useExpandedView', () => {
  let peers: Map<string, Peer>

  beforeEach(() => {
    vi.clearAllMocks()
    peers = new Map()
    peers.set('peer-1', makePeer({ id: 'peer-1', name: 'Alice', isScreenSharing: true }))
    peers.set('peer-2', makePeer({ id: 'peer-2', name: 'Bob', isVideoMuted: false }))

    // Mock fullscreen API
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with no expanded peer and not fullscreen', () => {
    const { result } = renderHook(() => useExpandedView(peers))
    expect(result.current.expandedPeerId).toBeNull()
    expect(result.current.isFullscreen).toBe(false)
  })

  it('expandPeer sets the expanded peer id', () => {
    const { result } = renderHook(() => useExpandedView(peers))
    act(() => {
      result.current.expandPeer('peer-1')
    })
    expect(result.current.expandedPeerId).toBe('peer-1')
    expect(result.current.isFullscreen).toBe(false)
  })

  it('collapse resets expanded state', () => {
    const { result } = renderHook(() => useExpandedView(peers))
    act(() => {
      result.current.expandPeer('peer-1')
    })
    expect(result.current.expandedPeerId).toBe('peer-1')

    act(() => {
      result.current.collapse()
    })
    expect(result.current.expandedPeerId).toBeNull()
    expect(result.current.isFullscreen).toBe(false)
  })

  it('collapse calls document.exitFullscreen when in fullscreen', () => {
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.createElement('div'),
      writable: true,
      configurable: true
    })

    const { result } = renderHook(() => useExpandedView(peers))
    act(() => {
      result.current.expandPeer('peer-1')
    })
    act(() => {
      result.current.collapse()
    })
    expect(document.exitFullscreen).toHaveBeenCalled()
  })

  it('enterFullscreen calls element.requestFullscreen', async () => {
    const element = document.createElement('div')
    element.requestFullscreen = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useExpandedView(peers))
    act(() => {
      result.current.expandPeer('peer-1')
    })

    await act(async () => {
      result.current.enterFullscreen(element)
      // Allow promise to resolve
      await Promise.resolve()
    })

    expect(element.requestFullscreen).toHaveBeenCalled()
    expect(result.current.isFullscreen).toBe(true)
  })

  it('enterFullscreen stays in expanded mode if requestFullscreen rejects', async () => {
    const element = document.createElement('div')
    element.requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'))

    const { result } = renderHook(() => useExpandedView(peers))
    act(() => {
      result.current.expandPeer('peer-1')
    })

    await act(async () => {
      result.current.enterFullscreen(element)
      await Promise.resolve()
    })

    expect(result.current.expandedPeerId).toBe('peer-1')
    expect(result.current.isFullscreen).toBe(false)
  })

  it('auto-exits when expanded peer disconnects', () => {
    const { result, rerender } = renderHook(
      ({ p }) => useExpandedView(p),
      { initialProps: { p: peers } }
    )

    act(() => {
      result.current.expandPeer('peer-1')
    })
    expect(result.current.expandedPeerId).toBe('peer-1')

    // Remove the peer
    const updatedPeers = new Map(peers)
    updatedPeers.delete('peer-1')

    rerender({ p: updatedPeers })
    expect(result.current.expandedPeerId).toBeNull()
  })

  it('auto-exits when expanded peer stops screen sharing and video is muted', () => {
    const { result, rerender } = renderHook(
      ({ p }) => useExpandedView(p),
      { initialProps: { p: peers } }
    )

    act(() => {
      result.current.expandPeer('peer-1')
    })
    expect(result.current.expandedPeerId).toBe('peer-1')

    // Update peer: stop screen sharing and mute video
    const updatedPeers = new Map(peers)
    updatedPeers.set('peer-1', makePeer({
      id: 'peer-1',
      name: 'Alice',
      isScreenSharing: false,
      isVideoMuted: true
    }))

    rerender({ p: updatedPeers })
    expect(result.current.expandedPeerId).toBeNull()
  })

  it('does NOT auto-exit when peer stops screen sharing but video is still active', () => {
    const { result, rerender } = renderHook(
      ({ p }) => useExpandedView(p),
      { initialProps: { p: peers } }
    )

    act(() => {
      result.current.expandPeer('peer-1')
    })

    // Stop screen sharing but keep video on
    const updatedPeers = new Map(peers)
    updatedPeers.set('peer-1', makePeer({
      id: 'peer-1',
      name: 'Alice',
      isScreenSharing: false,
      isVideoMuted: false
    }))

    rerender({ p: updatedPeers })
    expect(result.current.expandedPeerId).toBe('peer-1')
  })

  it('ESC key collapses when expanded (non-fullscreen)', () => {
    const { result } = renderHook(() => useExpandedView(peers))

    act(() => {
      result.current.expandPeer('peer-1')
    })
    expect(result.current.expandedPeerId).toBe('peer-1')

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      const stopPropSpy = vi.spyOn(event, 'stopPropagation')
      window.dispatchEvent(event)
      expect(stopPropSpy).toHaveBeenCalled()
    })
    expect(result.current.expandedPeerId).toBeNull()
  })

  it('ESC key does nothing when not expanded', () => {
    const { result } = renderHook(() => useExpandedView(peers))
    expect(result.current.expandedPeerId).toBeNull()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(result.current.expandedPeerId).toBeNull()
  })

  it('fullscreenchange event syncs isFullscreen to false when exiting fullscreen', async () => {
    const element = document.createElement('div')
    element.requestFullscreen = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useExpandedView(peers))

    act(() => {
      result.current.expandPeer('peer-1')
    })

    await act(async () => {
      result.current.enterFullscreen(element)
      await Promise.resolve()
    })
    expect(result.current.isFullscreen).toBe(true)

    // Simulate fullscreen exit
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true
    })

    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current.isFullscreen).toBe(false)
  })

  it('expandPeer resets fullscreen state', async () => {
    const element = document.createElement('div')
    element.requestFullscreen = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useExpandedView(peers))

    act(() => {
      result.current.expandPeer('peer-1')
    })

    await act(async () => {
      result.current.enterFullscreen(element)
      await Promise.resolve()
    })
    expect(result.current.isFullscreen).toBe(true)

    // Expanding a different peer resets fullscreen
    act(() => {
      result.current.expandPeer('peer-2')
    })
    expect(result.current.expandedPeerId).toBe('peer-2')
    expect(result.current.isFullscreen).toBe(false)
  })
})
