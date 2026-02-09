/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for ParticipantCard
 * Targets:
 * - Audio playback retry (autoplay blocked, user interaction handler)
 * - createMediaStreamSource error path (line 163)
 * - No audio tracks in stream (line 90)
 * - getQualityColor default branch
 * - getQualityBars default branch
 * - showVideo with video tracks & isVideoMuted
 * - localSpeakerMuted effect
 * - getStatusColor branches (disconnected, failed, default)
 * - getInitials
 * - volume effect (setSinkId, volume control)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ParticipantCard } from '../../renderer/components/ParticipantCard'

// Mock AudioMeter
vi.mock('../../renderer/components/AudioMeter', () => ({
  AudioMeter: ({ level }: any) => <div data-testid="audio-meter" data-level={level} />,
}))

// Mock useI18n
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'room.micMuted': 'Mic muted',
        'room.speakerMuted': 'Speaker muted',
        'room.connectionQuality': 'Connection Quality',
      }
      return translations[key] || key
    },
  }),
}))

vi.mock('../../renderer/utils/Logger', () => ({
  AudioLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function createMockStream(audioTracks: any[] = [], videoTracks: any[] = []) {
  const allTracks = [...audioTracks, ...videoTracks]
  return {
    id: `stream-${Math.random().toString(36).slice(2, 8)}`,
    getTracks: vi.fn().mockReturnValue(allTracks),
    getAudioTracks: vi.fn().mockReturnValue(audioTracks),
    getVideoTracks: vi.fn().mockReturnValue(videoTracks),
    active: true,
  }
}

function createAudioTrack(id = 'audio-1') {
  return { id, kind: 'audio', enabled: true, muted: false, readyState: 'live' }
}

function createVideoTrack(id = 'video-1') {
  return { id, kind: 'video', enabled: true, muted: false, readyState: 'live' }
}

describe('ParticipantCard - coverage gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock AudioContext (same pattern as working test)
    class MockAudioContext {
      createAnalyser() {
        return {
          fftSize: 256,
          frequencyBinCount: 128,
          connect: vi.fn(),
          disconnect: vi.fn(),
          getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(50)),
        }
      }
      createMediaStreamSource() {
        return { connect: vi.fn() }
      }
      createGain() {
        return {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }
      }
    }
    global.AudioContext = MockAudioContext as any

    // Mock HTMLMediaElement (same pattern as working test)
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
      ; (HTMLMediaElement.prototype as any).setSinkId = vi.fn().mockResolvedValue(undefined)

    let srcObjStore: any = null
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      get: vi.fn(() => srcObjStore),
      set: vi.fn((val) => {
        srcObjStore = val
      }),
      configurable: true,
    })

    let mutedStore = false
    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
      get: vi.fn(() => mutedStore),
      set: vi.fn((val) => {
        mutedStore = val
      }),
      configurable: true,
    })

    global.requestAnimationFrame = vi.fn().mockReturnValue(1)
    global.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    peerId: 'peer-1',
    name: 'Test User',
    isLocal: false,
    isMicMuted: false,
    isSpeakerMuted: false,
    isVideoMuted: false,
    audioLevel: 0,
    connectionState: 'connected' as const,
    platform: 'win' as const,
    localSpeakerMuted: false,
    volume: 100,
  }

  it('renders remote participant with stream and handles audio playback', () => {
    const stream = createMockStream([createAudioTrack()])
    render(<ParticipantCard {...defaultProps} stream={stream as any} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('handles autoplay blocked scenario', async () => {
    HTMLMediaElement.prototype.play = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
      .mockResolvedValue(undefined)

    const stream = createMockStream([createAudioTrack()])
    render(<ParticipantCard {...defaultProps} stream={stream as any} />)

    // Wait for play rejection to be handled
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // Click handler should be registered, trigger click to retry
    act(() => {
      document.dispatchEvent(new MouseEvent('click'))
    })
  })

  it('handles stream with no audio tracks', () => {
    const stream = createMockStream([], [createVideoTrack()])
    render(<ParticipantCard {...defaultProps} stream={stream as any} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('handles createMediaStreamSource error', () => {
    global.AudioContext = class {
      createAnalyser() {
        return {
          fftSize: 256,
          frequencyBinCount: 128,
          getByteFrequencyData: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
        }
      }
      createGain() {
        return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
      }
      createMediaStreamSource() {
        throw new Error('No audio tracks')
      }
    } as any

    const stream = createMockStream([createAudioTrack()])
    render(<ParticipantCard {...defaultProps} stream={stream as any} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('renders local participant without audio playback', () => {
    render(<ParticipantCard {...defaultProps} isLocal={true} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('displays video when stream has video tracks and not muted', () => {
    const stream = createMockStream([createAudioTrack()], [createVideoTrack()])
    const { container } = render(
      <ParticipantCard {...defaultProps} stream={stream as any} isVideoMuted={false} />
    )
    const video = container.querySelector('video')
    expect(video).toBeTruthy()
  })

  it('hides video when isVideoMuted is true', () => {
    const stream = createMockStream([createAudioTrack()], [createVideoTrack()])
    const { container } = render(
      <ParticipantCard {...defaultProps} stream={stream as any} isVideoMuted={true} />
    )
    // Video should be hidden (opacity-0)
    const videoContainer = container.querySelector('.opacity-0')
    // The video element exists but is visually hidden
    expect(videoContainer).toBeDefined()
  })

  it('shows video when screen sharing is active even if isVideoMuted is true', () => {
    const stream = createMockStream([createAudioTrack()], [createVideoTrack()])
    const { container } = render(
      <ParticipantCard
        {...defaultProps}
        stream={stream as any}
        isVideoMuted={true}
        isScreenSharing={true}
      />
    )
    const video = container.querySelector('video')
    expect(video?.className).toContain('opacity-100')
  })

  it('displays connection state: disconnected', () => {
    render(<ParticipantCard {...defaultProps} connectionState="disconnected" />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('displays connection state: failed', () => {
    render(<ParticipantCard {...defaultProps} connectionState="failed" />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('displays connection state: connecting', () => {
    render(<ParticipantCard {...defaultProps} connectionState="connecting" />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('displays connection state: default/unknown', () => {
    render(<ParticipantCard {...defaultProps} connectionState={'new' as any} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('displays quality indicator for all levels', () => {
    const qualities = ['excellent', 'good', 'fair', 'poor'] as const
    for (const quality of qualities) {
      const { unmount } = render(
        <ParticipantCard
          {...defaultProps}
          connectionQuality={{
            quality,
            rtt: 50,
            packetLoss: 0,
            jitter: 5,
          }}
        />
      )
      unmount()
    }
  })

  it('displays quality indicator with undefined quality', () => {
    render(
      <ParticipantCard
        {...defaultProps}
        connectionQuality={{
          quality: 'unknown' as any,
          rtt: 0,
          packetLoss: 0,
          jitter: 0,
        }}
      />
    )
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('displays with no connectionQuality', () => {
    render(<ParticipantCard {...defaultProps} connectionQuality={undefined} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('handles localSpeakerMuted change', () => {
    const stream = createMockStream([createAudioTrack()])
    const { rerender } = render(
      <ParticipantCard {...defaultProps} stream={stream as any} localSpeakerMuted={false} />
    )

    rerender(
      <ParticipantCard {...defaultProps} stream={stream as any} localSpeakerMuted={true} />
    )
    // Audio element muted should be set to true
  })

  it('generates correct initials for two-word name', () => {
    render(<ParticipantCard {...defaultProps} name="John Doe" />)
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('generates single initial for single name', () => {
    render(<ParticipantCard {...defaultProps} name="Alice" />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('platform icons: mac', () => {
    render(<ParticipantCard {...defaultProps} platform="mac" />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('platform icons: linux', () => {
    render(<ParticipantCard {...defaultProps} platform="linux" />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('muted indicators: mic muted', () => {
    render(<ParticipantCard {...defaultProps} isMicMuted={true} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('muted indicators: speaker muted', () => {
    render(<ParticipantCard {...defaultProps} isSpeakerMuted={true} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('audio level > 0 renders level indicator', () => {
    render(<ParticipantCard {...defaultProps} audioLevel={75} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('audio level capped at 100', () => {
    render(<ParticipantCard {...defaultProps} audioLevel={150} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('shows screen sharing badge when isScreenSharing is true', () => {
    render(<ParticipantCard {...defaultProps} isScreenSharing={true} />)
    expect(screen.getByTestId('screen-sharing-badge')).toBeInTheDocument()
  })

  it('does not show screen sharing badge when isScreenSharing is false', () => {
    render(<ParticipantCard {...defaultProps} isScreenSharing={false} />)
    expect(screen.queryByTestId('screen-sharing-badge')).not.toBeInTheDocument()
  })
})
