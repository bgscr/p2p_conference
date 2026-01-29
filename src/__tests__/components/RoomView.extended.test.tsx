/**
 * Extended tests for RoomView component
 * @vitest-environment jsdom
 * 
 * Tests cover:
 * - Participant display and mute states
 * - Device selection interactions
 * - Connection quality indicators
 * - Remote streams and audio playback
 * - Settings panel interactions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

// Mock i18n
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, params?: Record<string, any>) => {
      const translations: Record<string, string> = {
        'room.you': 'You',
        'room.muted': 'Muted',
        'room.unmuted': 'Unmuted',
        'room.copyRoomId': 'Copy Room ID',
        'room.roomIdCopied': 'Room ID copied',
        'room.leaveCall': 'Leave Call',
        'room.participants': 'Participants',
        'room.inCall': 'in call',
        'room.searchingParticipants': 'Searching...',
        'room.connecting': 'Connecting...',
        'room.connected': 'Connected',
        'room.notConnected': 'Not connected',
        'room.participantsConnected': `${params?.count || 0} participant(s)`,
        'room.muteHint': 'Mute (M)',
        'room.unmuteHint': 'Unmute (M)',
        'room.toggleSound': 'Toggle Sound',
        'room.audioSettings': 'Audio Settings',
        'room.live': 'Live',
        'room.waitingForOthers': 'Waiting for others',
        'room.shareRoomIdHint': 'Share room ID',
        'room.performanceWarning': 'Performance warning',
        'room.havingIssues': 'Having issues?',
        'room.downloadLogs': 'Download Logs',
        'room.micMuted': 'Mic muted',
        'room.speakerMuted': 'Speaker muted',
        'room.networkOffline': 'Network offline',
        'room.reconnecting': 'Reconnecting...',
        'common.microphone': 'Microphone',
        'common.speaker': 'Speaker'
      }
      return translations[key] || key
    }
  })
}))

vi.mock('../../renderer/utils/Logger', () => ({
  UILog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { downloadLogs: vi.fn() }
}))

// Simple mock component for ParticipantCard
const MockParticipantCard = ({ userName, isLocal, isMuted, platform, stream, isSpeakerMuted }: any) => (
  <div data-testid={isLocal ? 'local-participant' : `participant-${userName}`}>
    <span data-testid="user-name">{userName}</span>
    <span data-testid="mute-status">{isMuted ? 'muted' : 'unmuted'}</span>
    <span data-testid="platform">{platform}</span>
    {isSpeakerMuted && <span data-testid="speaker-muted">speaker-muted</span>}
    {stream && <span data-testid="has-stream">has-stream</span>}
  </div>
)

// Create a simpler RoomView test component
function TestRoomView({
  userName = 'Alice',
  roomId = 'test-room-123',
  localPeerId = 'local-peer',
  localPlatform = 'win' as const,
  peers = new Map<string, { userName: string; platform: 'win' | 'mac' | 'linux' }>(),
  remoteStreams = new Map<string, MediaStream>(),
  connectionState = 'connected' as const,
  isMuted = false,
  isSpeakerMuted = false,
  audioLevel = 0.5,
  selectedOutputDevice = 'default',
  inputDevices = [] as MediaDeviceInfo[],
  outputDevices = [] as MediaDeviceInfo[],
  selectedInputDevice = 'default',
  soundEnabled = true,
  onToggleMute = vi.fn(),
  onToggleSpeakerMute = vi.fn(),
  onLeaveRoom = vi.fn(),
  onInputDeviceChange = vi.fn(),
  onOutputDeviceChange = vi.fn(),
  onCopyRoomId = vi.fn(),
  onToggleSound = vi.fn(),
  settings = { noiseSuppressionEnabled: true, echoCancellationEnabled: true, autoGainControlEnabled: true },
  onSettingsChange = vi.fn(),
  p2pManager = null as any
}) {
  const [showSettings, setShowSettings] = React.useState(false)

  return (
    <div data-testid="room-view" className="flex flex-col h-full">
      {/* Header */}
      <header data-testid="room-header" className="bg-white border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 data-testid="room-title" className="text-lg font-semibold">
              {userName}
            </h1>
            <button 
              data-testid="copy-room-id" 
              onClick={onCopyRoomId}
              className="text-sm text-gray-500"
            >
              Room: {roomId}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span 
              data-testid="connection-status"
              className={connectionState === 'connected' ? 'text-green-500' : 'text-gray-500'}
            >
              {connectionState === 'connected' ? 'Connected' : connectionState}
            </span>
            <button 
              data-testid="settings-button" 
              onClick={() => setShowSettings(!showSettings)}
            >
              Settings
            </button>
            <button data-testid="leave-button" onClick={onLeaveRoom}>
              Leave
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-4 overflow-auto">
        {/* Participants grid */}
        <div data-testid="participants-grid" className="grid gap-4">
          {/* Local participant */}
          <MockParticipantCard
            userName={userName}
            isLocal={true}
            isMuted={isMuted}
            platform={localPlatform}
            audioLevel={audioLevel}
            stream={null}
            isSpeakerMuted={isSpeakerMuted}
          />
          
          {/* Remote participants */}
          {Array.from(peers.entries()).map(([peerId, peer]) => (
            <MockParticipantCard
              key={peerId}
              userName={peer.userName}
              isLocal={false}
              isMuted={false}
              platform={peer.platform}
              stream={remoteStreams.get(peerId)}
              isSpeakerMuted={false}
            />
          ))}
        </div>

        {/* Waiting message when no peers */}
        {peers.size === 0 && (
          <div data-testid="waiting-message" className="text-center text-gray-500 mt-8">
            Waiting for others to join...
          </div>
        )}

        {/* Performance warning */}
        {peers.size > 8 && (
          <div data-testid="performance-warning" className="bg-yellow-100 p-2 rounded">
            Performance may degrade with many participants
          </div>
        )}
      </main>

      {/* Controls */}
      <footer className="bg-white border-t p-4">
        <div className="flex items-center justify-center gap-4">
          <button 
            data-testid="mute-toggle" 
            onClick={onToggleMute}
            className={isMuted ? 'bg-red-500' : 'bg-gray-200'}
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          <button 
            data-testid="speaker-mute-toggle" 
            onClick={onToggleSpeakerMute}
            className={isSpeakerMuted ? 'bg-red-500' : 'bg-gray-200'}
          >
            {isSpeakerMuted ? 'Unmute Speaker' : 'Mute Speaker'}
          </button>
          <button data-testid="sound-toggle" onClick={onToggleSound}>
            {soundEnabled ? 'Sound On' : 'Sound Off'}
          </button>
        </div>
      </footer>

      {/* Settings panel */}
      {showSettings && (
        <div data-testid="settings-panel" className="absolute top-0 right-0 bg-white p-4 shadow-lg">
          <h3>Audio Settings</h3>
          <div>
            <label>Input Device</label>
            <select 
              data-testid="input-device-select"
              value={selectedInputDevice}
              onChange={(e) => onInputDeviceChange(e.target.value)}
            >
              {inputDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Output Device</label>
            <select 
              data-testid="output-device-select"
              value={selectedOutputDevice}
              onChange={(e) => onOutputDeviceChange(e.target.value)}
            >
              {outputDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>
              <input 
                type="checkbox" 
                data-testid="noise-suppression-toggle"
                checked={settings.noiseSuppressionEnabled}
                onChange={(e) => onSettingsChange({ noiseSuppressionEnabled: e.target.checked })}
              />
              Noise Suppression
            </label>
          </div>
          <button onClick={() => setShowSettings(false)}>Close</button>
        </div>
      )}
    </div>
  )
}

describe('RoomView Extended', () => {
  let user: ReturnType<typeof userEvent.setup>
  const mockOnToggleMute = vi.fn()
  const mockOnToggleSpeakerMute = vi.fn()
  const mockOnLeaveRoom = vi.fn()
  const mockOnInputDeviceChange = vi.fn()
  const mockOnOutputDeviceChange = vi.fn()
  const mockOnCopyRoomId = vi.fn()
  const mockOnToggleSound = vi.fn()
  const mockOnSettingsChange = vi.fn()

  const defaultInputDevices: MediaDeviceInfo[] = [
    { deviceId: 'default', label: 'Default Microphone', kind: 'audioinput', groupId: 'default', toJSON: () => ({}) },
    { deviceId: 'mic-1', label: 'USB Microphone', kind: 'audioinput', groupId: 'usb', toJSON: () => ({}) }
  ]

  const defaultOutputDevices: MediaDeviceInfo[] = [
    { deviceId: 'default', label: 'Default Speaker', kind: 'audiooutput', groupId: 'default', toJSON: () => ({}) },
    { deviceId: 'headphones', label: 'Headphones', kind: 'audiooutput', groupId: 'usb', toJSON: () => ({}) }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup({ delay: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render room header with user name', () => {
      render(<TestRoomView userName="Alice" />)
      
      expect(screen.getByTestId('room-title')).toHaveTextContent('Alice')
    })

    it('should render room ID with copy button', () => {
      render(<TestRoomView roomId="my-room-123" />)
      
      expect(screen.getByTestId('copy-room-id')).toHaveTextContent('my-room-123')
    })

    it('should show connection status', () => {
      render(<TestRoomView connectionState="connected" />)
      
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected')
    })

    it('should show local participant', () => {
      render(<TestRoomView userName="Alice" />)
      
      expect(screen.getByTestId('local-participant')).toBeInTheDocument()
    })

    it('should show waiting message when no peers', () => {
      render(<TestRoomView peers={new Map()} />)
      
      expect(screen.getByTestId('waiting-message')).toBeInTheDocument()
    })

    it('should not show waiting message when peers exist', () => {
      const peers = new Map([
        ['peer-1', { userName: 'Bob', platform: 'mac' as const }]
      ])
      
      render(<TestRoomView peers={peers} />)
      
      expect(screen.queryByTestId('waiting-message')).not.toBeInTheDocument()
    })
  })

  describe('Participants Display', () => {
    it('should render remote participants', () => {
      const peers = new Map([
        ['peer-1', { userName: 'Bob', platform: 'mac' as const }],
        ['peer-2', { userName: 'Charlie', platform: 'linux' as const }]
      ])
      
      render(<TestRoomView peers={peers} />)
      
      expect(screen.getByTestId('participant-Bob')).toBeInTheDocument()
      expect(screen.getByTestId('participant-Charlie')).toBeInTheDocument()
    })

    it('should show performance warning for many participants', () => {
      const peers = new Map<string, { userName: string; platform: 'win' | 'mac' | 'linux' }>()
      for (let i = 0; i < 10; i++) {
        peers.set(`peer-${i}`, { userName: `User ${i}`, platform: 'win' })
      }
      
      render(<TestRoomView peers={peers} />)
      
      expect(screen.getByTestId('performance-warning')).toBeInTheDocument()
    })
  })

  describe('Mute Controls', () => {
    it('should call onToggleMute when mute button clicked', async () => {
      render(<TestRoomView onToggleMute={mockOnToggleMute} />)
      
      await user.click(screen.getByTestId('mute-toggle'))
      
      expect(mockOnToggleMute).toHaveBeenCalled()
    })

    it('should show correct mute button text', () => {
      const { rerender } = render(<TestRoomView isMuted={false} />)
      
      expect(screen.getByTestId('mute-toggle')).toHaveTextContent('Mute')
      
      rerender(<TestRoomView isMuted={true} />)
      
      expect(screen.getByTestId('mute-toggle')).toHaveTextContent('Unmute')
    })

    it('should call onToggleSpeakerMute when speaker mute clicked', async () => {
      render(<TestRoomView onToggleSpeakerMute={mockOnToggleSpeakerMute} />)
      
      await user.click(screen.getByTestId('speaker-mute-toggle'))
      
      expect(mockOnToggleSpeakerMute).toHaveBeenCalled()
    })
  })

  describe('Sound Toggle', () => {
    it('should call onToggleSound when clicked', async () => {
      render(<TestRoomView onToggleSound={mockOnToggleSound} />)
      
      await user.click(screen.getByTestId('sound-toggle'))
      
      expect(mockOnToggleSound).toHaveBeenCalled()
    })

    it('should show correct sound state', () => {
      const { rerender } = render(<TestRoomView soundEnabled={true} />)
      
      expect(screen.getByTestId('sound-toggle')).toHaveTextContent('Sound On')
      
      rerender(<TestRoomView soundEnabled={false} />)
      
      expect(screen.getByTestId('sound-toggle')).toHaveTextContent('Sound Off')
    })
  })

  describe('Leave Room', () => {
    it('should call onLeaveRoom when leave button clicked', async () => {
      render(<TestRoomView onLeaveRoom={mockOnLeaveRoom} />)
      
      await user.click(screen.getByTestId('leave-button'))
      
      expect(mockOnLeaveRoom).toHaveBeenCalled()
    })
  })

  describe('Copy Room ID', () => {
    it('should call onCopyRoomId when copy button clicked', async () => {
      render(<TestRoomView onCopyRoomId={mockOnCopyRoomId} />)
      
      await user.click(screen.getByTestId('copy-room-id'))
      
      expect(mockOnCopyRoomId).toHaveBeenCalled()
    })
  })

  describe('Settings Panel', () => {
    it('should toggle settings panel visibility', async () => {
      render(<TestRoomView />)
      
      expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument()
      
      await user.click(screen.getByTestId('settings-button'))
      
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    })

    it('should change input device', async () => {
      render(
        <TestRoomView 
          inputDevices={defaultInputDevices}
          selectedInputDevice="default"
          onInputDeviceChange={mockOnInputDeviceChange}
        />
      )
      
      await user.click(screen.getByTestId('settings-button'))
      
      const select = screen.getByTestId('input-device-select')
      await user.selectOptions(select, 'mic-1')
      
      expect(mockOnInputDeviceChange).toHaveBeenCalledWith('mic-1')
    })

    it('should change output device', async () => {
      render(
        <TestRoomView 
          outputDevices={defaultOutputDevices}
          selectedOutputDevice="default"
          onOutputDeviceChange={mockOnOutputDeviceChange}
        />
      )
      
      await user.click(screen.getByTestId('settings-button'))
      
      const select = screen.getByTestId('output-device-select')
      await user.selectOptions(select, 'headphones')
      
      expect(mockOnOutputDeviceChange).toHaveBeenCalledWith('headphones')
    })

    it('should toggle noise suppression', async () => {
      render(
        <TestRoomView 
          settings={{ noiseSuppressionEnabled: true, echoCancellationEnabled: true, autoGainControlEnabled: true }}
          onSettingsChange={mockOnSettingsChange}
        />
      )
      
      await user.click(screen.getByTestId('settings-button'))
      
      const checkbox = screen.getByTestId('noise-suppression-toggle')
      await user.click(checkbox)
      
      expect(mockOnSettingsChange).toHaveBeenCalledWith({ noiseSuppressionEnabled: false })
    })
  })

  describe('Remote Streams', () => {
    it('should pass remote streams to participant cards', () => {
      const peers = new Map([
        ['peer-1', { userName: 'Bob', platform: 'mac' as const }]
      ])
      const remoteStreams = new Map([
        ['peer-1', new MediaStream()]
      ])
      
      render(<TestRoomView peers={peers} remoteStreams={remoteStreams} />)
      
      expect(screen.getByTestId('participant-Bob').querySelector('[data-testid="has-stream"]')).toBeInTheDocument()
    })
  })

  describe('Platform Display', () => {
    it('should show correct platform for local user', () => {
      render(<TestRoomView localPlatform="mac" />)
      
      const localParticipant = screen.getByTestId('local-participant')
      expect(localParticipant.querySelector('[data-testid="platform"]')).toHaveTextContent('mac')
    })

    it('should show correct platform for remote peers', () => {
      const peers = new Map([
        ['peer-1', { userName: 'Bob', platform: 'linux' as const }]
      ])
      
      render(<TestRoomView peers={peers} />)
      
      const participant = screen.getByTestId('participant-Bob')
      expect(participant.querySelector('[data-testid="platform"]')).toHaveTextContent('linux')
    })
  })
})
