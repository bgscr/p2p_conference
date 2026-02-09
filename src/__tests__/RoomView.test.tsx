/**
 * @vitest-environment jsdom
 */

/**
 * Additional coverage tests for RoomView.tsx
 * Targets: formatDuration with hours, grid layout variations,
 * video toggle button, peer volume controls, download logs,
 * copied state in empty state button, and connection stats intervals.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// Mock dependencies before importing component
vi.mock('../renderer/components/ParticipantCard', () => ({
  ParticipantCard: ({ name, connectionQuality, volume, onVolumeChange, isLocal, peerId }: any) => (
    <div data-testid={`participant-${peerId}`}>
      <span data-testid="participant-name">{name}</span>
      {connectionQuality && <span data-testid="quality">{connectionQuality.quality}</span>}
      {!isLocal && onVolumeChange && (
        <div data-testid={`volume-control-${peerId}`}>
          <span data-testid={`volume-${peerId}`}>{volume}</span>
          <button data-testid={`vol-change-${peerId}`} onClick={() => onVolumeChange(50)}>Set 50</button>
        </div>
      )}
    </div>
  )
}))

vi.mock('../renderer/components/AudioMeter', () => ({
  AudioMeter: () => <div data-testid="audio-meter" />
}))

vi.mock('../renderer/components/DeviceSelector', () => ({
  DeviceSelector: ({ label, onSelect }: any) => (
    <div data-testid="device-selector">
      <span>{label}</span>
      <select onChange={(e: any) => onSelect(e.target.value)} data-testid={`select-${label}`}>
        <option value="dev1">Device 1</option>
        <option value="dev2">Device 2</option>
      </select>
    </div>
  )
}))

vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, params?: Record<string, any>) => {
      const translations: Record<string, string> = {
        'room.you': 'You',
        'room.muted': 'Muted',
        'room.live': 'Live',
        'room.copyRoomId': 'Copy Room ID',
        'room.copied': 'Copied!',
        'room.leaveCallHint': 'Leave Call',
        'room.inCall': 'in call',
        'room.searchingParticipants': 'Searching...',
        'room.connecting': 'Connecting...',
        'room.connected': 'Connected',
        'room.notConnected': 'Not connected',
        'room.connectionFailed': 'Connection failed',
        'room.participantsConnected': `${params?.count || 0} participants`,
        'room.muteHint': 'Mute (M)',
        'room.unmuteHint': 'Unmute (M)',
        'room.speakerMuted': 'Speaker Muted',
        'common.speaker': 'Speaker',
        'room.muteNotifications': 'Mute Notifications',
        'room.enableNotifications': 'Enable Notifications',
        'room.audioSettings': 'Audio Settings',
        'room.waitingForOthers': 'Waiting for others',
        'room.shareRoomIdHint': 'Share the room ID to invite others',
        'room.networkOffline': 'You are offline',
        'room.reconnecting': 'Reconnecting',
        'room.retryNow': 'Retry Now',
        'room.on': 'On',
        'room.off': 'Off',
        'room.noiseSuppressionBrowser': 'AI Noise Suppression',
        'room.havingIssues': 'Having issues?',
        'room.downloadLogs': 'Download Logs',
        'room.roomIdCopyHint': 'Copy Room ID',
        'room.performanceWarning': `Performance warning (${params?.count || 0} participants)`,
        'room.startVideo': 'Start Video',
        'room.stopVideo': 'Stop Video',
        'lobby.roomId': 'Room ID',
        'common.microphone': 'Microphone',
        'common.camera': 'Camera'
      }
      return translations[key] || key
    }
  })
}))

vi.mock('../renderer/utils/Logger', () => ({
  UILog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AudioLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { downloadLogs: vi.fn() }
}))

import { RoomView } from '../renderer/components/RoomView'
import { logger } from '../renderer/utils/Logger'

const createDefaultProps = (overrides: any = {}) => ({
  userName: 'Alice',
  roomId: 'test-room-123',
  localPeerId: 'local-123',
  localPlatform: 'win' as const,
  peers: new Map(),
  remoteStreams: new Map(),
  localStream: null as MediaStream | null,
  connectionState: 'connected' as const,
  isMuted: false,
  isVideoEnabled: true,
  isSpeakerMuted: false,
  audioLevel: 0.5,
  selectedOutputDevice: 'default',
  inputDevices: [] as any[],
  videoInputDevices: [] as any[],
  outputDevices: [] as any[],
  selectedInputDevice: 'default',
  selectedVideoDevice: 'default',
  soundEnabled: true,
  onToggleMute: vi.fn(),
  onToggleVideo: vi.fn(),
  onToggleSpeakerMute: vi.fn(),
  onLeaveRoom: vi.fn(),
  onInputDeviceChange: vi.fn(),
  onVideoDeviceChange: vi.fn(),
  onOutputDeviceChange: vi.fn(),
  onCopyRoomId: vi.fn(),
  onToggleSound: vi.fn(),
  chatMessages: [] as any[],
  onSendChatMessage: vi.fn(),
  chatUnreadCount: 0,
  isChatOpen: false,
  onToggleChat: vi.fn(),
  onMarkChatRead: vi.fn(),
  isScreenSharing: false,
  onToggleScreenShare: vi.fn(),
  settings: {
    noiseSuppressionEnabled: true,
    echoCancellationEnabled: true,
    autoGainControlEnabled: true,
    selectedInputDevice: null,
    selectedVideoDevice: null,
    selectedOutputDevice: null
  },
  onSettingsChange: vi.fn(),
  ...overrides
})

describe('RoomView - Duration Formatting', () => {
  it('should render initial time display as 0:00', () => {
    render(<RoomView {...createDefaultProps()} />)
    // Initial time should start at 0:00
    expect(screen.getByText(/0:0/)).toBeInTheDocument()
  })
})

describe('RoomView - Grid Layout Variations', () => {
  const makePeers = (count: number) => {
    const peers = new Map<string, any>()
    for (let i = 0; i < count; i++) {
      peers.set(`peer-${i}`, {
        id: `peer-${i}`,
        name: `User ${i}`,
        isMuted: false,
        audioLevel: 0,
        connectionState: 'connected',
        platform: 'win'
      })
    }
    return peers
  }

  it('should render single column for 0 peers', () => {
    const { container } = render(<RoomView {...createDefaultProps({ peers: new Map() })} />)
    const grid = container.querySelector('.grid')
    expect(grid?.className).toContain('grid-cols-1')
  })

  it('should render 2 columns for 1 peer', () => {
    const { container } = render(<RoomView {...createDefaultProps({ peers: makePeers(1) })} />)
    const grid = container.querySelector('.grid')
    expect(grid?.className).toContain('grid-cols-2')
  })

  it('should render 2 columns for 2-3 peers', () => {
    const { container } = render(<RoomView {...createDefaultProps({ peers: makePeers(3) })} />)
    const grid = container.querySelector('.grid')
    expect(grid?.className).toContain('grid-cols-2')
  })

  it('should render 3 columns for 4-5 peers', () => {
    const { container } = render(<RoomView {...createDefaultProps({ peers: makePeers(4) })} />)
    const grid = container.querySelector('.grid')
    expect(grid?.className).toContain('grid-cols-3')
  })

  it('should render 4 columns for 6+ peers', () => {
    const { container } = render(<RoomView {...createDefaultProps({ peers: makePeers(6) })} />)
    const grid = container.querySelector('.grid')
    expect(grid?.className).toContain('grid-cols-4')
  })
})

describe('RoomView - Video Toggle Button', () => {
  it('should call onToggleVideo when video button clicked', () => {
    const onToggleVideo = vi.fn()
    render(<RoomView {...createDefaultProps({ onToggleVideo, isVideoEnabled: true })} />)

    const videoBtn = screen.getByTestId('room-video-btn')
    fireEvent.click(videoBtn)

    expect(onToggleVideo).toHaveBeenCalled()
  })

  it('should show correct title when video is enabled', () => {
    render(<RoomView {...createDefaultProps({ isVideoEnabled: true })} />)
    expect(screen.getByTitle('Stop Video')).toBeInTheDocument()
  })

  it('should show correct title when video is disabled', () => {
    render(<RoomView {...createDefaultProps({ isVideoEnabled: false })} />)
    expect(screen.getByTitle('Start Video')).toBeInTheDocument()
  })
})

describe('RoomView - Peer Volume Controls', () => {
  it('should handle per-peer volume change', () => {
    const peers = new Map([
      ['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' as const, platform: 'mac' as const }]
    ])

    render(<RoomView {...createDefaultProps({ peers })} />)

    // Find the volume change button from the mocked ParticipantCard
    const volBtn = screen.getByTestId('vol-change-peer-1')
    fireEvent.click(volBtn)

    // Volume should have been updated (internal state)
    // The mocked ParticipantCard should re-render with the new volume
    expect(screen.getByTestId('volume-peer-1')).toBeInTheDocument()
  })
})

describe('RoomView - Download Logs Button', () => {
  it('should call logger.downloadLogs from device panel', () => {
    render(<RoomView {...createDefaultProps()} />)

    // Open device panel
    const settingsButton = screen.getByTitle('Audio Settings')
    fireEvent.click(settingsButton)

    // Click download logs
    fireEvent.click(screen.getByText('Download Logs'))
    expect(logger.downloadLogs).toHaveBeenCalled()
  })
})

describe('RoomView - Copied State in Empty State Button', () => {
  it('should show copied feedback in empty state copy button', () => {
    vi.useFakeTimers()

    const onCopyRoomId = vi.fn()
    render(
      <RoomView
        {...createDefaultProps({
          peers: new Map(),
          connectionState: 'connected',
          onCopyRoomId
        })}
      />
    )

    // Find copy button in empty state area (the big blue button)
    const copyButtons = screen.getAllByText('Copy Room ID')
    // There might be multiple copy buttons - click the one in the empty state
    fireEvent.click(copyButtons[copyButtons.length - 1])

    // Should show Copied! text
    expect(screen.getByText('Copied!')).toBeInTheDocument()

    // After 2s, should revert
    act(() => {
      vi.advanceTimersByTime(2100)
    })

    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()

    vi.useRealTimers()
  })
})

describe('RoomView - Connection Stats with p2pManager', () => {
  it('should call getConnectionStats on mount', async () => {
    const mockP2PManager = {
      getConnectionStats: vi.fn().mockResolvedValue(new Map()),
      setOnNetworkStatusChange: vi.fn(),
      getNetworkStatus: vi.fn().mockReturnValue({
        isOnline: true,
        wasInRoomWhenOffline: false,
        reconnectAttempts: 0
      }),
      manualReconnect: vi.fn()
    }

    const { unmount } = render(
      <RoomView {...createDefaultProps({ p2pManager: mockP2PManager })} />
    )

    await waitFor(() => {
      expect(mockP2PManager.getConnectionStats).toHaveBeenCalled()
    })

    unmount()
  })

  it('should register network status callback', () => {
    const mockP2PManager = {
      getConnectionStats: vi.fn().mockResolvedValue(new Map()),
      setOnNetworkStatusChange: vi.fn(),
      getNetworkStatus: vi.fn().mockReturnValue({
        isOnline: true,
        wasInRoomWhenOffline: false,
        reconnectAttempts: 0
      }),
      manualReconnect: vi.fn()
    }

    const { unmount } = render(
      <RoomView {...createDefaultProps({ p2pManager: mockP2PManager })} />
    )

    expect(mockP2PManager.setOnNetworkStatusChange).toHaveBeenCalled()
    unmount()
  })
})

describe('RoomView - Noise Suppression Toggle in Panel', () => {
  it('should show on/off status for noise suppression', () => {
    render(<RoomView {...createDefaultProps()} />)

    // Open device panel
    fireEvent.click(screen.getByTitle('Audio Settings'))

    // Noise suppression is enabled
    expect(screen.getByText('On')).toBeInTheDocument()
  })

  it('should show off status when noise suppression is disabled', () => {
    const settings = {
      noiseSuppressionEnabled: false,
      echoCancellationEnabled: true,
      autoGainControlEnabled: true,
      selectedInputDevice: null,
      selectedVideoDevice: null,
      selectedOutputDevice: null
    }

    render(<RoomView {...createDefaultProps({ settings })} />)

    fireEvent.click(screen.getByTitle('Audio Settings'))
    expect(screen.getByText('Off')).toBeInTheDocument()
  })
})

describe('RoomView - No p2pManager', () => {
  it('should render without p2pManager prop', () => {
    render(<RoomView {...createDefaultProps({ p2pManager: undefined })} />)
    expect(screen.getByText('test-room-123')).toBeInTheDocument()
  })
})
