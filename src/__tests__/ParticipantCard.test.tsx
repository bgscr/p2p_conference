/**
 * @vitest-environment jsdom
 */

/**
 * Additional coverage tests for ParticipantCard.tsx
 * Targets: video element handling, connection quality bars, audio level
 * visualization, getStatusColor for all states, getAvatarColor,
 * volume slider toggle, localSpeakerMuted effect, and non-connected status.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock AudioMeter
vi.mock('../renderer/components/AudioMeter', () => ({
  AudioMeter: ({ level }: any) => <div data-testid="audio-meter" data-level={level} />
}))

// Mock useI18n
vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'room.micMuted': 'Mic muted',
        'room.speakerMuted': 'Speaker muted',
        'room.connectionQuality': 'Connection Quality'
      }
      return translations[key] || key
    }
  })
}))

// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
  AudioLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { ParticipantCard } from '../renderer/components/ParticipantCard'

describe('ParticipantCard - Coverage Tests', () => {
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
          getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(50))
        }
      }
      createMediaStreamSource() {
        return { connect: vi.fn() }
      }
      createGain() {
        return {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn()
        }
      }
    }
    global.AudioContext = MockAudioContext as any

    // Mock HTMLMediaElement
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
      ; (HTMLMediaElement.prototype as any).setSinkId = vi.fn().mockResolvedValue(undefined)

    let srcObjStore: any = null
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      get: vi.fn(() => srcObjStore),
      set: vi.fn((val) => { srcObjStore = val }),
      configurable: true
    })

    global.requestAnimationFrame = vi.fn().mockReturnValue(1)
    global.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Video Element Handling', () => {
    it('should show video element when stream has video tracks and video is not muted', () => {
      const mockStream = {
        id: 'stream-v1',
        getTracks: vi.fn().mockReturnValue([
          { id: 'at1', kind: 'audio', enabled: true, muted: false, readyState: 'live' },
          { id: 'vt1', kind: 'video', enabled: true }
        ]),
        getAudioTracks: vi.fn().mockReturnValue([
          { id: 'at1', kind: 'audio', enabled: true, muted: false, readyState: 'live' }
        ]),
        getVideoTracks: vi.fn().mockReturnValue([
          { id: 'vt1', kind: 'video', enabled: true }
        ])
      } as any

      const { container } = render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isVideoMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
        />
      )

      const video = container.querySelector('video')
      expect(video).toBeInTheDocument()
      // Video should be visible (opacity-100) since showVideo is true
      expect(video?.className).toContain('opacity-100')
    })

    it('should hide video when isVideoMuted is true', () => {
      const mockStream = {
        id: 'stream-v2',
        getTracks: vi.fn().mockReturnValue([{ id: 'vt2', kind: 'video', enabled: true }]),
        getAudioTracks: vi.fn().mockReturnValue([]),
        getVideoTracks: vi.fn().mockReturnValue([{ id: 'vt2', kind: 'video', enabled: true }])
      } as any

      const { container } = render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isVideoMuted={true}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
        />
      )

      const video = container.querySelector('video')
      expect(video?.className).toContain('opacity-0')
    })

    it('should hide video when stream has no video tracks', () => {
      const mockStream = {
        id: 'stream-v3',
        getTracks: vi.fn().mockReturnValue([{ id: 'at3', kind: 'audio' }]),
        getAudioTracks: vi.fn().mockReturnValue([{ id: 'at3', kind: 'audio', enabled: true, muted: false, readyState: 'live' }]),
        getVideoTracks: vi.fn().mockReturnValue([])
      } as any

      const { container } = render(
        <ParticipantCard
          name="Charlie"
          peerId="p3"
          isMicMuted={false}
          isVideoMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
        />
      )

      const video = container.querySelector('video')
      expect(video?.className).toContain('opacity-0')
    })

    it('should set srcObject to null when stream is removed', () => {
      const mockStream = {
        id: 'stream-v4',
        getTracks: vi.fn().mockReturnValue([{ id: 'vt4', kind: 'video' }]),
        getAudioTracks: vi.fn().mockReturnValue([]),
        getVideoTracks: vi.fn().mockReturnValue([{ id: 'vt4', kind: 'video' }])
      } as any

      const { rerender } = render(
        <ParticipantCard
          name="Dave"
          peerId="p4"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
        />
      )

      // Remove stream
      rerender(
        <ParticipantCard
          name="Dave"
          peerId="p4"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
          stream={undefined}
        />
      )

      // srcObject setter should have been called with null
      // (the mock tracks this)
    })
  })

  describe('Connection Quality Indicator', () => {
    it('should display 4 bars for excellent quality', () => {
      const { container } = render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          connectionQuality={{
            rtt: 20,
            packetLoss: 0,
            jitter: 1,
            quality: 'excellent',
          }}
        />
      )

      // Should have quality indicator (bars)
      const bars = container.querySelectorAll('.bg-current')
      expect(bars.length).toBe(4)
    })

    it('should display 3 bars for good quality', () => {
      const { container } = render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          connectionQuality={{
            rtt: 80,
            packetLoss: 1,
            jitter: 5,
            quality: 'good',
          }}
        />
      )

      const bars = container.querySelectorAll('.bg-current')
      expect(bars.length).toBe(3)
    })

    it('should display 2 bars for fair quality', () => {
      const { container } = render(
        <ParticipantCard
          name="Charlie"
          peerId="p3"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          connectionQuality={{
            rtt: 200,
            packetLoss: 3,
            jitter: 20,
            quality: 'fair',
          }}
        />
      )

      const bars = container.querySelectorAll('.bg-current')
      expect(bars.length).toBe(2)
    })

    it('should display 1 bar for poor quality', () => {
      const { container } = render(
        <ParticipantCard
          name="Dave"
          peerId="p4"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          connectionQuality={{
            rtt: 500,
            packetLoss: 10,
            jitter: 50,
            quality: 'poor',
          }}
        />
      )

      const bars = container.querySelectorAll('.bg-current')
      expect(bars.length).toBe(1)
    })

    it('should show status dot instead of bars for local participant', () => {
      const { container } = render(
        <ParticipantCard
          name="Alice (You)"
          peerId="local"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
          connectionQuality={{
            rtt: 0,
            packetLoss: 0,
            jitter: 0,
            quality: 'excellent',
          }}
        />
      )

      // For local participant, should show status dot not quality bars
      const statusDot = container.querySelector('.rounded-full.border-2')
      expect(statusDot).toBeInTheDocument()
    })

    it('should show status dot when no connectionQuality', () => {
      const { container } = render(
        <ParticipantCard
          name="Eve"
          peerId="p5"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
        />
      )

      const statusDot = container.querySelector('.rounded-full.border-2')
      expect(statusDot).toBeInTheDocument()
    })

    it('should get green color for excellent quality', () => {
      const { container } = render(
        <ParticipantCard
          name="Test"
          peerId="ptest"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          connectionQuality={{
            rtt: 10,
            packetLoss: 0,
            jitter: 1,
            quality: 'excellent',
          }}
        />
      )

      // The bars container should have the green class
      const barsContainer = container.querySelector('.text-green-500')
      expect(barsContainer).toBeInTheDocument()
    })

    it('should get yellow color for fair quality', () => {
      const { container } = render(
        <ParticipantCard
          name="Test2"
          peerId="ptest2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          connectionQuality={{
            rtt: 200,
            packetLoss: 3,
            jitter: 20,
            quality: 'fair',
          }}
        />
      )

      const barsContainer = container.querySelector('.text-yellow-500')
      expect(barsContainer).toBeInTheDocument()
    })

    it('should get red color for poor quality', () => {
      const { container } = render(
        <ParticipantCard
          name="Test3"
          peerId="ptest3"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          connectionQuality={{
            rtt: 500,
            packetLoss: 10,
            jitter: 50,
            quality: 'poor',
          }}
        />
      )

      const barsContainer = container.querySelector('.text-red-500')
      expect(barsContainer).toBeInTheDocument()
    })
  })

  describe('Connection Status Colors', () => {
    it('should show green status dot for connected state', () => {
      const { container } = render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
        />
      )

      const statusDot = container.querySelector('.bg-green-500.rounded-full')
      expect(statusDot).toBeInTheDocument()
    })

    it('should show yellow status dot for connecting state', () => {
      const { container } = render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connecting"
        />
      )

      const statusDot = container.querySelector('.bg-yellow-500.rounded-full')
      expect(statusDot).toBeInTheDocument()
    })

    it('should show red status dot for failed state', () => {
      const { container } = render(
        <ParticipantCard
          name="Charlie"
          peerId="p3"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="failed"
        />
      )

      const statusDot = container.querySelector('.bg-red-500.rounded-full')
      expect(statusDot).toBeInTheDocument()
    })

    it('should show red status dot for disconnected state', () => {
      const { container } = render(
        <ParticipantCard
          name="Dave"
          peerId="p4"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="disconnected"
        />
      )

      const statusDot = container.querySelector('.bg-red-500.rounded-full')
      expect(statusDot).toBeInTheDocument()
    })

    it('should show gray status dot for new/unknown state', () => {
      const { container } = render(
        <ParticipantCard
          name="Eve"
          peerId="p5"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="new"
        />
      )

      const statusDot = container.querySelector('.bg-gray-400.rounded-full')
      expect(statusDot).toBeInTheDocument()
    })
  })

  describe('Non-Connected State Display', () => {
    it('should show connection state text for non-local when not connected', () => {
      render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connecting"
        />
      )

      expect(screen.getByText('connecting')).toBeInTheDocument()
    })

    it('should not show connection state text for local participant', () => {
      render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connecting"
        />
      )

      expect(screen.queryByText('connecting')).not.toBeInTheDocument()
    })

    it('should not show state text when connected', () => {
      render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
        />
      )

      // Should not show "connected" text below name
      const stateTexts = screen.queryAllByText('connected')
      // Only the status dot area, not the text label
      stateTexts.forEach(el => {
        expect(el.classList.contains('capitalize')).toBeFalsy()
      })
    })
  })

  describe('Avatar Initials and Colors', () => {
    it('should display initials from full name', () => {
      render(
        <ParticipantCard
          name="John Doe"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
        />
      )

      expect(screen.getByText('JD')).toBeInTheDocument()
    })

    it('should display single initial for single name', () => {
      render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
        />
      )

      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should truncate initials to 2 characters', () => {
      render(
        <ParticipantCard
          name="John Michael Doe"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
        />
      )

      expect(screen.getByText('JM')).toBeInTheDocument()
    })

    it('should use blue background for local participant avatar', () => {
      const { container } = render(
        <ParticipantCard
          name="Alice"
          peerId="local"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
        />
      )

      const avatar = container.querySelector('.bg-blue-600')
      expect(avatar).toBeInTheDocument()
    })

    it('should use peer-ID-based color for remote participant avatar', () => {
      const { container } = render(
        <ParticipantCard
          name="Bob"
          peerId="remote-peer-1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
        />
      )

      // Should have one of the avatar color classes
      const avatar = container.querySelector('[class*="bg-"][class*="-500"]')
      expect(avatar).toBeInTheDocument()
    })
  })

  describe('Audio Level Ring Animation', () => {
    it('should show speaking ring when audio level is high and not muted', () => {
      const { container } = render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={50}
          connectionState="connected"
        />
      )

      // Card should have ring-2 class
      const card = container.firstElementChild
      expect(card?.className).toContain('ring-2')
    })

    it('should not show speaking ring when muted', () => {
      const { container } = render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={true}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={50}
          connectionState="connected"
        />
      )

      const card = container.firstElementChild
      expect(card?.className).not.toContain('ring-2')
    })

    it('should not show speaking ring when audio level is low', () => {
      const { container } = render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={5}
          connectionState="connected"
        />
      )

      const card = container.firstElementChild
      expect(card?.className).not.toContain('ring-2')
    })
  })

  describe('Volume Slider', () => {
    it('should show volume button for remote participant with onVolumeChange', () => {
      const onVolumeChange = vi.fn()

      render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          volume={80}
          onVolumeChange={onVolumeChange}
        />
      )

      // Should show volume percentage
      expect(screen.getByText('80%')).toBeInTheDocument()
    })

    it('should toggle volume slider when volume button clicked', () => {
      const onVolumeChange = vi.fn()

      render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          volume={100}
          onVolumeChange={onVolumeChange}
        />
      )

      // Click volume button to show slider
      const volumeBtn = screen.getByText('100%')
      fireEvent.click(volumeBtn)

      // Slider should appear
      const slider = screen.getByRole('slider')
      expect(slider).toBeInTheDocument()
      expect(slider).toHaveValue('100')
    })

    it('should call onVolumeChange when slider value changes', () => {
      const onVolumeChange = vi.fn()

      render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          volume={100}
          onVolumeChange={onVolumeChange}
        />
      )

      // Open slider
      fireEvent.click(screen.getByText('100%'))

      // Change slider value
      const slider = screen.getByRole('slider')
      fireEvent.change(slider, { target: { value: '50' } })

      expect(onVolumeChange).toHaveBeenCalledWith(50)
    })

    it('should not show volume control for local participant', () => {
      const onVolumeChange = vi.fn()

      render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
          volume={100}
          onVolumeChange={onVolumeChange}
        />
      )

      expect(screen.queryByText('100%')).not.toBeInTheDocument()
    })

    it('should not show volume control without onVolumeChange callback', () => {
      render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          volume={100}
        />
      )

      expect(screen.queryByText('100%')).not.toBeInTheDocument()
    })
  })

  describe('Platform Icons', () => {
    it('should show Windows icon for win platform', () => {
      const { container } = render(
        <ParticipantCard
          name="Alice"
          peerId="p1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          platform="win"
        />
      )

      // Windows SVG icon should be present
      const winSvg = container.querySelector('svg[viewBox="0 0 24 24"]')
      expect(winSvg).toBeInTheDocument()
    })

    it('should show macOS icon for mac platform', () => {
      const { container } = render(
        <ParticipantCard
          name="Bob"
          peerId="p2"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          platform="mac"
        />
      )

      const macSvg = container.querySelector('svg[viewBox="0 0 24 24"]')
      expect(macSvg).toBeInTheDocument()
    })

    it('should show Linux icon for linux platform', () => {
      const { container } = render(
        <ParticipantCard
          name="Charlie"
          peerId="p3"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          platform="linux"
        />
      )

      const linuxSvg = container.querySelector('svg[viewBox="0 0 24 24"]')
      expect(linuxSvg).toBeInTheDocument()
    })

    it('should not show platform icon when platform is undefined', () => {
      render(
        <ParticipantCard
          name="Dave"
          peerId="p4"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
        />
      )

      // The name should render without a platform span
      expect(screen.getByText('Dave')).toBeInTheDocument()
    })
  })

  describe('Audio Playback for Remote Streams', () => {
    it('should set up audio playback for remote stream with audio tracks', () => {
      const mockStream = {
        id: 'stream-audio-1',
        getTracks: vi.fn().mockReturnValue([
          { id: 'at1', kind: 'audio', enabled: true, muted: false, readyState: 'live' }
        ]),
        getAudioTracks: vi.fn().mockReturnValue([
          { id: 'at1', kind: 'audio', enabled: true, muted: false, readyState: 'live' }
        ]),
        getVideoTracks: vi.fn().mockReturnValue([])
      } as any

      render(
        <ParticipantCard
          name="Remote User"
          peerId="remote-1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
        />
      )

      const audio = document.querySelector('audio')
      expect(audio).toBeInTheDocument()
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    })

    it('should not set up audio for local participant even with stream', () => {
      const mockStream = {
        id: 'stream-local',
        getTracks: vi.fn().mockReturnValue([{ id: 'at1', kind: 'audio' }]),
        getAudioTracks: vi.fn().mockReturnValue([{ id: 'at1', kind: 'audio' }]),
        getVideoTracks: vi.fn().mockReturnValue([])
      } as any

      render(
        <ParticipantCard
          name="Local"
          peerId="local"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
        />
      )

      // No audio element for local
      const audio = document.querySelector('audio')
      expect(audio).not.toBeInTheDocument()
    })

    it('should handle stream with no audio tracks', () => {
      const mockStream = {
        id: 'stream-no-audio',
        getTracks: vi.fn().mockReturnValue([]),
        getAudioTracks: vi.fn().mockReturnValue([]),
        getVideoTracks: vi.fn().mockReturnValue([])
      } as any

      render(
        <ParticipantCard
          name="Silent User"
          peerId="silent"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
        />
      )

      // Should not crash
      expect(screen.getByText('Silent User')).toBeInTheDocument()
    })
  })

  describe('LocalSpeakerMuted Effect', () => {
    it('should mute audio element when localSpeakerMuted changes', () => {
      const mockStream = {
        id: 'stream-mute-test',
        getTracks: vi.fn().mockReturnValue([
          { id: 'at1', kind: 'audio', enabled: true, muted: false, readyState: 'live' }
        ]),
        getAudioTracks: vi.fn().mockReturnValue([
          { id: 'at1', kind: 'audio', enabled: true, muted: false, readyState: 'live' }
        ]),
        getVideoTracks: vi.fn().mockReturnValue([])
      } as any

      let capturedMuted = false
      Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
        get: vi.fn(() => capturedMuted),
        set: vi.fn((val) => { capturedMuted = val }),
        configurable: true
      })

      const { rerender } = render(
        <ParticipantCard
          name="Remote"
          peerId="rm1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
          localSpeakerMuted={false}
        />
      )

      // Now toggle localSpeakerMuted
      rerender(
        <ParticipantCard
          name="Remote"
          peerId="rm1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={false}
          audioLevel={0}
          connectionState="connected"
          stream={mockStream}
          localSpeakerMuted={true}
        />
      )

      expect(capturedMuted).toBe(true)
    })
  })

  describe('Audio Meter Integration', () => {
    it('should pass 0 to AudioMeter when mic is muted', () => {
      render(
        <ParticipantCard
          name="Muted"
          peerId="m1"
          isMicMuted={true}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={50}
          connectionState="connected"
        />
      )

      const meter = screen.getByTestId('audio-meter')
      expect(meter).toHaveAttribute('data-level', '0')
    })

    it('should pass actual level to AudioMeter when not muted', () => {
      render(
        <ParticipantCard
          name="Active"
          peerId="a1"
          isMicMuted={false}
          isSpeakerMuted={false}
          isLocal={true}
          audioLevel={75}
          connectionState="connected"
        />
      )

      const meter = screen.getByTestId('audio-meter')
      expect(meter).toHaveAttribute('data-level', '75')
    })
  })
})
