/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ExpandedParticipantView } from '../../renderer/components/ExpandedParticipantView'
import type { Peer } from '../../types'

// Mock useI18n
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

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

describe('ExpandedParticipantView', () => {
  let onCollapse: () => void
  let onEnterFullscreen: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    onCollapse = vi.fn()
    onEnterFullscreen = vi.fn()

    // Mock srcObject
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      get: vi.fn(),
      set: vi.fn(),
      configurable: true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders expanded view container', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.getByTestId('expanded-view')).toBeInTheDocument()
  })

  it('displays participant name', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer({ name: 'Alice' })}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('displays screen sharing badge when peer is screen sharing', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer({ isScreenSharing: true })}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.getByText('room.screenSharing')).toBeInTheDocument()
  })

  it('does not display screen sharing badge when not screen sharing', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer({ isScreenSharing: false })}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.queryByText('room.screenSharing')).not.toBeInTheDocument()
  })

  it('renders video element', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.getByTestId('expanded-video')).toBeInTheDocument()
  })

  it('sets video srcObject when stream is provided', () => {
    const mockStream = new MediaStream()
    const srcObjectSetter = vi.fn()
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      get: () => null,
      set: srcObjectSetter,
      configurable: true
    })

    render(
      <ExpandedParticipantView
        peer={makePeer()}
        stream={mockStream}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(srcObjectSetter).toHaveBeenCalledWith(mockStream)
  })

  it('renders collapse button', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.getByTestId('collapse-btn')).toBeInTheDocument()
  })

  it('collapse button calls onCollapse', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    fireEvent.click(screen.getByTestId('collapse-btn'))
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('renders fullscreen button', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.getByTestId('fullscreen-btn')).toBeInTheDocument()
  })

  it('fullscreen button calls onEnterFullscreen when not fullscreen', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    fireEvent.click(screen.getByTestId('fullscreen-btn'))
    expect(onEnterFullscreen).toHaveBeenCalledTimes(1)
  })

  it('fullscreen button calls onCollapse when already fullscreen', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={true}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    fireEvent.click(screen.getByTestId('fullscreen-btn'))
    expect(onCollapse).toHaveBeenCalledTimes(1)
    expect(onEnterFullscreen).not.toHaveBeenCalled()
  })

  it('fullscreen button title changes based on fullscreen state', () => {
    const { rerender } = render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.getByTestId('fullscreen-btn')).toHaveAttribute('title', 'room.enterFullscreen')

    rerender(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={true}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(screen.getByTestId('fullscreen-btn')).toHaveAttribute('title', 'room.exitFullscreen')
  })

  it('uses object-contain for screen sharing video', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer({ isScreenSharing: true })}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    const video = screen.getByTestId('expanded-video')
    expect(video.className).toContain('object-contain')
    expect(video.className).not.toContain('object-cover')
  })

  it('uses object-cover for camera video', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer({ isScreenSharing: false })}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    const video = screen.getByTestId('expanded-video')
    expect(video.className).toContain('object-cover')
    expect(video.className).not.toContain('object-contain')
  })

  it('toolbar auto-hides after 3 seconds', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    const toolbar = screen.getByTestId('expanded-toolbar')
    expect(toolbar.className).toContain('opacity-100')

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(toolbar.className).toContain('opacity-0')
  })

  it('toolbar reappears on mouse move', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )

    // Wait for auto-hide
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    const toolbar = screen.getByTestId('expanded-toolbar')
    expect(toolbar.className).toContain('opacity-0')

    // Move mouse
    fireEvent.mouseMove(screen.getByTestId('expanded-view'))

    expect(toolbar.className).toContain('opacity-100')
  })

  it('displays connection quality when provided', () => {
    render(
      <ExpandedParticipantView
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
        connectionQuality={{
          peerId: 'peer-1',
          rtt: 42,
          packetLoss: 0.1,
          jitter: 5,
          bytesReceived: 0,
          bytesSent: 0,
          quality: 'good',
          connectionState: 'connected'
        }}
      />
    )
    expect(screen.getByText(/good/)).toBeInTheDocument()
    expect(screen.getByText(/42ms/)).toBeInTheDocument()
  })

  it('accepts ref via forwardRef', () => {
    const ref = { current: null as HTMLDivElement | null }
    render(
      <ExpandedParticipantView
        ref={ref}
        peer={makePeer()}
        isFullscreen={false}
        onCollapse={onCollapse}
        onEnterFullscreen={onEnterFullscreen}
      />
    )
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })
})
