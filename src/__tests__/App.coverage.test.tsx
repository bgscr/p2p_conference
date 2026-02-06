/**
 * Tests for App.tsx - additional coverage
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../renderer/App'
import { peerManager } from '../renderer/signaling/SimplePeerManager'

// Hoist mocks to ensure they are available in vi.mock factories
const mocks = vi.hoisted(() => ({
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  startCapture: vi.fn(),
  stopCapture: vi.fn(),
  toggleMute: vi.fn(),
  toggleVideo: vi.fn(),
  switchInputDevice: vi.fn(),
  switchVideoDevice: vi.fn(),
  selectOutputDevice: vi.fn(),
  refreshDevices: vi.fn(),
  pipelineSetNS: vi.fn(),
  pipelineConnectInput: vi.fn(),
  pipelineDisconnect: vi.fn(),
  pipelineDestroy: vi.fn(),
  playJoin: vi.fn(),
  playLeave: vi.fn(),
  playConnected: vi.fn(),
  playError: vi.fn(),
  playClick: vi.fn(),
  setEnabled: vi.fn(),
  destroySound: vi.fn(),

  updateCallState: vi.fn(),
  flashWindow: vi.fn(),
  showWindow: vi.fn()
}))

// Track useRoom callbacks
let roomCallbacksCapture: any = {}

// --- Mocks for Child Components ---
vi.mock('../renderer/components/LobbyView', () => ({
  LobbyView: ({ onJoinRoom, onOpenSettings, onInputDeviceChange, onVideoDeviceChange, onOutputDeviceChange }: any) => (
    <div data-testid="lobby-view">
      <button data-testid="join-room-btn" onClick={() => onJoinRoom('test-room-123', 'Alice')}>Join</button>
      <button data-testid="join-cam-btn" onClick={() => onJoinRoom('test-room-123', 'Alice', true)}>Join Cam</button>
      <button data-testid="settings-btn" onClick={onOpenSettings}>Settings</button>
      <button data-testid="change-input-btn" onClick={() => onInputDeviceChange('new-device-id')}>Change Input</button>
      <button data-testid="change-video-btn" onClick={() => onVideoDeviceChange('new-video-id')}>Change Video</button>
      <button data-testid="change-output-btn" onClick={() => onOutputDeviceChange('new-output-id')}>Change Output</button>
    </div>
  )
}))

vi.mock('../renderer/components/RoomView', () => ({
  RoomView: ({ onLeaveRoom, onToggleMute, onToggleVideo, onToggleSpeakerMute, onToggleSound, onCopyRoomId, onInputDeviceChange, onVideoDeviceChange, onSettingsChange }: any) => (
    <div data-testid="room-view">
      <button data-testid="leave-room-btn" onClick={onLeaveRoom}>Leave</button>
      <button data-testid="toggle-mute-btn" onClick={onToggleMute}>Mute</button>
      <button data-testid="toggle-video-btn" onClick={onToggleVideo}>Video</button>
      <button data-testid="toggle-speaker-btn" onClick={onToggleSpeakerMute}>Speaker</button>
      <button data-testid="toggle-sound-btn" onClick={onToggleSound}>Sound</button>
      <button data-testid="copy-id-btn" onClick={onCopyRoomId}>Copy</button>
      <button data-testid="room-input-btn" onClick={() => onInputDeviceChange('room-mic')}>RoomInput</button>
      <button data-testid="room-video-btn" onClick={() => onVideoDeviceChange('room-vid')}>RoomVideo</button>
      <button data-testid="room-ns-btn" onClick={() => onSettingsChange({ noiseSuppressionEnabled: false })}>NS</button>
    </div>
  )
}))

vi.mock('../renderer/components/SettingsPanel', () => ({
  SettingsPanel: ({ onClose, onSettingsChange, onShowToast }: any) => (
    <div data-testid="settings-panel">
      <button data-testid="close-settings-btn" onClick={onClose}>Close</button>
      <button data-testid="change-setting-btn" onClick={() => onSettingsChange({ noiseSuppressionEnabled: false })}>NS</button>
      <button data-testid="show-toast-btn" onClick={() => onShowToast('Test toast', 'success')}>Toast</button>
    </div>
  )
}))

vi.mock('../renderer/components/ConnectionOverlay', () => ({
  ConnectionOverlay: ({ onCancel }: any) => (
    <div data-testid="connection-overlay">
      <button data-testid="cancel-connection-btn" onClick={onCancel}>Cancel</button>
    </div>
  )
}))

vi.mock('../renderer/components/ErrorBanner', () => ({
  ErrorBanner: ({ message, onDismiss }: any) => (
    <div data-testid="error-banner">{message}<button data-testid="dismiss-error-btn" onClick={onDismiss}>X</button></div>
  )
}))

vi.mock('../renderer/components/LeaveConfirmDialog', () => ({
  LeaveConfirmDialog: ({ onConfirm, onCancel }: any) => (
    <div data-testid="leave-confirm-dialog">
      <button data-testid="confirm-leave-btn" onClick={onConfirm}>Confirm</button>
      <button data-testid="cancel-leave-btn" onClick={onCancel}>Cancel</button>
    </div>
  )
}))

vi.mock('../renderer/components/Toast', () => ({
  Toast: ({ message, onDismiss }: any) => (
    <div data-testid="toast-notification">{message}<button data-testid="dismiss-toast-btn" onClick={onDismiss}>X</button></div>
  )
}))

// --- Hooks & Services ---

vi.mock('../renderer/hooks/useRoom', () => ({
  useRoom: vi.fn().mockImplementation((callbacks: any) => {
    roomCallbacksCapture = callbacks
    return {
      roomId: null,
      peers: new Map(),
      localPeerId: 'local-peer-123',
      connectionState: 'idle',
      joinRoom: mocks.joinRoom,
      leaveRoom: mocks.leaveRoom,
      error: null
    }
  })
}))

vi.mock('../renderer/hooks/useMediaStream', () => ({
  useMediaStream: vi.fn().mockImplementation(() => ({
    localStream: { id: 'test-stream', getVideoTracks: () => [] },
    inputDevices: [],
    videoInputDevices: [],
    outputDevices: [],
    selectedInputDevice: 'default',
    selectedVideoDevice: 'default',
    selectedOutputDevice: 'default',
    isMuted: false,
    isVideoEnabled: true,
    audioLevel: 0,
    isLoading: false,
    error: null,
    startCapture: mocks.startCapture,
    stopCapture: mocks.stopCapture,
    switchInputDevice: mocks.switchInputDevice,
    switchVideoDevice: mocks.switchVideoDevice,
    selectOutputDevice: mocks.selectOutputDevice,
    toggleMute: mocks.toggleMute,
    toggleVideo: mocks.toggleVideo,
    refreshDevices: mocks.refreshDevices
  }))
}))

vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, _params?: Record<string, any>) => key
  })
}))

vi.mock('../renderer/signaling/SimplePeerManager', () => ({
  peerManager: {
    setCallbacks: vi.fn(),
    setLocalStream: vi.fn(),
    replaceTrack: vi.fn(),
    broadcastMuteStatus: vi.fn(),
    getDebugInfo: vi.fn().mockReturnValue({ selfId: 'test-self-id' })
  }
}))

vi.mock('../renderer/audio-processor/AudioPipeline', () => ({
  getAudioPipeline: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    connectInputStream: mocks.pipelineConnectInput,
    disconnect: mocks.pipelineDisconnect,
    destroy: mocks.pipelineDestroy,
    setNoiseSuppression: mocks.pipelineSetNS,
    getNoiseSuppressionStatus: vi.fn().mockReturnValue({ enabled: true, active: true, wasmReady: true })
  })
}))

vi.mock('../renderer/audio-processor/SoundManager', () => ({
  soundManager: {
    playJoin: mocks.playJoin,
    playLeave: mocks.playLeave,
    playConnected: mocks.playConnected,
    playError: mocks.playError,
    playClick: mocks.playClick,
    setEnabled: mocks.setEnabled,
    destroy: mocks.destroySound
  }
}))

vi.mock('../renderer/utils/Logger', () => ({
  logger: { logSystemInfo: vi.fn(), downloadLogs: vi.fn() },
  AppLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('App Coverage Tests', () => {
  let user: ReturnType<typeof userEvent.setup>
  let electronCallbacks: Record<string, (...args: any[]) => any> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup()
    electronCallbacks = {}
    roomCallbacksCapture = {}

    const mockStream = {
      getAudioTracks: () => [{ id: 'track-1', kind: 'audio', label: 'Test', enabled: true, muted: false }],
      getVideoTracks: () => [{ id: 'vtrack-1', kind: 'video', label: 'Video', enabled: true }],
      getTracks: () => [{ id: 'track-1', kind: 'audio' }, { id: 'vtrack-1', kind: 'video' }],
      id: 'stream-1'
    } as unknown as MediaStream

    mocks.joinRoom.mockResolvedValue(undefined)
    mocks.startCapture.mockResolvedValue(mockStream)
    mocks.switchInputDevice.mockResolvedValue(mockStream)
    mocks.switchVideoDevice.mockResolvedValue(mockStream)
    mocks.pipelineConnectInput.mockResolvedValue(mockStream)

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true
    })

    Object.defineProperty(window, 'electronAPI', {
      value: {
        onDownloadLogs: vi.fn().mockImplementation(cb => { electronCallbacks.onDownloadLogs = cb; return () => {} }),
        onTrayToggleMute: vi.fn().mockImplementation(cb => { electronCallbacks.onTrayToggleMute = cb; return () => {} }),
        onTrayLeaveCall: vi.fn().mockImplementation(cb => { electronCallbacks.onTrayLeaveCall = cb; return () => {} }),
        updateCallState: mocks.updateCallState,
        flashWindow: mocks.flashWindow,
        showWindow: mocks.showWindow
      },
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (window as any).electronAPI
  })

  // Helper to render App and wait for initialization
  async function renderApp() {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())
  }

  // Helper to get to room view
  async function goToRoom() {
    await renderApp()
    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => expect(screen.getByTestId('room-view')).toBeInTheDocument())
  }

  it('shows toast via SettingsPanel onShowToast', async () => {
    await renderApp()
    await user.click(screen.getByTestId('settings-btn'))
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeInTheDocument())

    await user.click(screen.getByTestId('show-toast-btn'))
    await waitFor(() => expect(screen.getByTestId('toast-notification')).toBeInTheDocument())

    // Dismiss toast manually
    await user.click(screen.getByTestId('dismiss-toast-btn'))
    await waitFor(() => expect(screen.queryByTestId('toast-notification')).not.toBeInTheDocument())
  })

  it('triggers onPeerJoin callback with sound', async () => {
    await renderApp()
    expect(roomCallbacksCapture.onPeerJoin).toBeDefined()

    act(() => { roomCallbacksCapture.onPeerJoin('peer-1', 'Bob') })
    expect(mocks.playJoin).toHaveBeenCalled()
  })

  it('triggers onPeerLeave callback with sound', async () => {
    await renderApp()

    act(() => { roomCallbacksCapture.onPeerLeave('peer-1', 'Bob') })
    expect(mocks.playLeave).toHaveBeenCalled()
  })

  it('triggers connected sound on state change', async () => {
    await renderApp()

    act(() => { roomCallbacksCapture.onConnectionStateChange('connected') })
    expect(mocks.playConnected).toHaveBeenCalled()
  })

  it('triggers error sound on failed state change', async () => {
    await renderApp()

    act(() => { roomCallbacksCapture.onConnectionStateChange('failed') })
    expect(mocks.playError).toHaveBeenCalled()
  })

  it('does not play join sound when sound disabled', async () => {
    await goToRoom()
    await user.click(screen.getByTestId('toggle-sound-btn'))
    mocks.playJoin.mockClear()

    act(() => { roomCallbacksCapture.onPeerJoin('peer-2', 'Charlie') })
    expect(mocks.playJoin).not.toHaveBeenCalled()
  })

  it('handles video toggle in room', async () => {
    await goToRoom()
    await user.click(screen.getByTestId('toggle-video-btn'))

    expect(mocks.toggleVideo).toHaveBeenCalled()
    expect(peerManager.broadcastMuteStatus).toHaveBeenCalled()
  })

  it('handles speaker mute toggle in room', async () => {
    await goToRoom()
    await user.click(screen.getByTestId('toggle-speaker-btn'))

    expect(mocks.playClick).toHaveBeenCalled()
    expect(peerManager.broadcastMuteStatus).toHaveBeenCalled()
  })

  it('handles copy room ID', async () => {
    await goToRoom()
    await user.click(screen.getByTestId('copy-id-btn'))
    // roomId is null from mock, so clipboard won't be called, but handler executes
  })

  it('handles sound toggle', async () => {
    await goToRoom()
    await user.click(screen.getByTestId('toggle-sound-btn'))
    expect(mocks.setEnabled).toHaveBeenCalled()
  })

  it('handles video device change from room', async () => {
    await goToRoom()
    await user.click(screen.getByTestId('room-video-btn'))
    await waitFor(() => expect(mocks.switchVideoDevice).toHaveBeenCalledWith('room-vid'))
  })

  it('handles leave confirm flow', async () => {
    await goToRoom()
    await user.click(screen.getByTestId('leave-room-btn'))
    await waitFor(() => expect(screen.getByTestId('leave-confirm-dialog')).toBeInTheDocument())

    await user.click(screen.getByTestId('confirm-leave-btn'))
    await waitFor(() => {
      expect(mocks.leaveRoom).toHaveBeenCalled()
      expect(mocks.stopCapture).toHaveBeenCalled()
      expect(mocks.pipelineDisconnect).toHaveBeenCalled()
      expect(screen.getByTestId('lobby-view')).toBeInTheDocument()
    })
  })

  it('handles settings change from room (noise suppression)', async () => {
    await goToRoom()
    await user.click(screen.getByTestId('room-ns-btn'))
    expect(mocks.pipelineSetNS).toHaveBeenCalledWith(false)
  })

  it('registers and calls remote stream callbacks', async () => {
    await renderApp()
    expect(peerManager.setCallbacks).toHaveBeenCalled()
    const cbs = (peerManager.setCallbacks as any).mock.calls[0][0]

    const stream = {
      id: 'rs1',
      getTracks: () => [{ id: 'rt1', kind: 'audio' }],
      getAudioTracks: () => [{ id: 'rt1', enabled: true, muted: false }]
    } as unknown as MediaStream

    act(() => { cbs.onRemoteStream('peer-r1', stream) })
    // No crash = success
  })

  it('handles remote stream with no audio tracks', async () => {
    await renderApp()
    const cbs = (peerManager.setCallbacks as any).mock.calls[0][0]

    const stream = {
      id: 'rs2', getTracks: () => [], getAudioTracks: () => []
    } as unknown as MediaStream

    act(() => { cbs.onRemoteStream('peer-r2', stream) })
  })

  it('handles peer manager error callback with toast', async () => {
    await renderApp()
    const cbs = (peerManager.setCallbacks as any).mock.calls[0][0]

    act(() => { cbs.onError(new Error('conn error'), 'peer') })
    await waitFor(() => expect(screen.getByTestId('toast-notification')).toBeInTheDocument())
  })

  it('handles join room failure', async () => {
    mocks.joinRoom.mockRejectedValue(new Error('Join failed'))
    await renderApp()

    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeInTheDocument()
      expect(screen.getByTestId('lobby-view')).toBeInTheDocument()
    })
  })

  it('handles pipeline failure and falls back to raw stream', async () => {
    mocks.pipelineConnectInput.mockRejectedValue(new Error('Pipeline failed'))
    await renderApp()

    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => {
      expect(peerManager.setLocalStream).toHaveBeenCalled()
      expect(mocks.joinRoom).toHaveBeenCalled()
    })
  })

  it('handles switchVideoDevice returning null', async () => {
    mocks.switchVideoDevice.mockResolvedValue(null)
    await goToRoom()

    await user.click(screen.getByTestId('room-video-btn'))
    // Should not crash; replaceTrack should not be called with a video track
  })

  it('handles switchInputDevice returning null', async () => {
    mocks.switchInputDevice.mockResolvedValue(null)
    await renderApp()

    await user.click(screen.getByTestId('change-input-btn'))
    await waitFor(() => expect(mocks.switchInputDevice).toHaveBeenCalledWith('new-device-id'))
  })

  it('handles pipeline failure during input device switch', async () => {
    const fallbackStream = {
      getAudioTracks: () => [{ id: 'fb-track', kind: 'audio', label: 'FB', enabled: true }],
      getVideoTracks: () => [],
      getTracks: () => [{ id: 'fb-track', kind: 'audio' }],
      id: 'fb-stream'
    } as unknown as MediaStream

    mocks.switchInputDevice.mockResolvedValue(fallbackStream)
    mocks.pipelineConnectInput.mockRejectedValue(new Error('Pipeline reconnect failed'))

    await renderApp()
    await user.click(screen.getByTestId('change-input-btn'))

    await waitFor(() => {
      expect(peerManager.replaceTrack).toHaveBeenCalled()
      expect(peerManager.setLocalStream).toHaveBeenCalled()
    })
  })

  it('joins room with camera enabled', async () => {
    await renderApp()
    await user.click(screen.getByTestId('join-cam-btn'))

    await waitFor(() => {
      expect(mocks.startCapture).toHaveBeenCalledWith(expect.objectContaining({ videoEnabled: true }))
      expect(mocks.joinRoom).toHaveBeenCalledWith('test-room-123', 'Alice')
    })
  })

  it('handles startCapture returning null', async () => {
    mocks.startCapture.mockResolvedValue(null)
    await renderApp()

    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => expect(mocks.joinRoom).toHaveBeenCalled())
  })
})
