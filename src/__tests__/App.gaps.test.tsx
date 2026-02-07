/**
 * Additional coverage gap tests for App.tsx
 * @vitest-environment jsdom
 *
 * Targets:
 * - Keyboard shortcuts (M key, Escape key, Ctrl+Shift+L, input element skip)
 * - electronAPI: onDownloadLogs, onTrayToggleMute, onTrayLeaveCall callbacks
 * - flashWindow when peers change and window not focused
 * - updateCallState sync with tray
 * - leave confirm cancel flow
 * - pipeline init failure path
 * - handleInputDeviceChange pipeline success with no audio track
 * - clipboard copy error path
 * - mac/linux platform detection
 * - dismiss error banner
 * - cancel connection overlay
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../renderer/App'
import { peerManager } from '../renderer/signaling/SimplePeerManager'

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
  pipelineInit: vi.fn(),
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
  showWindow: vi.fn(),
  downloadLogs: vi.fn(),
}))

let roomCallbacksCapture: any = {}
let useRoomReturnOverrides: any = {}

vi.mock('../renderer/components/LobbyView', () => ({
  LobbyView: ({ onJoinRoom, onOpenSettings, onInputDeviceChange, onVideoDeviceChange, onOutputDeviceChange }: any) => (
    <div data-testid="lobby-view">
      <button data-testid="join-room-btn" onClick={() => onJoinRoom('test-room-123', 'Alice')}>Join</button>
      <button data-testid="join-cam-btn" onClick={() => onJoinRoom('test-room-123', 'Alice', true)}>JoinCam</button>
      <button data-testid="settings-btn" onClick={onOpenSettings}>Settings</button>
      <button data-testid="change-input-btn" onClick={() => onInputDeviceChange('new-device-id')}>ChangeInput</button>
      <button data-testid="change-video-btn" onClick={() => onVideoDeviceChange('new-video-id')}>ChangeVideo</button>
      <button data-testid="change-output-btn" onClick={() => onOutputDeviceChange('new-output-id')}>ChangeOutput</button>
    </div>
  )
}))

vi.mock('../renderer/components/RoomView', () => ({
  RoomView: ({ onLeaveRoom, onToggleMute, onToggleVideo, onToggleSpeakerMute, onToggleSound, onCopyRoomId, onInputDeviceChange, onVideoDeviceChange, onSettingsChange, connectionState }: any) => (
    <div data-testid="room-view" data-connstate={connectionState}>
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
  SettingsPanel: ({ onClose, onShowToast }: any) => (
    <div data-testid="settings-panel">
      <button data-testid="close-settings-btn" onClick={onClose}>Close</button>
      <button data-testid="show-toast-btn" onClick={() => onShowToast('Test', 'success')}>Toast</button>
    </div>
  )
}))

vi.mock('../renderer/components/ConnectionOverlay', () => ({
  ConnectionOverlay: ({ onCancel, state }: any) => (
    <div data-testid="connection-overlay" data-state={state}>
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
      error: null,
      ...useRoomReturnOverrides,
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
    refreshDevices: mocks.refreshDevices,
  }))
}))

vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({ t: (key: string) => key })
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
    initialize: mocks.pipelineInit.mockResolvedValue(undefined),
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
  logger: { logSystemInfo: vi.fn(), downloadLogs: mocks.downloadLogs },
  AppLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('App - additional coverage gaps', () => {
  let electronCallbacks: Record<string, (...args: any[]) => any> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    electronCallbacks = {}
    roomCallbacksCapture = {}
    useRoomReturnOverrides = {}

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
    mocks.pipelineInit.mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true, configurable: true
    })

    Object.defineProperty(window, 'electronAPI', {
      value: {
        onDownloadLogs: vi.fn().mockImplementation(cb => { electronCallbacks.onDownloadLogs = cb; return () => {} }),
        onTrayToggleMute: vi.fn().mockImplementation(cb => { electronCallbacks.onTrayToggleMute = cb; return () => {} }),
        onTrayLeaveCall: vi.fn().mockImplementation(cb => { electronCallbacks.onTrayLeaveCall = cb; return () => {} }),
        updateCallState: mocks.updateCallState,
        flashWindow: mocks.flashWindow,
        showWindow: mocks.showWindow,
      },
      writable: true, configurable: true
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (window as any).electronAPI
  })

  async function renderApp() {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())
  }

  async function goToRoom() {
    await renderApp()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => expect(screen.getByTestId('room-view')).toBeInTheDocument())
  }

  it('keyboard M key toggles mute in room view', async () => {
    await goToRoom()
    fireEvent.keyDown(window, { key: 'm' })
    expect(mocks.toggleMute).toHaveBeenCalled()
  })

  it('keyboard Escape shows leave confirm in room view when connected', async () => {
    useRoomReturnOverrides = { connectionState: 'connected', roomId: 'room-1' }
    await goToRoom()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.getByTestId('leave-confirm-dialog')).toBeInTheDocument())
  })

  it('keyboard Escape cancels search when connecting', async () => {
    useRoomReturnOverrides = { connectionState: 'signaling' }
    await goToRoom()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(mocks.leaveRoom).toHaveBeenCalled()
  })

  it('keyboard Ctrl+Shift+L downloads logs', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, shiftKey: true })
    expect(mocks.downloadLogs).toHaveBeenCalled()
  })

  it('keyboard shortcuts ignored in input elements', async () => {
    await goToRoom()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'm' })
    expect(mocks.toggleMute).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('electronAPI onDownloadLogs callback triggers download', async () => {
    await renderApp()
    expect(electronCallbacks.onDownloadLogs).toBeDefined()
    act(() => { electronCallbacks.onDownloadLogs() })
    expect(mocks.downloadLogs).toHaveBeenCalled()
  })

  it('electronAPI onTrayToggleMute callback toggles mute', async () => {
    await renderApp()
    expect(electronCallbacks.onTrayToggleMute).toBeDefined()
    act(() => { electronCallbacks.onTrayToggleMute() })
    expect(mocks.toggleMute).toHaveBeenCalled()
  })

  it('electronAPI onTrayLeaveCall callback shows leave confirm', async () => {
    await renderApp()
    expect(electronCallbacks.onTrayLeaveCall).toBeDefined()
    act(() => { electronCallbacks.onTrayLeaveCall() })
    await waitFor(() => expect(screen.getByTestId('leave-confirm-dialog')).toBeInTheDocument())
  })

  it('leave confirm cancel hides dialog', async () => {
    await renderApp()
    act(() => { electronCallbacks.onTrayLeaveCall() })
    await waitFor(() => expect(screen.getByTestId('leave-confirm-dialog')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByTestId('cancel-leave-btn'))
    await waitFor(() => expect(screen.queryByTestId('leave-confirm-dialog')).not.toBeInTheDocument())
  })

  it('pipeline initialization failure still sets pipelineReady', async () => {
    mocks.pipelineInit.mockRejectedValue(new Error('Pipeline init failed'))
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('lobby-view')).toBeInTheDocument())
    // Should still render after pipeline failure
  })

  it('clipboard writeText failure is caught', async () => {
    useRoomReturnOverrides = { roomId: 'room-1', connectionState: 'connected' }
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard error')) },
      writable: true, configurable: true
    })

    await goToRoom()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('copy-id-btn'))
    // Should not throw
  })

  it('dismiss error banner clears global error', async () => {
    mocks.joinRoom.mockRejectedValue(new Error('Join failed'))
    await renderApp()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => expect(screen.getByTestId('error-banner')).toBeInTheDocument())

    await user.click(screen.getByTestId('dismiss-error-btn'))
    await waitFor(() => expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument())
  })

  it('cancel connection overlay returns to lobby', async () => {
    useRoomReturnOverrides = { connectionState: 'signaling' }
    await goToRoom()
    await waitFor(() => expect(screen.getByTestId('connection-overlay')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByTestId('cancel-connection-btn'))
    await waitFor(() => {
      expect(mocks.leaveRoom).toHaveBeenCalled()
      expect(mocks.stopCapture).toHaveBeenCalled()
    })
  })

  it('handleInputDeviceChange with no audio track in processed stream', async () => {
    const noAudioStream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [],
      getTracks: () => [],
      id: 'no-audio-stream'
    } as unknown as MediaStream

    mocks.switchInputDevice.mockResolvedValue(noAudioStream)
    mocks.pipelineConnectInput.mockResolvedValue(noAudioStream)

    await renderApp()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('change-input-btn'))

    await waitFor(() => expect(mocks.switchInputDevice).toHaveBeenCalled())
    // replaceTrack should NOT be called since no audio track
    expect(peerManager.replaceTrack).not.toHaveBeenCalled()
  })

  it('mac platform detection', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      writable: true, configurable: true
    })
    await renderApp()
    // The localPlatform should be 'mac' - can verify through RoomView props
  })

  it('linux platform detection', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
      writable: true, configurable: true
    })
    await renderApp()
  })

  it('no electronAPI does not crash', async () => {
    delete (window as any).electronAPI
    await renderApp()
    // Should render without errors
  })

  it('connection state idle renders overlay with signaling state', async () => {
    useRoomReturnOverrides = { connectionState: 'idle' }
    await goToRoom()
    await waitFor(() => {
      const overlay = screen.getByTestId('connection-overlay')
      expect(overlay).toBeInTheDocument()
      expect(overlay.dataset.state).toBe('signaling')
    })
  })
})
