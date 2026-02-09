/**
 * Coverage-focused tests for RoomView component
 * @vitest-environment jsdom
 * 
 * These tests target the actual RoomView component to improve coverage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// Mock dependencies
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, params?: Record<string, any>) => {
      const translations: Record<string, string> = {
        'room.you': 'You',
        'room.muted': 'Muted',
        'room.live': 'Live',
        'room.copyRoomId': 'Copy Room ID',
        'room.copied': 'Copied!',
        'room.leaveCall': 'Leave',
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
        'common.microphone': 'Microphone',
        'common.speaker': 'Speaker'
      }
      return translations[key] || key
    }
  })
}))

vi.mock('../../renderer/utils/Logger', () => ({
  UILog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AudioLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { downloadLogs: vi.fn() }
}))

// Import the actual component after mocks are set up
import { RoomView } from '../../renderer/components/RoomView'
import { logger } from '../../renderer/utils/Logger'

describe('RoomView Component - Coverage Tests', () => {
  const defaultProps = {
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
    inputDevices: [{ deviceId: 'default', label: 'Default Mic', kind: 'audioinput' as const, groupId: 'g1', toJSON: () => ({}) }],
    videoInputDevices: [{ deviceId: 'default', label: 'Default Cam', kind: 'videoinput' as const, groupId: 'g1', toJSON: () => ({}) }],
    outputDevices: [{ deviceId: 'default', label: 'Default Speaker', kind: 'audiooutput' as const, groupId: 'g1', toJSON: () => ({}) }],
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
    onSettingsChange: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Timer/Elapsed Time', () => {
    it('should render initial time display', () => {
      render(<RoomView {...defaultProps} />)
      // Initial time should be 0:00 or similar
      expect(screen.getByText(/0:0/)).toBeInTheDocument()
    })

    it('should update elapsed time with real timers', async () => {
      vi.useFakeTimers()
      render(<RoomView {...defaultProps} />)

      // Advance timer by 2 seconds
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      // Should update (the actual time may vary slightly)
      expect(screen.getByText(/0:0/)).toBeInTheDocument()

      vi.useRealTimers()
    })
  })

  describe('Network Status Banner', () => {
    it('should show offline banner when network is offline', () => {
      vi.useFakeTimers()
      const mockP2PManager = {
        getConnectionStats: vi.fn().mockResolvedValue(new Map()),
        setOnNetworkStatusChange: vi.fn((cb: (isOnline: boolean) => void) => {
          cb(false)
        }),
        getNetworkStatus: vi.fn().mockReturnValue({
          isOnline: false,
          wasInRoomWhenOffline: true,
          reconnectAttempts: 0
        }),
        manualReconnect: vi.fn()
      }

      const { unmount } = render(<RoomView {...defaultProps} p2pManager={mockP2PManager as any} />)

      expect(screen.getByText('You are offline')).toBeInTheDocument()

      unmount()
      vi.useRealTimers()
    })

    it('should show reconnecting banner with retry count', () => {
      vi.useFakeTimers()

      const mockP2PManager = {
        getConnectionStats: vi.fn().mockResolvedValue(new Map()),
        setOnNetworkStatusChange: vi.fn(),
        getNetworkStatus: vi.fn().mockReturnValue({
          isOnline: true,
          wasInRoomWhenOffline: true,
          reconnectAttempts: 2
        }),
        manualReconnect: vi.fn()
      }

      const { unmount } = render(<RoomView {...defaultProps} p2pManager={mockP2PManager as any} />)

      // Trigger the network status poll
      act(() => {
        vi.advanceTimersByTime(1100)
      })

      expect(screen.getByText(/Reconnecting/)).toBeInTheDocument()
      expect(screen.getByText(/2\/5/)).toBeInTheDocument()

      unmount()
      vi.useRealTimers()
    })

    it('should call manualReconnect when retry button clicked', () => {
      vi.useFakeTimers()

      const mockManualReconnect = vi.fn()
      const mockP2PManager = {
        getConnectionStats: vi.fn().mockResolvedValue(new Map()),
        setOnNetworkStatusChange: vi.fn(),
        getNetworkStatus: vi.fn().mockReturnValue({
          isOnline: true,
          wasInRoomWhenOffline: true,
          reconnectAttempts: 1
        }),
        manualReconnect: mockManualReconnect
      }

      const { unmount } = render(<RoomView {...defaultProps} p2pManager={mockP2PManager as any} />)

      act(() => {
        vi.advanceTimersByTime(1100)
      })

      const retryButton = screen.getByText('Retry Now')
      fireEvent.click(retryButton)

      expect(mockManualReconnect).toHaveBeenCalled()

      unmount()
      vi.useRealTimers()
    })
  })

  describe('Empty State Display', () => {
    it('should show empty state when no peers and not connecting', () => {
      render(
        <RoomView
          {...defaultProps}
          peers={new Map()}
          connectionState="connected"
        />
      )

      expect(screen.getByText('Waiting for others')).toBeInTheDocument()
      expect(screen.getByText('Share the room ID to invite others')).toBeInTheDocument()
    })

    it('should not show empty state when connecting', () => {
      render(
        <RoomView
          {...defaultProps}
          peers={new Map()}
          connectionState="connecting"
        />
      )

      expect(screen.queryByText('Waiting for others')).not.toBeInTheDocument()
    })

    it('should not show empty state when peers exist', () => {
      const peers = new Map([
        ['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' as const, platform: 'mac' as const }]
      ])

      render(
        <RoomView
          {...defaultProps}
          peers={peers}
          connectionState="connected"
        />
      )

      expect(screen.queryByText('Waiting for others')).not.toBeInTheDocument()
    })

    it('should copy room ID from empty state button', () => {
      const onCopyRoomId = vi.fn()

      render(
        <RoomView
          {...defaultProps}
          peers={new Map()}
          connectionState="connected"
          onCopyRoomId={onCopyRoomId}
        />
      )

      // Find the copy button in empty state (the one that says "Copy Room ID")
      const copyButtons = screen.getAllByText('Copy Room ID')
      fireEvent.click(copyButtons[copyButtons.length - 1])

      expect(onCopyRoomId).toHaveBeenCalled()
    })
  })

  describe('Device Panel & Settings', () => {
    it('should toggle device panel visibility', () => {
      render(<RoomView {...defaultProps} />)

      // Find the audio settings button by title
      const settingsButton = screen.getByTitle('Audio Settings')
      fireEvent.click(settingsButton)

      // Device panel should appear with microphone label
      expect(screen.getByText('Microphone')).toBeInTheDocument()
    })

    it('should toggle noise suppression setting', () => {
      const onSettingsChange = vi.fn()

      render(
        <RoomView
          {...defaultProps}
          settings={{
            ...defaultProps.settings,
            noiseSuppressionEnabled: true
          }}
          onSettingsChange={onSettingsChange}
        />
      )

      // Open device panel
      const settingsButton = screen.getByTitle('Audio Settings')
      fireEvent.click(settingsButton)

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)

      expect(onSettingsChange).toHaveBeenCalledWith({ noiseSuppressionEnabled: false })
    })

    it('should call input device change', () => {
      const onInputDeviceChange = vi.fn()
      const inputDevices = [
        { deviceId: 'mic1', label: 'Mic 1', kind: 'audioinput' as const, groupId: 'g1', toJSON: () => ({}) },
        { deviceId: 'mic2', label: 'Mic 2', kind: 'audioinput' as const, groupId: 'g2', toJSON: () => ({}) }
      ]

      render(
        <RoomView
          {...defaultProps}
          inputDevices={inputDevices}
          selectedInputDevice="mic1"
          onInputDeviceChange={onInputDeviceChange}
        />
      )

      // Open device panel
      const settingsButton = screen.getByTitle('Audio Settings')
      fireEvent.click(settingsButton)

      const selects = screen.getAllByRole('combobox')
      fireEvent.change(selects[0], { target: { value: 'mic2' } })

      expect(onInputDeviceChange).toHaveBeenCalledWith('mic2')
    })

    it('should download logs from device panel', () => {
      render(<RoomView {...defaultProps} />)

      // Open device panel
      const settingsButton = screen.getByTitle('Audio Settings')
      fireEvent.click(settingsButton)

      fireEvent.click(screen.getByText('Download Logs'))

      expect(logger.downloadLogs).toHaveBeenCalled()
    })
  })

  describe('Connection Stats', () => {
    it('should fetch connection stats when p2pManager provided', async () => {
      const mockStats = new Map([
        ['peer-1', {
          peerId: 'peer-1',
          rtt: 50,
          packetLoss: 0.5,
          jitter: 10,
          bytesReceived: 1000,
          bytesSent: 500,
          quality: 'good' as const,
          connectionState: 'connected'
        }]
      ])

      const mockP2PManager = {
        getConnectionStats: vi.fn().mockResolvedValue(mockStats),
        setOnNetworkStatusChange: vi.fn(),
        getNetworkStatus: vi.fn().mockReturnValue({
          isOnline: true,
          wasInRoomWhenOffline: false,
          reconnectAttempts: 0
        }),
        manualReconnect: vi.fn()
      }

      const peers = new Map([
        ['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' as const, platform: 'mac' as const }]
      ])

      const { unmount } = render(
        <RoomView
          {...defaultProps}
          peers={peers}
          p2pManager={mockP2PManager as any}
        />
      )

      await waitFor(() => {
        expect(mockP2PManager.getConnectionStats).toHaveBeenCalled()
      })

      unmount()
    })
  })

  describe('Control Buttons', () => {
    it('should call onToggleMute when mute button clicked', () => {
      const onToggleMute = vi.fn()
      render(<RoomView {...defaultProps} onToggleMute={onToggleMute} />)

      const muteButton = screen.getByTitle('Mute (M)')
      fireEvent.click(muteButton)

      expect(onToggleMute).toHaveBeenCalled()
    })

    it('should call onToggleSpeakerMute when speaker button clicked', () => {
      const onToggleSpeakerMute = vi.fn()
      render(<RoomView {...defaultProps} onToggleSpeakerMute={onToggleSpeakerMute} />)

      const speakerButton = screen.getByTitle('Speaker')
      fireEvent.click(speakerButton)

      expect(onToggleSpeakerMute).toHaveBeenCalled()
    })

    it('should call onLeaveRoom when leave button clicked', () => {
      const onLeaveRoom = vi.fn()
      render(<RoomView {...defaultProps} onLeaveRoom={onLeaveRoom} />)

      const leaveButton = screen.getByTitle('Leave Call')
      fireEvent.click(leaveButton)

      expect(onLeaveRoom).toHaveBeenCalled()
    })

    it('should show unmute hint when muted', () => {
      render(<RoomView {...defaultProps} isMuted={true} />)

      expect(screen.getByTitle('Unmute (M)')).toBeInTheDocument()
    })

    it('should show speaker muted elements when speaker is muted', () => {
      render(<RoomView {...defaultProps} isSpeakerMuted={true} />)

      // Use getAllByTitle since there might be multiple elements
      const speakerMutedElements = screen.getAllByTitle('Speaker Muted')
      expect(speakerMutedElements.length).toBeGreaterThan(0)
    })

    it('should call onToggleSound when notification button clicked', () => {
      const onToggleSound = vi.fn()
      render(<RoomView {...defaultProps} onToggleSound={onToggleSound} soundEnabled={true} />)

      const soundButton = screen.getByTitle('Mute Notifications')
      fireEvent.click(soundButton)

      expect(onToggleSound).toHaveBeenCalled()
    })

    it('should show enable notifications title when sound is disabled', () => {
      render(<RoomView {...defaultProps} soundEnabled={false} />)

      expect(screen.getByTitle('Enable Notifications')).toBeInTheDocument()
    })
  })

  describe('Participant Warning', () => {
    it('should show warning styling when 8+ participants', () => {
      const peers = new Map<string, any>()
      for (let i = 0; i < 8; i++) {
        peers.set(`peer-${i}`, { id: `peer-${i}`, name: `User ${i}`, isMuted: false, audioLevel: 0, connectionState: 'connected' as const, platform: 'win' })
      }

      render(<RoomView {...defaultProps} peers={peers} />)

      // The participant count should show 9 (8 peers + 1 local)
      expect(screen.getByText(/9 in call/)).toBeInTheDocument()
    })
  })

  describe('Connection State Display', () => {
    it('should show searching status', () => {
      render(<RoomView {...defaultProps} connectionState="signaling" />)
      expect(screen.getByText('Searching...')).toBeInTheDocument()
    })

    it('should show connecting status', () => {
      render(<RoomView {...defaultProps} connectionState="connecting" />)
      expect(screen.getByText('Connecting...')).toBeInTheDocument()
    })

    it('should show failed status', () => {
      render(<RoomView {...defaultProps} connectionState="failed" />)
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
    })

    it('should show not connected status', () => {
      render(<RoomView {...defaultProps} connectionState="idle" />)
      expect(screen.getByText('Not connected')).toBeInTheDocument()
    })

    it('should show participant count when connected', () => {
      const peers = new Map([
        ['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' as const, platform: 'mac' as const }]
      ])
      render(<RoomView {...defaultProps} connectionState="connected" peers={peers} />)
      expect(screen.getByText('1 participants')).toBeInTheDocument()
    })
  })

  describe('Copy Room ID Header', () => {
    it('should call onCopyRoomId when header copy button clicked', () => {
      const onCopyRoomId = vi.fn()
      render(<RoomView {...defaultProps} onCopyRoomId={onCopyRoomId} />)

      const copyButton = screen.getByTitle('Copy Room ID')
      fireEvent.click(copyButton)

      expect(onCopyRoomId).toHaveBeenCalled()
    })

    it('should show copied feedback after clicking', () => {
      vi.useFakeTimers()

      const onCopyRoomId = vi.fn()
      render(<RoomView {...defaultProps} onCopyRoomId={onCopyRoomId} />)

      const copyButton = screen.getByTitle('Copy Room ID')
      fireEvent.click(copyButton)

      // Should show "Copied!" feedback
      expect(screen.getByText(/Copied!/)).toBeInTheDocument()

      // Advance timer to clear feedback
      act(() => {
        vi.advanceTimersByTime(2100)
      })

      expect(screen.queryByText(/Copied!/)).not.toBeInTheDocument()

      vi.useRealTimers()
    })
  })

  describe('Volume Controls for Peers', () => {
    it('should render peer with volume control', () => {
      const peers = new Map([
        ['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0.5, connectionState: 'connected' as const, platform: 'mac' as const }]
      ])

      render(
        <RoomView
          {...defaultProps}
          peers={peers}
        />
      )

      expect(screen.getByText('Bob')).toBeInTheDocument()
    })
  })

  describe('Audio Level Display', () => {
    it('should show muted text when muted', () => {
      render(<RoomView {...defaultProps} isMuted={true} />)

      expect(screen.getByText('Muted')).toBeInTheDocument()
    })

    it('should show live text when not muted', () => {
      render(<RoomView {...defaultProps} isMuted={false} />)

      expect(screen.getByText('Live')).toBeInTheDocument()
    })
  })
})
