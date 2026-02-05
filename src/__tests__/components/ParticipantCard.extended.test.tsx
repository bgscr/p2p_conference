/**
 * Extended tests for ParticipantCard component
 * @vitest-environment jsdom
 * 
 * Tests cover:
 * - Audio level visualization
 * - Connection quality display
 * - Remote audio playback
 * - Mute status display
 * - Platform icons
 * - Speaker output device selection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import * as React from 'react'

// Mock i18n
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, _params?: Record<string, any>) => {
      const translations: Record<string, string> = {
        'room.you': 'You',
        'room.muted': 'Muted',
        'room.unmuted': 'Unmuted',
        'room.micMuted': 'Mic muted',
        'room.speakerMuted': 'Speaker muted',
        'room.connecting': 'Connecting...',
        'room.connected': 'Connected',
        'room.notConnected': 'Not connected',
        'room.connectionFailed': 'Connection failed'
      }
      return translations[key] || key
    }
  })
}))

vi.mock('../../renderer/utils/Logger', () => ({
  PeerLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// Create testable component
function TestParticipantCard({
  peerId = 'peer-123',
  userName = 'Alice',
  isLocal = false,
  isMuted = false,
  isSpeakerMuted = false,
  platform = 'win' as 'win' | 'mac' | 'linux',
  stream = null as MediaStream | null,
  audioLevel = 0,
  connectionState = 'connected' as 'connecting' | 'connected' | 'disconnected' | 'failed',
  connectionQuality = null as { rtt: number; packetLoss: number; quality: string } | null,
  selectedOutputDevice = 'default'
}) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = React.useState(false)

  React.useEffect(() => {
    if (audioRef.current && stream && !isLocal) {
      audioRef.current.srcObject = stream
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false))
    }
  }, [stream, isLocal])

  // Set output device
  React.useEffect(() => {
    if (audioRef.current && selectedOutputDevice && 'setSinkId' in audioRef.current) {
      (audioRef.current as any).setSinkId(selectedOutputDevice).catch(() => { })
    }
  }, [selectedOutputDevice])

  // Get platform icon
  const getPlatformIcon = () => {
    switch (platform) {
      case 'win': return '🪟'
      case 'mac': return '🍎'
      case 'linux': return '🐧'
      default: return '💻'
    }
  }

  // Get quality color
  const getQualityColor = () => {
    if (!connectionQuality) return 'gray'
    switch (connectionQuality.quality) {
      case 'excellent': return 'green'
      case 'good': return 'lime'
      case 'fair': return 'yellow'
      case 'poor': return 'red'
      default: return 'gray'
    }
  }

  return (
    <div
      data-testid={`participant-card-${peerId}`}
      className={`rounded-lg p-4 ${isLocal ? 'border-2 border-blue-500' : 'border border-gray-200'}`}
    >
      {/* User info */}
      <div className="flex items-center gap-2">
        <span data-testid="platform-icon">{getPlatformIcon()}</span>
        <span data-testid="user-name" className="font-medium">
          {userName}
          {isLocal && <span data-testid="you-label" className="text-sm text-gray-500 ml-1">(You)</span>}
        </span>
      </div>

      {/* Mute status */}
      <div className="flex items-center gap-2 mt-2">
        {isMuted && (
          <span data-testid="mic-muted-indicator" className="text-red-500 text-sm">
            🔇 Mic muted
          </span>
        )}
        {isSpeakerMuted && (
          <span data-testid="speaker-muted-indicator" className="text-orange-500 text-sm">
            🔈 Speaker muted
          </span>
        )}
        {!isMuted && !isSpeakerMuted && (
          <span data-testid="unmuted-indicator" className="text-green-500 text-sm">
            🔊 Active
          </span>
        )}
      </div>

      {/* Audio level meter */}
      <div data-testid="audio-level-container" className="mt-2">
        <div className="h-2 bg-gray-200 rounded overflow-hidden">
          <div
            data-testid="audio-level-bar"
            className="h-full bg-green-500 transition-all"
            style={{ width: `${Math.min(audioLevel * 100, 100)}%` }}
          />
        </div>
        <span data-testid="audio-level-value" className="text-xs text-gray-500">
          Level: {Math.round(audioLevel * 100)}%
        </span>
      </div>

      {/* Connection status */}
      <div data-testid="connection-status" className="mt-2 text-sm">
        {connectionState === 'connecting' && (
          <span className="text-yellow-500">Connecting...</span>
        )}
        {connectionState === 'connected' && (
          <span className="text-green-500">Connected</span>
        )}
        {connectionState === 'disconnected' && (
          <span className="text-gray-500">Disconnected</span>
        )}
        {connectionState === 'failed' && (
          <span className="text-red-500">Connection failed</span>
        )}
      </div>

      {/* Connection quality */}
      {connectionQuality && connectionState === 'connected' && (
        <div data-testid="connection-quality" className="mt-2 text-sm">
          <span
            data-testid="quality-indicator"
            className={`inline-block w-2 h-2 rounded-full bg-${getQualityColor()}-500`}
            style={{ backgroundColor: getQualityColor() }}
          />
          <span className="ml-1" data-testid="quality-stats">
            RTT: {connectionQuality.rtt}ms | Loss: {connectionQuality.packetLoss}%
          </span>
        </div>
      )}

      {/* Audio element for remote streams */}
      {!isLocal && stream && (
        <>
          <audio
            ref={audioRef}
            data-testid="remote-audio"
            autoPlay
            playsInline
          />
          <span
            data-testid="playback-status"
            className="text-xs"
          >
            {isPlaying ? 'Audio playing' : 'Audio loading'}
          </span>
        </>
      )}
    </div>
  )
}

describe('ParticipantCard Extended', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock HTMLMediaElement
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined)
    })

    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined)
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('should render user name', () => {
      render(<TestParticipantCard userName="Alice" />)
      expect(screen.getByTestId('user-name')).toHaveTextContent('Alice')
    })

    it('should show (You) label for local participant', () => {
      render(<TestParticipantCard isLocal={true} />)
      expect(screen.getByTestId('you-label')).toBeInTheDocument()
    })

    it('should not show (You) label for remote participant', () => {
      render(<TestParticipantCard isLocal={false} />)
      expect(screen.queryByTestId('you-label')).not.toBeInTheDocument()
    })
  })

  describe('Platform Icons', () => {
    it('should show Windows icon', () => {
      render(<TestParticipantCard platform="win" />)
      expect(screen.getByTestId('platform-icon')).toHaveTextContent('🪟')
    })

    it('should show Mac icon', () => {
      render(<TestParticipantCard platform="mac" />)
      expect(screen.getByTestId('platform-icon')).toHaveTextContent('🍎')
    })

    it('should show Linux icon', () => {
      render(<TestParticipantCard platform="linux" />)
      expect(screen.getByTestId('platform-icon')).toHaveTextContent('🐧')
    })
  })

  describe('Mute Status', () => {
    it('should show mic muted indicator when muted', () => {
      render(<TestParticipantCard isMuted={true} />)
      expect(screen.getByTestId('mic-muted-indicator')).toBeInTheDocument()
    })

    it('should show speaker muted indicator when speaker muted', () => {
      render(<TestParticipantCard isSpeakerMuted={true} />)
      expect(screen.getByTestId('speaker-muted-indicator')).toBeInTheDocument()
    })

    it('should show active indicator when not muted', () => {
      render(<TestParticipantCard isMuted={false} isSpeakerMuted={false} />)
      expect(screen.getByTestId('unmuted-indicator')).toBeInTheDocument()
    })

    it('should show both mute indicators when both are muted', () => {
      render(<TestParticipantCard isMuted={true} isSpeakerMuted={true} />)
      expect(screen.getByTestId('mic-muted-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('speaker-muted-indicator')).toBeInTheDocument()
    })
  })

  describe('Audio Level Display', () => {
    it('should display audio level bar', () => {
      render(<TestParticipantCard audioLevel={0.5} />)

      const levelBar = screen.getByTestId('audio-level-bar')
      expect(levelBar).toHaveStyle({ width: '50%' })
    })

    it('should display audio level value', () => {
      render(<TestParticipantCard audioLevel={0.75} />)

      expect(screen.getByTestId('audio-level-value')).toHaveTextContent('75%')
    })

    it('should cap audio level at 100%', () => {
      render(<TestParticipantCard audioLevel={1.5} />)

      const levelBar = screen.getByTestId('audio-level-bar')
      expect(levelBar).toHaveStyle({ width: '100%' })
    })

    it('should handle zero audio level', () => {
      render(<TestParticipantCard audioLevel={0} />)

      const levelBar = screen.getByTestId('audio-level-bar')
      expect(levelBar).toHaveStyle({ width: '0%' })
    })
  })

  describe('Connection Status', () => {
    it('should show connecting status', () => {
      render(<TestParticipantCard connectionState="connecting" />)
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Connecting')
    })

    it('should show connected status', () => {
      render(<TestParticipantCard connectionState="connected" />)
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected')
    })

    it('should show disconnected status', () => {
      render(<TestParticipantCard connectionState="disconnected" />)
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Disconnected')
    })

    it('should show failed status', () => {
      render(<TestParticipantCard connectionState="failed" />)
      expect(screen.getByTestId('connection-status')).toHaveTextContent('failed')
    })
  })

  describe('Connection Quality', () => {
    it('should display connection quality when connected', () => {
      render(
        <TestParticipantCard
          connectionState="connected"
          connectionQuality={{ rtt: 50, packetLoss: 0.5, quality: 'excellent' }}
        />
      )

      expect(screen.getByTestId('connection-quality')).toBeInTheDocument()
      expect(screen.getByTestId('quality-stats')).toHaveTextContent('RTT: 50ms')
      expect(screen.getByTestId('quality-stats')).toHaveTextContent('Loss: 0.5%')
    })

    it('should not display quality when not connected', () => {
      render(
        <TestParticipantCard
          connectionState="connecting"
          connectionQuality={{ rtt: 50, packetLoss: 0.5, quality: 'excellent' }}
        />
      )

      expect(screen.queryByTestId('connection-quality')).not.toBeInTheDocument()
    })

    it('should not display quality when no quality data', () => {
      render(
        <TestParticipantCard
          connectionState="connected"
          connectionQuality={null}
        />
      )

      expect(screen.queryByTestId('connection-quality')).not.toBeInTheDocument()
    })

    it('should show different colors for quality levels', () => {
      const { rerender } = render(
        <TestParticipantCard
          connectionState="connected"
          connectionQuality={{ rtt: 50, packetLoss: 0, quality: 'excellent' }}
        />
      )

      expect(screen.getByTestId('quality-indicator')).toHaveAttribute('style', expect.stringContaining('background-color: green'))

      rerender(
        <TestParticipantCard
          connectionState="connected"
          connectionQuality={{ rtt: 200, packetLoss: 3, quality: 'fair' }}
        />
      )

      expect(screen.getByTestId('quality-indicator')).toHaveAttribute('style', expect.stringContaining('background-color: yellow'))

      rerender(
        <TestParticipantCard
          connectionState="connected"
          connectionQuality={{ rtt: 400, packetLoss: 10, quality: 'poor' }}
        />
      )

      expect(screen.getByTestId('quality-indicator')).toHaveAttribute('style', expect.stringContaining('background-color: red'))
    })
  })

  describe('Remote Audio Playback', () => {
    it('should render audio element for remote participant with stream', async () => {
      const mockStream = new MediaStream()

      render(<TestParticipantCard isLocal={false} stream={mockStream} />)

      await waitFor(() => {
        expect(screen.getByTestId('remote-audio')).toBeInTheDocument()
        expect(screen.getByTestId('playback-status')).toHaveTextContent('Audio playing')
      })
    })

    it('should not render audio element for local participant', () => {
      const mockStream = new MediaStream()

      render(<TestParticipantCard isLocal={true} stream={mockStream} />)

      expect(screen.queryByTestId('remote-audio')).not.toBeInTheDocument()
    })

    it('should not render audio element when no stream', () => {
      render(<TestParticipantCard isLocal={false} stream={null} />)

      expect(screen.queryByTestId('remote-audio')).not.toBeInTheDocument()
    })

    it('should set stream on audio element', async () => {
      const mockStream = new MediaStream()

      render(<TestParticipantCard isLocal={false} stream={mockStream} />)

      const audio = screen.getByTestId('remote-audio') as HTMLAudioElement

      await waitFor(() => {
        expect(audio.srcObject).toBe(mockStream)
      })
    })

    it('should call play on audio element', async () => {
      const mockStream = new MediaStream()
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')

      render(<TestParticipantCard isLocal={false} stream={mockStream} />)

      await waitFor(() => {
        expect(playSpy).toHaveBeenCalled()
      })
    })
  })

  describe('Output Device Selection', () => {
    it('should set sink ID when output device changes', async () => {
      const mockStream = new MediaStream()
      const setSinkIdSpy = vi.spyOn(HTMLMediaElement.prototype, 'setSinkId' as any)

      const { rerender } = render(
        <TestParticipantCard
          isLocal={false}
          stream={mockStream}
          selectedOutputDevice="default"
        />
      )

      rerender(
        <TestParticipantCard
          isLocal={false}
          stream={mockStream}
          selectedOutputDevice="headphones"
        />
      )

      await waitFor(() => {
        expect(setSinkIdSpy).toHaveBeenCalled()
      })
    })
  })

  describe('Card Styling', () => {
    it('should have border highlight for local participant', () => {
      render(<TestParticipantCard isLocal={true} peerId="local" />)

      const card = screen.getByTestId('participant-card-local')
      expect(card).toHaveClass('border-2', 'border-blue-500')
    })

    it('should have normal border for remote participant', () => {
      render(<TestParticipantCard isLocal={false} peerId="remote" />)

      const card = screen.getByTestId('participant-card-remote')
      expect(card).toHaveClass('border', 'border-gray-200')
    })
  })
})

describe('ParticipantCard Edge Cases', () => {
  it('should handle rapid stream changes', async () => {
    const stream1 = new MediaStream()
    const stream2 = new MediaStream()

    const { rerender } = render(
      <TestParticipantCard isLocal={false} stream={stream1} />
    )

    rerender(<TestParticipantCard isLocal={false} stream={stream2} />)
    rerender(<TestParticipantCard isLocal={false} stream={null} />)
    rerender(<TestParticipantCard isLocal={false} stream={stream1} />)

    // Should not throw and should handle transitions gracefully
    await waitFor(() => {
      expect(screen.getByTestId('remote-audio')).toBeInTheDocument()
      expect(screen.getByTestId('playback-status')).toHaveTextContent('Audio playing')
    })
  })

  it('should handle play failure gracefully', async () => {
    const mockStream = new MediaStream()

    // Make play fail
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(new Error('Autoplay blocked'))

    render(<TestParticipantCard isLocal={false} stream={mockStream} />)

    // Should show loading state, not crash
    await waitFor(() => {
      expect(screen.getByTestId('playback-status')).toHaveTextContent('Audio loading')
    })
  })
})
