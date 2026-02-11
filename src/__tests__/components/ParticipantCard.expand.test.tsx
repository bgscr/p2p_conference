/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ParticipantCard } from '../../renderer/components/ParticipantCard'

// Mock AudioMeter since it uses Canvas
vi.mock('../../renderer/components/AudioMeter', () => ({
  AudioMeter: () => <div data-testid="audio-meter" />
}))

// Mock useI18n
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

// Mock Logger
vi.mock('../../renderer/utils/Logger', () => ({
  AudioLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('ParticipantCard - Expand button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock AudioContext
    class MockAudioContext {
      createAnalyser() {
        return {
          fftSize: 256,
          frequencyBinCount: 128,
          connect: vi.fn(),
          disconnect: vi.fn(),
          getByteFrequencyData: vi.fn()
        }
      }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() }
      }
      createGain() {
        return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
      }
      close = vi.fn()
    }
    global.AudioContext = MockAudioContext as any

    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    ;(HTMLMediaElement.prototype as any).setSinkId = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      get: vi.fn(),
      set: vi.fn(),
      configurable: true
    })

    global.requestAnimationFrame = vi.fn()
    global.cancelAnimationFrame = vi.fn()
  })

  const baseProps = {
    name: 'Alice',
    peerId: 'peer-1',
    isMicMuted: false,
    isSpeakerMuted: false,
    isLocal: false,
    audioLevel: 0,
    connectionState: 'connected' as const
  }

  function createStreamWithVideoTrack(): MediaStream {
    const stream = new MediaStream()
    // Add a mock video track
    Object.defineProperty(stream, 'getVideoTracks', {
      value: () => [{ kind: 'video', enabled: true, readyState: 'live', stop: vi.fn() }]
    })
    Object.defineProperty(stream, 'getAudioTracks', {
      value: () => [{ kind: 'audio', enabled: true, readyState: 'live', muted: false, stop: vi.fn() }]
    })
    Object.defineProperty(stream, 'getTracks', {
      value: () => [
        { kind: 'video', enabled: true, readyState: 'live', stop: vi.fn() },
        { kind: 'audio', enabled: true, readyState: 'live', muted: false, stop: vi.fn() }
      ]
    })
    return stream
  }

  it('shows expand button for remote participant with active video and onExpand callback', () => {
    const onExpand = vi.fn()
    render(
      <ParticipantCard
        {...baseProps}
        isLocal={false}
        isScreenSharing={true}
        stream={createStreamWithVideoTrack()}
        onExpand={onExpand}
      />
    )
    expect(screen.getByTestId('expand-view-btn')).toBeInTheDocument()
  })

  it('hides expand button for local participant', () => {
    const onExpand = vi.fn()
    render(
      <ParticipantCard
        {...baseProps}
        isLocal={true}
        isScreenSharing={true}
        stream={createStreamWithVideoTrack()}
        onExpand={onExpand}
      />
    )
    expect(screen.queryByTestId('expand-view-btn')).not.toBeInTheDocument()
  })

  it('hides expand button when no stream / no video tracks', () => {
    const onExpand = vi.fn()
    render(
      <ParticipantCard
        {...baseProps}
        isLocal={false}
        onExpand={onExpand}
      />
    )
    expect(screen.queryByTestId('expand-view-btn')).not.toBeInTheDocument()
  })

  it('hides expand button when video is muted and not screen sharing', () => {
    const onExpand = vi.fn()
    const stream = createStreamWithVideoTrack()
    render(
      <ParticipantCard
        {...baseProps}
        isLocal={false}
        isVideoMuted={true}
        isScreenSharing={false}
        stream={stream}
        onExpand={onExpand}
      />
    )
    // showVideo = hasVideoTrack && (isScreenSharing || !isVideoMuted)
    // hasVideoTrack = true, isScreenSharing = false, isVideoMuted = true
    // showVideo = true && (false || false) = false
    expect(screen.queryByTestId('expand-view-btn')).not.toBeInTheDocument()
  })

  it('shows expand button when screen sharing even if video is muted', () => {
    const onExpand = vi.fn()
    render(
      <ParticipantCard
        {...baseProps}
        isLocal={false}
        isVideoMuted={true}
        isScreenSharing={true}
        stream={createStreamWithVideoTrack()}
        onExpand={onExpand}
      />
    )
    expect(screen.getByTestId('expand-view-btn')).toBeInTheDocument()
  })

  it('hides expand button when no onExpand callback provided', () => {
    render(
      <ParticipantCard
        {...baseProps}
        isLocal={false}
        isScreenSharing={true}
        stream={createStreamWithVideoTrack()}
      />
    )
    expect(screen.queryByTestId('expand-view-btn')).not.toBeInTheDocument()
  })

  it('calls onExpand when expand button is clicked', () => {
    const onExpand = vi.fn()
    render(
      <ParticipantCard
        {...baseProps}
        isLocal={false}
        isScreenSharing={true}
        stream={createStreamWithVideoTrack()}
        onExpand={onExpand}
      />
    )
    fireEvent.click(screen.getByTestId('expand-view-btn'))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('expand button has correct title', () => {
    const onExpand = vi.fn()
    render(
      <ParticipantCard
        {...baseProps}
        isLocal={false}
        isScreenSharing={true}
        stream={createStreamWithVideoTrack()}
        onExpand={onExpand}
      />
    )
    expect(screen.getByTestId('expand-view-btn')).toHaveAttribute('title', 'room.expandView')
  })
})
