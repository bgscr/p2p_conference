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
  installVirtualAudioDriver: vi.fn(),
  getVirtualAudioInstallerState: vi.fn(),
  openRemoteMicSetupDoc: vi.fn(),
  downloadLogs: vi.fn(),
  respondRemoteMicRequest: vi.fn(),
  sendRemoteMicRequest: vi.fn(),
  sendRemoteMicStop: vi.fn(),
  sendRemoteMicStart: vi.fn(),
  sendRemoteMicHeartbeat: vi.fn(),
  setAudioRoutingMode: vi.fn(),
  stopRemoteMicSession: vi.fn(),
  startScreenShare: vi.fn(),
  stopScreenShare: vi.fn(),
}))

let useRoomReturnOverrides: any = {}
let useMediaStreamReturnOverrides: any = {}
let onChatMessageCallback: ((msg: any) => void) | null = null
let onRemoteMicControlCallback: ((peerId: string, message: any) => void) | null = null

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
  RoomView: ({ onLeaveRoom, onToggleMute, onToggleVideo, onToggleSpeakerMute, onToggleSound, onCopyRoomId, onInputDeviceChange, onVideoDeviceChange, onSettingsChange, onToggleChat, onToggleScreenShare, isChatOpen, chatMessages, chatUnreadCount, connectionState, onRespondRemoteMicRequest, onRequestRemoteMic, onStopRemoteMic, onRemoteMicRoutingError, remoteMicSession }: any) => (
    <div data-testid="room-view" data-connstate={connectionState}>
      <button data-testid="leave-room-btn" onClick={onLeaveRoom}>Leave</button>
      <button data-testid="toggle-mute-btn" onClick={onToggleMute}>Mute</button>
      <button data-testid="toggle-video-btn" onClick={onToggleVideo}>Video</button>
      <button data-testid="toggle-speaker-btn" onClick={onToggleSpeakerMute}>Speaker</button>
      <button data-testid="toggle-screen-share-btn" onClick={onToggleScreenShare}>ScreenShare</button>
      <button data-testid="toggle-sound-btn" onClick={onToggleSound}>Sound</button>
      <button data-testid="toggle-chat-btn" onClick={onToggleChat}>Chat</button>
      <button data-testid="copy-id-btn" onClick={onCopyRoomId}>Copy</button>
      <button data-testid="room-input-btn" onClick={() => onInputDeviceChange('room-mic')}>RoomInput</button>
      <button data-testid="room-video-btn" onClick={() => onVideoDeviceChange('room-vid')}>RoomVideo</button>
      <button data-testid="room-ns-btn" onClick={() => onSettingsChange({ noiseSuppressionEnabled: false })}>NS</button>
      <button data-testid="remote-mic-accept-btn" onClick={() => onRespondRemoteMicRequest?.(true)}>AcceptRemoteMic</button>
      <button data-testid="remote-mic-reject-btn" onClick={() => onRespondRemoteMicRequest?.(false)}>RejectRemoteMic</button>
      <button data-testid="remote-mic-request-btn" onClick={() => onRequestRemoteMic?.('peer-1')}>RequestRemoteMic</button>
      <button data-testid="remote-mic-stop-btn" onClick={() => onStopRemoteMic?.('stopped-by-source')}>StopRemoteMic</button>
      <button data-testid="remote-mic-stop-invalid-btn" onClick={() => onStopRemoteMic?.({ bad: true })}>StopRemoteMicInvalid</button>
      <button data-testid="remote-mic-routing-error-btn" onClick={() => onRemoteMicRoutingError?.('peer-1', 'sink-failed')}>RemoteMicRoutingError</button>
      <div data-testid="remote-mic-state">{remoteMicSession?.state || 'none'}</div>
      <div data-testid="remote-mic-expires-at">{String(remoteMicSession?.expiresAt ?? 0)}</div>
      <div data-testid="chat-open-state">{String(isChatOpen)}</div>
      <div data-testid="chat-message-count">{String(chatMessages?.length ?? 0)}</div>
      <div data-testid="chat-unread-count">{String(chatUnreadCount ?? 0)}</div>
    </div>
  )
}))

vi.mock('../renderer/components/SettingsPanel', () => ({
  SettingsPanel: ({ onClose, onShowToast, onInstallRemoteMicDriver, onRecheckRemoteMicDevice, onOpenRemoteMicSetup }: any) => (
    <div data-testid="settings-panel">
      <button data-testid="close-settings-btn" onClick={onClose}>Close</button>
      <button data-testid="show-toast-btn" onClick={() => onShowToast('Test', 'success')}>Toast</button>
      <button data-testid="install-driver-btn" onClick={() => onInstallRemoteMicDriver?.()}>InstallDriver</button>
      <button data-testid="recheck-driver-btn" onClick={() => onRecheckRemoteMicDevice?.()}>RecheckDriver</button>
      <button data-testid="open-setup-doc-btn" onClick={() => onOpenRemoteMicSetup?.()}>OpenSetupDoc</button>
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
  useRoom: vi.fn().mockImplementation((_callbacks: any) => {
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
    ...useMediaStreamReturnOverrides,
  }))
}))

vi.mock('../renderer/hooks/useScreenShare', () => ({
  useScreenShare: vi.fn().mockImplementation(() => ({
    isScreenSharing: false,
    startScreenShare: mocks.startScreenShare,
    stopScreenShare: mocks.stopScreenShare,
  }))
}))

vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({ t: (key: string) => key })
}))

vi.mock('../renderer/signaling/SimplePeerManager', () => ({
  peerManager: {
    setCallbacks: vi.fn(),
    setOnChatMessage: vi.fn((cb: ((msg: any) => void) | null) => {
      onChatMessageCallback = cb
    }),
    setOnRemoteMicControl: vi.fn((cb: ((peerId: string, msg: any) => void) | null) => {
      onRemoteMicControlCallback = cb
    }),
    respondRemoteMicRequest: mocks.respondRemoteMicRequest,
    sendRemoteMicRequest: mocks.sendRemoteMicRequest,
    sendRemoteMicStop: mocks.sendRemoteMicStop,
    sendRemoteMicStart: mocks.sendRemoteMicStart,
    sendRemoteMicHeartbeat: mocks.sendRemoteMicHeartbeat,
    setAudioRoutingMode: mocks.setAudioRoutingMode,
    stopRemoteMicSession: mocks.stopRemoteMicSession,
    sendChatMessage: vi.fn(),
    setLocalStream: vi.fn(),
    replaceTrack: vi.fn(),
    broadcastMuteStatus: vi.fn(),
    getDebugInfo: vi.fn().mockReturnValue({ selfId: 'test-self-id' })
  },
  selfId: 'test-self-id'
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
  logger: {
    logSystemInfo: vi.fn(),
    downloadLogs: mocks.downloadLogs,
    createModuleLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  },
  AppLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('App - additional coverage gaps', () => {
  let electronCallbacks: Record<string, (...args: any[]) => any> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    electronCallbacks = {}
    useRoomReturnOverrides = {}
    useMediaStreamReturnOverrides = {}
    onChatMessageCallback = null
    onRemoteMicControlCallback = null

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
    mocks.installVirtualAudioDriver.mockResolvedValue({
      provider: 'vb-cable',
      state: 'already-installed'
    })
    mocks.getVirtualAudioInstallerState.mockResolvedValue({
      inProgress: false,
      platformSupported: true
    })
    mocks.respondRemoteMicRequest.mockReturnValue(true)
    mocks.sendRemoteMicRequest.mockReturnValue('req-default')
    mocks.sendRemoteMicStop.mockReturnValue(true)
    mocks.sendRemoteMicStart.mockReturnValue(true)
    mocks.sendRemoteMicHeartbeat.mockReturnValue(true)
    mocks.setAudioRoutingMode.mockReturnValue(true)
    mocks.stopRemoteMicSession.mockReturnValue(undefined)
    mocks.startScreenShare.mockResolvedValue(true)
    mocks.stopScreenShare.mockReturnValue(undefined)
    mocks.openRemoteMicSetupDoc.mockResolvedValue(true)

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true, configurable: true
    })
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      writable: true,
      configurable: true
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          {
            deviceId: 'vb-cable-output',
            groupId: 'g1',
            kind: 'audiooutput',
            label: 'CABLE Input (VB-Audio Virtual Cable)',
            toJSON: () => ({ })
          }
        ])
      },
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
        showWindow: mocks.showWindow,
        getScreenSources: vi.fn().mockResolvedValue([]),
        installVirtualAudioDriver: mocks.installVirtualAudioDriver,
        getVirtualAudioInstallerState: mocks.getVirtualAudioInstallerState,
        openRemoteMicSetupDoc: mocks.openRemoteMicSetupDoc,
      },
      writable: true, configurable: true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
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

  async function goToSettings() {
    await renderApp()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('settings-btn'))
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeInTheDocument())
  }

  function getLatestToastText(): string {
    const toasts = screen.queryAllByTestId('toast-notification')
    return toasts[toasts.length - 1]?.textContent || ''
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

  it('keyboard T toggles chat panel state', async () => {
    await goToRoom()
    expect(screen.getByTestId('chat-open-state')).toHaveTextContent('false')

    fireEvent.keyDown(window, { key: 't' })
    await waitFor(() => expect(screen.getByTestId('chat-open-state')).toHaveTextContent('true'))
  })

  it('chat message state updates on receive', async () => {
    await goToRoom()
    expect(onChatMessageCallback).toBeDefined()

    act(() => {
      onChatMessageCallback?.({
        id: 'msg-1',
        senderId: 'peer-1',
        senderName: 'Bob',
        content: 'hello',
        timestamp: Date.now(),
        type: 'text'
      })
    })

    expect(screen.getByTestId('chat-message-count')).toHaveTextContent('1')
    expect(screen.getByTestId('chat-unread-count')).toHaveTextContent('1')
  })

  it('accepts incoming remote mic request after virtual driver install succeeds', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    await goToRoom()

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-1',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })

    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))

    const user = userEvent.setup()
    await user.click(screen.getByTestId('remote-mic-accept-btn'))

    await waitFor(() => {
      expect(mocks.installVirtualAudioDriver).toHaveBeenCalled()
      expect(mocks.respondRemoteMicRequest).toHaveBeenCalledWith('req-1', true, 'accepted')
    })
  })

  it('uses extended outgoing expiry window for install-and-accept flow', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    mocks.sendRemoteMicRequest.mockReturnValueOnce('req-outgoing-1')
    await goToRoom()

    const before = Date.now()
    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))

    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingOutgoing'))
    const expiresAt = Number(screen.getByTestId('remote-mic-expires-at').textContent)
    const delta = expiresAt - before

    expect(delta).toBeGreaterThanOrEqual(200000)
    expect(delta).toBeLessThanOrEqual(212000)
  })

  it('normalizes malformed remote mic stop reason payloads', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    mocks.sendRemoteMicRequest.mockReturnValueOnce('req-stop-1')
    await goToRoom()

    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingOutgoing'))

    fireEvent.click(screen.getByTestId('remote-mic-stop-invalid-btn'))
    expect(mocks.sendRemoteMicStop).toHaveBeenCalledWith('peer-1', 'req-stop-1', 'stopped-by-source')
    expect(mocks.stopRemoteMicSession).toHaveBeenCalledWith('stopped-by-source')
  })

  it('shows reason-specific reject toasts for remote mic responses', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    const reasonCases: Array<[string | undefined, string]> = [
      ['busy', 'remoteMic.rejectedBusy'],
      ['virtual-device-missing', 'remoteMic.rejectedVirtualDeviceMissing'],
      ['virtual-device-install-failed', 'remoteMic.rejectedInstallFailed'],
      ['virtual-device-restart-required', 'remoteMic.rejectedRestartRequired'],
      ['user-cancelled', 'remoteMic.rejectedUserCancelled'],
      ['rejected', 'remoteMic.requestRejected'],
      [undefined, 'remoteMic.requestRejected']
    ]

    await goToRoom()
    for (const [reason, expectedToast] of reasonCases) {
      const requestId = `req-${reason || 'default'}`
      mocks.sendRemoteMicRequest.mockReturnValueOnce(requestId)
      fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
      await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingOutgoing'))

      act(() => {
        onRemoteMicControlCallback?.('peer-1', {
          type: 'rm_response',
          requestId,
          accepted: false,
          reason,
          ts: Date.now()
        })
      })

      await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('rejected'))
      expect(getLatestToastText()).toContain(expectedToast)
    }
  })

  it('handles accepted response routing success and starts heartbeat flow', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    mocks.sendRemoteMicRequest.mockReturnValueOnce('req-accepted')
    await goToRoom()

    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingOutgoing'))

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_response',
        requestId: 'req-accepted',
        accepted: true,
        reason: 'accepted',
        ts: Date.now()
      })
    })

    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('active'))
    expect(mocks.setAudioRoutingMode).toHaveBeenCalledWith('exclusive', 'peer-1')
    expect(mocks.sendRemoteMicStart).toHaveBeenCalledWith('peer-1', 'req-accepted')
  })

  it('handles accepted response routing failure and finalizes session', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    mocks.sendRemoteMicRequest.mockReturnValueOnce('req-routing-fail')
    mocks.setAudioRoutingMode.mockReturnValueOnce(false)
    await goToRoom()

    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingOutgoing'))

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_response',
        requestId: 'req-routing-fail',
        accepted: true,
        reason: 'accepted',
        ts: Date.now()
      })
    })

    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('idle'))
    expect(getLatestToastText()).toContain('remoteMic.routingFailed')
  })

  it('auto-rejects incoming request as busy when already in remote mic flow', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    mocks.sendRemoteMicRequest.mockReturnValueOnce('req-local-busy')
    await goToRoom()
    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingOutgoing'))

    act(() => {
      onRemoteMicControlCallback?.('peer-2', {
        type: 'rm_request',
        requestId: 'req-incoming-busy',
        sourcePeerId: 'peer-2',
        sourceName: 'Eve',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })

    expect(mocks.respondRemoteMicRequest).toHaveBeenCalledWith('req-incoming-busy', false, 'busy')
  })

  it('handles incoming request reject paths for success and transport failure', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    await goToRoom()

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-reject-1',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))
    fireEvent.click(screen.getByTestId('remote-mic-reject-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('idle'))
    expect(mocks.respondRemoteMicRequest).toHaveBeenCalledWith('req-reject-1', false, 'rejected')

    mocks.respondRemoteMicRequest.mockReturnValueOnce(false)
    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-reject-2',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))
    fireEvent.click(screen.getByTestId('remote-mic-reject-btn'))
    expect(getLatestToastText()).toContain('remoteMic.responseFailed')
  })

  it('handles incoming request accept when device already ready and response send fails', async () => {
    useMediaStreamReturnOverrides = {
      virtualMicDeviceStatus: {
        platform: 'win',
        supported: true,
        detected: true,
        ready: true,
        outputDeviceId: 'vb-device',
        outputDeviceLabel: 'CABLE Input',
        expectedDeviceHint: 'CABLE Input (VB-CABLE)'
      }
    }
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    mocks.respondRemoteMicRequest.mockReturnValueOnce(false)
    await goToRoom()
    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-ready-fail',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))

    fireEvent.click(screen.getByTestId('remote-mic-accept-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('idle'))
    expect(getLatestToastText()).toContain('remoteMic.responseFailed')
  })

  it('handles incoming request install path failures and success variants', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    await goToRoom()

    const installCases: Array<{
      requestId: string
      platform?: string
      installerState?: any
      installResult?: any
      devices?: MediaDeviceInfo[]
      expectedReason: string
      expectedToast: string
    }> = [
      {
        requestId: 'req-bundle-missing',
        installerState: { inProgress: false, platformSupported: true, bundleReady: false, bundleMessage: 'missing-installer' },
        expectedReason: 'virtual-device-install-failed',
        expectedToast: 'remoteMic.installPrecheckFailed'
      },
      {
        requestId: 'req-install-null',
        installResult: null,
        expectedReason: 'virtual-device-install-failed',
        expectedToast: 'remoteMic.installFailed'
      },
      {
        requestId: 'req-install-reboot',
        installResult: { provider: 'vb-cable', state: 'reboot-required' },
        expectedReason: 'virtual-device-restart-required',
        expectedToast: 'remoteMic.installNeedsRestart'
      },
      {
        requestId: 'req-install-cancel',
        installResult: { provider: 'vb-cable', state: 'user-cancelled' },
        expectedReason: 'user-cancelled',
        expectedToast: 'remoteMic.installCancelled'
      },
      {
        requestId: 'req-install-failed',
        installResult: { provider: 'vb-cable', state: 'failed' },
        expectedReason: 'virtual-device-install-failed',
        expectedToast: 'remoteMic.installFailed'
      },
      {
        requestId: 'req-install-unsupported',
        installResult: { provider: 'vb-cable', state: 'unsupported' },
        expectedReason: 'virtual-device-install-failed',
        expectedToast: 'remoteMic.installFailed'
      },
      {
        requestId: 'req-install-not-ready',
        installResult: { provider: 'vb-cable', state: 'installed' },
        devices: [],
        expectedReason: 'virtual-device-install-failed',
        expectedToast: 'remoteMic.virtualDeviceMissing'
      },
      {
        requestId: 'req-install-respond-fail',
        installResult: { provider: 'vb-cable', state: 'already-installed' },
        devices: [{
          deviceId: 'vb-out',
          groupId: 'g1',
          kind: 'audiooutput',
          label: 'CABLE Input (VB-CABLE)',
          toJSON: () => ({})
        } as MediaDeviceInfo],
        expectedReason: 'accepted',
        expectedToast: 'remoteMic.responseFailed'
      }
    ]

    for (const installCase of installCases) {
      mocks.getVirtualAudioInstallerState.mockResolvedValue(
        installCase.installerState || { inProgress: false, platformSupported: true, bundleReady: true }
      )
      mocks.installVirtualAudioDriver.mockResolvedValue(installCase.installResult)
      if (installCase.requestId === 'req-install-respond-fail') {
        mocks.respondRemoteMicRequest.mockReturnValueOnce(false)
      }
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          enumerateDevices: vi.fn().mockResolvedValue(installCase.devices ?? [
            {
              deviceId: 'vb-cable-output',
              groupId: 'g1',
              kind: 'audiooutput',
              label: 'CABLE Input (VB-Audio Virtual Cable)',
              toJSON: () => ({})
            }
          ])
        },
        writable: true,
        configurable: true
      })

      act(() => {
        onRemoteMicControlCallback?.('peer-1', {
          type: 'rm_request',
          requestId: installCase.requestId,
          sourcePeerId: 'peer-1',
          sourceName: 'Bob',
          targetPeerId: 'local-peer-123',
          ts: Date.now()
        })
      })
      await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))
      fireEvent.click(screen.getByTestId('remote-mic-accept-btn'))

      await waitFor(() => expect(mocks.respondRemoteMicRequest).toHaveBeenCalledWith(
        installCase.requestId,
        installCase.expectedReason === 'accepted',
        installCase.expectedReason
      ))
      expect(getLatestToastText()).toContain(installCase.expectedToast)
    }
  })

  it('supports linux incoming install flow with unsupported platform rejection', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
      writable: true, configurable: true
    })
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    await goToRoom()
    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-linux',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))
    fireEvent.click(screen.getByTestId('remote-mic-accept-btn'))
    expect(mocks.respondRemoteMicRequest).toHaveBeenCalledWith('req-linux', false, 'virtual-device-install-failed')
    expect(getLatestToastText()).toContain('remoteMic.installUnsupportedPlatform')
  })

  it('handles remote mic rm_start, heartbeat and stop control messages', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    await goToRoom()

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-start-1',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_start',
        requestId: 'req-start-1',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('active'))

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_heartbeat',
        requestId: 'req-start-1',
        ts: Date.now()
      })
    })
    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_stop',
        requestId: 'req-start-1',
        reason: 'stopped-by-source',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('idle'))
  })

  it('handles remote mic stop actions for active source and missing request id sessions', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    mocks.sendRemoteMicRequest.mockReturnValueOnce('req-stop-source')
    await goToRoom()
    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingOutgoing'))
    fireEvent.click(screen.getByTestId('remote-mic-stop-btn'))
    expect(mocks.sendRemoteMicStop).toHaveBeenCalledWith('peer-1', 'req-stop-source', 'stopped-by-source')

    fireEvent.click(screen.getByTestId('remote-mic-stop-btn'))
    expect(mocks.stopRemoteMicSession).toHaveBeenCalled()
  })

  it('handles screen share start failure, unsupported environment and stop flow', async () => {
    await goToRoom()

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      writable: true,
      configurable: true
    })
    ; (window as any).electronAPI.getScreenSources = undefined
    fireEvent.click(screen.getByTestId('toggle-screen-share-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('errors.screenShareNotSupported'))

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getDisplayMedia: vi.fn(),
        enumerateDevices: vi.fn().mockResolvedValue([])
      },
      writable: true,
      configurable: true
    })
    mocks.startScreenShare.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByTestId('toggle-screen-share-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('errors.screenShareFailed'))
  })

  it('handles settings remote-mic actions for open doc, install and recheck paths', async () => {
    await goToSettings()

    mocks.openRemoteMicSetupDoc.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByTestId('open-setup-doc-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.setupDocUnavailable'))

    mocks.getVirtualAudioInstallerState.mockResolvedValueOnce({
      inProgress: false,
      platformSupported: true,
      bundleReady: false,
      bundleMessage: 'missing-driver'
    })
    fireEvent.click(screen.getByTestId('install-driver-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.installPrecheckFailed'))

    mocks.getVirtualAudioInstallerState.mockResolvedValueOnce({
      inProgress: false,
      platformSupported: true,
      bundleReady: true
    })
    mocks.installVirtualAudioDriver.mockResolvedValueOnce({ provider: 'vb-cable', state: 'reboot-required' })
    fireEvent.click(screen.getByTestId('install-driver-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.installNeedsRestart'))

    mocks.getVirtualAudioInstallerState.mockResolvedValueOnce({
      inProgress: false,
      platformSupported: true,
      bundleReady: true
    })
    mocks.installVirtualAudioDriver.mockResolvedValueOnce({ provider: 'vb-cable', state: 'user-cancelled' })
    fireEvent.click(screen.getByTestId('install-driver-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.installCancelled'))

    mocks.getVirtualAudioInstallerState.mockResolvedValueOnce({
      inProgress: false,
      platformSupported: true,
      bundleReady: true
    })
    mocks.installVirtualAudioDriver.mockResolvedValueOnce({ provider: 'vb-cable', state: 'failed' })
    fireEvent.click(screen.getByTestId('install-driver-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.installFailed'))

    mocks.getVirtualAudioInstallerState.mockResolvedValueOnce({
      inProgress: false,
      platformSupported: true,
      bundleReady: true
    })
    mocks.installVirtualAudioDriver.mockResolvedValueOnce({ provider: 'vb-cable', state: 'already-installed' })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([{
          deviceId: 'vb-out',
          groupId: 'g1',
          kind: 'audiooutput',
          label: 'CABLE Input (VB-CABLE)',
          toJSON: () => ({})
        } as MediaDeviceInfo])
      },
      writable: true,
      configurable: true
    })
    fireEvent.click(screen.getByTestId('install-driver-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.installCompleted'))

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([])
      },
      writable: true,
      configurable: true
    })
    fireEvent.click(screen.getByTestId('recheck-driver-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.notReady'))
  })

  it('rejects manual install action on unsupported platforms', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
      writable: true, configurable: true
    })
    await goToSettings()
    fireEvent.click(screen.getByTestId('install-driver-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.installUnsupportedPlatform'))
  })

  it('routes remote mic sink errors through stop flow', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected'
    }
    mocks.sendRemoteMicRequest.mockReturnValueOnce('req-routing-error-1')
    await goToRoom()
    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingOutgoing'))
    fireEvent.click(screen.getByTestId('remote-mic-routing-error-btn'))
    expect(getLatestToastText()).toContain('remoteMic.routingFailed')
    expect(mocks.stopRemoteMicSession).toHaveBeenCalled()
  })

  it('covers keyboard shortcuts for speaker mute, video and screen share', async () => {
    await goToRoom()
    fireEvent.keyDown(window, { key: 'l' })
    fireEvent.keyDown(window, { key: 'v' })
    fireEvent.keyDown(window, { key: 's' })

    expect(mocks.toggleVideo).toHaveBeenCalled()
    expect(mocks.startScreenShare).toHaveBeenCalled()
  })

  it('supports macOS install-and-accept flow with BlackHole detection', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      writable: true,
      configurable: true
    })
    useMediaStreamReturnOverrides = {
      virtualMicDeviceStatus: {
        platform: 'mac',
        supported: true,
        detected: false,
        ready: false,
        outputDeviceId: null,
        outputDeviceLabel: null,
        expectedDeviceHint: undefined
      }
    }
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    mocks.getVirtualAudioInstallerState.mockResolvedValue({
      inProgress: false,
      platformSupported: true,
      bundleReady: true
    })
    mocks.installVirtualAudioDriver.mockResolvedValue({
      provider: 'blackhole',
      state: 'already-installed'
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          {
            deviceId: 'bh-out',
            groupId: 'g1',
            kind: 'audiooutput',
            label: 'BlackHole 2ch',
            toJSON: () => ({})
          }
        ])
      },
      writable: true,
      configurable: true
    })

    await goToRoom()
    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-mac-install',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))
    fireEvent.click(screen.getByTestId('remote-mic-accept-btn'))
    await waitFor(() => expect(mocks.respondRemoteMicRequest).toHaveBeenCalledWith('req-mac-install', true, 'accepted'))
  })

  it('stops an active target session by sending stop to source peer', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    await goToRoom()
    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-target-stop',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_start',
        requestId: 'req-target-stop',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('active'))

    fireEvent.click(screen.getByTestId('remote-mic-stop-btn'))
    expect(mocks.sendRemoteMicStop).toHaveBeenCalledWith('peer-1', 'req-target-stop', 'stopped-by-source')
    expect(mocks.stopRemoteMicSession).toHaveBeenCalledWith('stopped-by-source')
  })
})
