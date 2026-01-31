/**
 * Tests for App.tsx main component
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../renderer/App'
import { peerManager } from '../renderer/signaling/SimplePeerManager'
import { logger } from '../renderer/utils/Logger'

// Hoist mocks to ensure they are available in vi.mock factories
const mocks = vi.hoisted(() => ({
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  startCapture: vi.fn(),
  stopCapture: vi.fn(),
  toggleMute: vi.fn(),
  switchInputDevice: vi.fn(),
  pipelineSetNS: vi.fn(),
  pipelineConnectInput: vi.fn(),

  // Electron mocks
  onDownloadLogs: vi.fn(),
  onTrayToggleMute: vi.fn(),
  onTrayLeaveCall: vi.fn(),
  updateCallState: vi.fn(),
  flashWindow: vi.fn(),
  showWindow: vi.fn()
}))

// --- Mocks for Child Components ---
vi.mock('../renderer/components/LobbyView', () => ({
  LobbyView: ({ onJoinRoom, onOpenSettings, onInputDeviceChange }: any) => (
    <div data-testid="lobby-view">
      <button data-testid="join-room-btn" onClick={() => onJoinRoom('test-room-123', 'Alice')}>Join</button>
      <button data-testid="settings-btn" onClick={onOpenSettings}>Settings</button>
      <button data-testid="change-input-btn" onClick={() => onInputDeviceChange('new-device-id')}>Change Input</button>
    </div>
  )
}))

vi.mock('../renderer/components/RoomView', () => ({
  RoomView: ({ onLeaveRoom, onToggleMute, onToggleSound, onCopyRoomId }: any) => (
    <div data-testid="room-view">
      <button data-testid="leave-room-btn" onClick={onLeaveRoom}>Leave</button>
      <button data-testid="toggle-mute-btn" onClick={onToggleMute}>Mute</button>
      <button data-testid="toggle-sound-btn" onClick={onToggleSound}>Sound</button>
      <button data-testid="copy-id-btn" onClick={onCopyRoomId}>Copy ID</button>
    </div>
  )
}))

vi.mock('../renderer/components/SettingsPanel', () => ({
  SettingsPanel: ({ onClose, onSettingsChange }: any) => (
    <div data-testid="settings-panel">
      <button data-testid="close-settings-btn" onClick={onClose}>Close</button>
      <button data-testid="change-setting-btn" onClick={() => onSettingsChange({ noiseSuppressionEnabled: false })}>Disable NS</button>
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
    <div data-testid="error-banner">
      {message}
      <button data-testid="dismiss-error-btn" onClick={onDismiss}>Dismiss</button>
    </div>
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
    <div data-testid="toast-notification">
      {message}
      <button data-testid="dismiss-toast-btn" onClick={onDismiss}>X</button>
    </div>
  )
}))

// --- Mocks for Hooks & Services ---

vi.mock('../renderer/hooks/useRoom', () => ({
  useRoom: vi.fn().mockImplementation(() => ({
    roomId: null,
    peers: new Map(),
    localPeerId: 'local-peer-123',
    connectionState: 'idle',
    joinRoom: mocks.joinRoom,
    leaveRoom: mocks.leaveRoom,
    error: null
  }))
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
    switchVideoDevice: vi.fn(),
    selectOutputDevice: vi.fn(),
    toggleMute: mocks.toggleMute,
    toggleVideo: vi.fn(),
    refreshDevices: vi.fn()
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
    disconnect: vi.fn(),
    destroy: vi.fn(),
    setNoiseSuppression: mocks.pipelineSetNS,
    getNoiseSuppressionStatus: vi.fn().mockReturnValue({ enabled: true, active: true, wasmReady: true })
  })
}))

vi.mock('../renderer/audio-processor/SoundManager', () => ({
  soundManager: {
    playJoin: vi.fn(),
    playLeave: vi.fn(),
    playConnected: vi.fn(),
    playError: vi.fn(),
    playClick: vi.fn(),
    setEnabled: vi.fn(),
    destroy: vi.fn()
  }
}))

vi.mock('../renderer/utils/Logger', () => ({
  logger: {
    logSystemInfo: vi.fn(),
    downloadLogs: vi.fn()
  },
  AppLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('App Integration', () => {
  let user: ReturnType<typeof userEvent.setup>
  let electronCallbacks: Record<string, Function> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup()
    electronCallbacks = {}

    // Create a mock stream with audio tracks
    const mockStream = {
      getAudioTracks: () => [{ id: 'track-1', kind: 'audio', label: 'Test Track', enabled: true, muted: false }],
      getTracks: () => [{ id: 'track-1', kind: 'audio', label: 'Test Track', enabled: true, muted: false }],
      id: 'stream-1'
    } as unknown as MediaStream

    // Reset default mock implementations
    mocks.joinRoom.mockResolvedValue(undefined)
    mocks.startCapture.mockResolvedValue(mockStream)
    mocks.switchInputDevice.mockResolvedValue(mockStream)
    mocks.pipelineConnectInput.mockResolvedValue(mockStream)

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true
    })

    Object.defineProperty(window, 'electronAPI', {
      value: {
        onDownloadLogs: vi.fn().mockImplementation(cb => { electronCallbacks.onDownloadLogs = cb; return () => { } }),
        onTrayToggleMute: vi.fn().mockImplementation(cb => { electronCallbacks.onTrayToggleMute = cb; return () => { } }),
        onTrayLeaveCall: vi.fn().mockImplementation(cb => { electronCallbacks.onTrayLeaveCall = cb; return () => { } }),
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
    // @ts-ignore
    delete window.electronAPI
  })

  it('renders lobby by default after initialization', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByTestId('lobby-view')).toBeInTheDocument()
    })
  })

  it('shows settings and changes settings', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())

    await user.click(screen.getByTestId('settings-btn'))
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeInTheDocument())

    await user.click(screen.getByTestId('change-setting-btn'))
    expect(mocks.pipelineSetNS).toHaveBeenCalledWith(false)

    await user.click(screen.getByTestId('close-settings-btn'))
    expect(screen.getByTestId('lobby-view')).toBeInTheDocument()
  })

  it('handles full join room flow', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())

    await user.click(screen.getByTestId('join-room-btn'))

    await waitFor(() => {
      expect(mocks.startCapture).toHaveBeenCalled()
      expect(mocks.pipelineConnectInput).toHaveBeenCalled()
      expect(mocks.joinRoom).toHaveBeenCalledWith('test-room-123', 'Alice')
    })

    expect(screen.getByTestId('room-view')).toBeInTheDocument()
  })

  it('handles input device change from lobby', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())

    await user.click(screen.getByTestId('change-input-btn'))

    expect(mocks.switchInputDevice).toHaveBeenCalledWith('new-device-id')
    // We expect pipeline reconnection
    await waitFor(() => {
      expect(mocks.pipelineConnectInput).toHaveBeenCalled()
      expect(peerManager.replaceTrack).toHaveBeenCalled()
    })
  })

  describe('Keyboard Shortcuts', () => {
    it('toggles mute with M key in room', async () => {
      render(<App />)
      // Enter room
      await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())
      await user.click(screen.getByTestId('join-room-btn'))
      await waitFor(() => expect(screen.getByTestId('room-view')).toBeInTheDocument())

      await user.keyboard('m')
      expect(mocks.toggleMute).toHaveBeenCalled()
    })

    it('shows leave confirmation with Escape key in room', async () => {
      render(<App />)
      await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())
      await user.click(screen.getByTestId('join-room-btn'))
      await waitFor(() => expect(screen.getByTestId('room-view')).toBeInTheDocument())

      await user.keyboard('{Escape}')
      expect(screen.getByTestId('leave-confirm-dialog')).toBeInTheDocument()

      await user.click(screen.getByTestId('cancel-leave-btn'))
      expect(screen.queryByTestId('leave-confirm-dialog')).not.toBeInTheDocument()
    })

    it('downloads logs with Ctrl+Shift+L', async () => {
      render(<App />)
      await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())

      // userEvent keyboard combination
      await user.keyboard('{Control>}{Shift>}l{/Shift}{/Control}')
      expect(logger.downloadLogs).toHaveBeenCalled()
    })

    it('does not trigger shortcuts when typing in inputs', async () => {
      render(<App />)
      await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      await user.keyboard('{Control>}{Shift>}l{/Shift}{/Control}')
      expect(logger.downloadLogs).not.toHaveBeenCalled()

      document.body.removeChild(input)
    })
  })

  describe('Electron IPC Events', () => {
    it('handles download-logs event', async () => {
      render(<App />)
      await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())

      // trigger event manually
      act(() => {
        electronCallbacks.onDownloadLogs()
      })

      expect(logger.downloadLogs).toHaveBeenCalled()
      expect(screen.getByTestId('toast-notification')).toBeInTheDocument()
    })

    it('handles tray mute toggle', async () => {
      render(<App />)
      await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())
      // Enter room for context
      await user.click(screen.getByTestId('join-room-btn'))
      await waitFor(() => expect(screen.getByTestId('room-view')).toBeInTheDocument())

      act(() => {
        electronCallbacks.onTrayToggleMute()
      })

      expect(mocks.toggleMute).toHaveBeenCalled()
    })

    it('handles tray leave call', async () => {
      render(<App />)
      await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())

      act(() => {
        electronCallbacks.onTrayLeaveCall()
      })

      expect(screen.getByTestId('leave-confirm-dialog')).toBeInTheDocument()
      expect(mocks.showWindow).toHaveBeenCalled()
    })
  })
})
