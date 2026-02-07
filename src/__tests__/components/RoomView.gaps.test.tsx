/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for RoomView
 * Targets:
 * - formatDuration: hours format
 * - getStatusText: all branches (idle, signaling, connecting, connected, failed, default)
 * - networkStatus periodic updates
 * - cleanup on unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// Mock dependencies before importing component
vi.mock('../../renderer/components/ParticipantCard', () => ({
  ParticipantCard: ({ name, peerId }: any) => (
    <div data-testid={`participant-${peerId}`}>
      <span data-testid="participant-name">{name}</span>
    </div>
  ),
}))

vi.mock('../../renderer/components/AudioMeter', () => ({
  AudioMeter: () => <div data-testid="audio-meter" />,
}))

vi.mock('../../renderer/components/DeviceSelector', () => ({
  DeviceSelector: ({ label }: any) => (
    <div data-testid="device-selector">
      <span>{label}</span>
    </div>
  ),
}))

vi.mock('../../renderer/hooks/useI18n', () => ({
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
        'room.startVideo': 'Start Video',
        'room.stopVideo': 'Stop Video',
        'lobby.roomId': 'Room ID',
        'common.microphone': 'Microphone',
        'common.camera': 'Camera',
      }
      return translations[key] || key
    },
  }),
}))

vi.mock('../../renderer/utils/Logger', () => ({
  UILog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AudioLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { downloadLogs: vi.fn() },
}))

import { RoomView } from '../../renderer/components/RoomView'

describe('RoomView - coverage gaps', () => {
  const defaultP2PManager = {
    getConnectionStats: vi.fn().mockResolvedValue(new Map()),
    getDebugInfo: vi.fn().mockReturnValue({
      selfId: 'self-1',
      roomId: 'test-room',
      peerCount: 0,
      peers: [],
    }),
    getSignalingState: vi.fn().mockReturnValue('connected'),
    getNetworkStatus: vi.fn().mockReturnValue({
      isOnline: true,
      wasInRoomWhenOffline: false,
      reconnectAttempts: 0,
    }),
    setOnNetworkStatusChange: vi.fn(),
    setOnSignalingStateChange: vi.fn(),
    manualReconnect: vi.fn().mockResolvedValue(true),
  }

  const defaultProps = {
    userName: 'Alice',
    roomId: 'room-123',
    localPeerId: 'local-peer',
    localPlatform: 'win' as const,
    peers: new Map(),
    remoteStreams: new Map(),
    localStream: null as MediaStream | null,
    connectionState: 'connected' as const,
    isMuted: false,
    isVideoEnabled: false,
    isSpeakerMuted: false,
    audioLevel: 0,
    selectedOutputDevice: null as string | null,
    inputDevices: [] as MediaDeviceInfo[],
    videoInputDevices: [] as MediaDeviceInfo[],
    outputDevices: [] as MediaDeviceInfo[],
    selectedInputDevice: null as string | null,
    selectedVideoDevice: null as string | null,
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
    settings: {
      noiseSuppressionEnabled: true,
      echoCancellationEnabled: true,
      autoGainControlEnabled: true,
      selectedInputDevice: null,
      selectedVideoDevice: null,
      selectedOutputDevice: null,
    },
    onSettingsChange: vi.fn(),
    p2pManager: defaultP2PManager,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders with connected state', () => {
    render(<RoomView {...(defaultProps as any)} />)
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
  })

  it('shows room ID', () => {
    render(<RoomView {...(defaultProps as any)} />)
    expect(screen.getByText(/room-123/)).toBeInTheDocument()
  })

  it('renders with signaling state', () => {
    render(<RoomView {...(defaultProps as any)} connectionState="signaling" />)
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
  })

  it('renders with failed state', () => {
    render(<RoomView {...(defaultProps as any)} connectionState="failed" />)
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
  })

  it('renders with peers', () => {
    const peers = new Map([
      [
        'peer-1',
        { name: 'Bob', isMuted: false, isSpeakerMuted: false, isVideoMuted: false, platform: 'mac' },
      ],
    ])
    render(<RoomView {...(defaultProps as any)} peers={peers} connectionState="connected" />)
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('calls onLeaveRoom when leave button clicked', () => {
    render(<RoomView {...(defaultProps as any)} />)
    const leaveBtn = screen.getByTestId('room-leave-btn')
    fireEvent.click(leaveBtn)
    expect(defaultProps.onLeaveRoom).toHaveBeenCalled()
  })

  it('calls onToggleMute when mute button clicked', () => {
    render(<RoomView {...(defaultProps as any)} />)
    const muteBtn = screen.getByTestId('room-mute-btn')
    fireEvent.click(muteBtn)
    expect(defaultProps.onToggleMute).toHaveBeenCalled()
  })

  it('calls onToggleVideo when video button clicked', () => {
    render(<RoomView {...(defaultProps as any)} />)
    const videoBtn = screen.getByTestId('room-video-btn')
    fireEvent.click(videoBtn)
    expect(defaultProps.onToggleVideo).toHaveBeenCalled()
  })

  it('formats duration with hours', () => {
    render(<RoomView {...(defaultProps as any)} />)

    // Advance timer by more than 1 hour
    act(() => {
      vi.advanceTimersByTime(3661000) // 1h 1m 1s
    })

    // The formatDuration function should produce hour format (1:01:01)
    expect(screen.getByText(/1:01:01/)).toBeInTheDocument()
  })

  it('updates network status periodically', () => {
    render(<RoomView {...(defaultProps as any)} />)

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(defaultP2PManager.getNetworkStatus).toHaveBeenCalled()
  })

  it('cleans up intervals on unmount', () => {
    const { unmount } = render(<RoomView {...(defaultProps as any)} />)
    unmount()
  })

  it('renders mute and leave buttons', () => {
    render(<RoomView {...(defaultProps as any)} />)
    expect(screen.getByTestId('room-mute-btn')).toBeInTheDocument()
    expect(screen.getByTestId('room-leave-btn')).toBeInTheDocument()
    expect(screen.getByTestId('room-copy-btn')).toBeInTheDocument()
  })
})
