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
import { cleanup, render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App, {
  normalizeRemoteMicStopReason,
  isVirtualMicOutputReady,
  getVirtualAudioProviderForPlatform,
  getVirtualAudioDeviceName
} from '../renderer/App'
import { peerManager } from '../renderer/signaling/SimplePeerManager'
import { featureFlags } from '../renderer/config/featureFlags'

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
  exportDiagnosticsBundle: vi.fn(),
  getHealthSnapshot: vi.fn(),
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
const delegateEventBridgeState = vi.hoisted(() => ({
  callbacks: null as {
    onRemoteStream?: (peerId: string, stream: MediaStream) => void
    onError?: (error: Error, context: string) => void
  } | null
}))
let roomCallbacksCapture: any = {}
let screenShareState = false
let onScreenShareStartCallback: ((stream: MediaStream) => void) | null = null
let onScreenShareStopCallback: (() => void) | null = null

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
  RoomView: ({ onLeaveRoom, onToggleMute, onToggleVideo, onToggleSpeakerMute, onToggleSound, onCopyRoomId, onInputDeviceChange, onVideoDeviceChange, onSettingsChange, onToggleChat, onToggleScreenShare, isChatOpen, chatMessages, chatUnreadCount, connectionState, onRespondRemoteMicRequest, onRequestRemoteMic, onStopRemoteMic, onRemoteMicRoutingError, remoteMicSession, localPlatform }: any) => (
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
      <button data-testid="room-ptt-enable-btn" onClick={() => onSettingsChange({ pushToTalkEnabled: true })}>EnablePTT</button>
      <button data-testid="room-ptt-empty-key-btn" onClick={() => onSettingsChange({ pushToTalkKey: '' })}>EmptyPTTKey</button>
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
      <div data-testid="local-platform">{localPlatform}</div>
    </div>
  )
}))

vi.mock('../renderer/components/SettingsPanel', () => ({
  SettingsPanel: ({ onClose, onShowToast, onInstallRemoteMicDriver, onRecheckRemoteMicDevice, onOpenRemoteMicSetup, onExportDiagnostics }: any) => (
    <div data-testid="settings-panel">
      <button data-testid="close-settings-btn" onClick={onClose}>Close</button>
      <button data-testid="show-toast-btn" onClick={() => onShowToast('Test', 'success')}>Toast</button>
      <button data-testid="install-driver-btn" onClick={() => onInstallRemoteMicDriver?.()}>InstallDriver</button>
      <button data-testid="recheck-driver-btn" onClick={() => onRecheckRemoteMicDevice?.()}>RecheckDriver</button>
      <button data-testid="open-setup-doc-btn" onClick={() => onOpenRemoteMicSetup?.()}>OpenSetupDoc</button>
      <button data-testid="export-diagnostics-btn" onClick={() => onExportDiagnostics?.()}>ExportDiagnostics</button>
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
    ...useMediaStreamReturnOverrides,
  }))
}))

vi.mock('../renderer/hooks/useScreenShare', () => ({
  useScreenShare: vi.fn().mockImplementation((onStart: (stream: MediaStream) => void, onStop: () => void) => {
    onScreenShareStartCallback = onStart
    onScreenShareStopCallback = onStop
    return {
      isScreenSharing: screenShareState,
      startScreenShare: mocks.startScreenShare,
      stopScreenShare: mocks.stopScreenShare,
    }
  })
}))

vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({ t: (key: string) => key })
}))

vi.mock('../renderer/signaling/SimplePeerManager', () => ({
  peerManager: {
    on: vi.fn(() => () => { }),
    setCallbacks: vi.fn((callbacks: {
      onRemoteStream?: (peerId: string, stream: MediaStream) => void
      onError?: (error: Error, context: string) => void
    }) => {
      delegateEventBridgeState.callbacks = callbacks
    }),
    setOnChatMessage: vi.fn((cb: ((msg: any) => void) | null) => {
      onChatMessageCallback = cb
    }),
    setOnRemoteMicControl: vi.fn((cb: ((peerId: string, msg: any) => void) | null) => {
      onRemoteMicControlCallback = cb
    }),
    setOnModerationControl: vi.fn(),
    getModerationState: vi.fn().mockReturnValue({
      roomLocked: false,
      roomLockOwnerPeerId: null,
      localHandRaised: false,
      raisedHands: []
    }),
    setRoomLocked: vi.fn().mockReturnValue(true),
    requestMuteAll: vi.fn().mockReturnValue('req-mute-all'),
    setHandRaised: vi.fn().mockReturnValue(true),
    respondMuteAllRequest: vi.fn(),
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
    roomCallbacksCapture = {}
    screenShareState = false
    onScreenShareStartCallback = null
    onScreenShareStopCallback = null

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
    mocks.getHealthSnapshot.mockResolvedValue({
      timestamp: '2026-02-13T00:00:00.000Z',
      uptimeSeconds: 120,
      appVersion: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      nodeVersion: '20.20.0',
      electronVersion: '40.2.1',
      memoryUsage: {
        rss: 1,
        heapTotal: 1,
        heapUsed: 1,
        external: 1,
        arrayBuffers: 1
      },
      windowVisible: true,
      inCall: true,
      muted: false
    })
    mocks.exportDiagnosticsBundle.mockResolvedValue({ ok: true, path: 'C:/logs/diag.json' })

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
        exportDiagnosticsBundle: mocks.exportDiagnosticsBundle,
        getHealthSnapshot: mocks.getHealthSnapshot,
      },
      writable: true, configurable: true
    })
  })

  afterEach(() => {
    cleanup()
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

  it('shows toast via SettingsPanel onShowToast', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByTestId('settings-btn'))
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeInTheDocument())

    await user.click(screen.getByTestId('show-toast-btn'))
    await waitFor(() => expect(screen.getByTestId('toast-notification')).toBeInTheDocument())

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

  it.each([
    {
      label: 'join',
      clear: () => mocks.playJoin.mockClear(),
      trigger: () => roomCallbacksCapture.onPeerJoin('peer-2', 'Charlie'),
      expectNotCalled: () => expect(mocks.playJoin).not.toHaveBeenCalled()
    },
    {
      label: 'leave',
      clear: () => mocks.playLeave.mockClear(),
      trigger: () => roomCallbacksCapture.onPeerLeave('peer-2', 'Charlie'),
      expectNotCalled: () => expect(mocks.playLeave).not.toHaveBeenCalled()
    },
    {
      label: 'connection error',
      clear: () => mocks.playError.mockClear(),
      trigger: () => roomCallbacksCapture.onConnectionStateChange('failed'),
      expectNotCalled: () => expect(mocks.playError).not.toHaveBeenCalled()
    }
  ])('does not play $label sound when sound is disabled', async ({ clear, trigger, expectNotCalled }) => {
    const user = userEvent.setup()
    await goToRoom()
    await user.click(screen.getByTestId('toggle-sound-btn'))
    clear()

    act(() => { trigger() })
    expectNotCalled()
  })

  it('handles video toggle in room', async () => {
    await goToRoom()
    fireEvent.click(screen.getByTestId('toggle-video-btn'))

    expect(mocks.toggleVideo).toHaveBeenCalled()
    expect(peerManager.broadcastMuteStatus).toHaveBeenCalled()
  })

  it('handles speaker mute toggle in room', async () => {
    await goToRoom()
    fireEvent.click(screen.getByTestId('toggle-speaker-btn'))

    expect(mocks.playClick).toHaveBeenCalled()
    expect(peerManager.broadcastMuteStatus).toHaveBeenCalled()
  })

  it('keeps screen sharing status when toggling mute, speaker, and video', async () => {
    screenShareState = true
    await goToRoom()
    ; (peerManager.broadcastMuteStatus as any).mockClear()

    fireEvent.click(screen.getByTestId('toggle-mute-btn'))
    fireEvent.click(screen.getByTestId('toggle-speaker-btn'))
    fireEvent.click(screen.getByTestId('toggle-video-btn'))

    const calls = (peerManager.broadcastMuteStatus as any).mock.calls
    expect(calls).toHaveLength(3)
    expect(calls[0][2]).toBe(true)
    expect(calls[0][3]).toBe(true)
    expect(calls[1][2]).toBe(true)
    expect(calls[1][3]).toBe(true)
    expect(calls[2][2]).toBe(true)
    expect(calls[2][3]).toBe(true)
  })

  it('handles copy room ID', async () => {
    await goToRoom()
    fireEvent.click(screen.getByTestId('copy-id-btn'))
  })

  it('handles sound toggle', async () => {
    await goToRoom()
    fireEvent.click(screen.getByTestId('toggle-sound-btn'))
    expect(mocks.setEnabled).toHaveBeenCalled()
  })

  it('handles video device change from room', async () => {
    await goToRoom()
    fireEvent.click(screen.getByTestId('room-video-btn'))
    await waitFor(() => expect(mocks.switchVideoDevice).toHaveBeenCalledWith('room-vid'))
  })

  it('handles leave confirm flow', async () => {
    const user = userEvent.setup()
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
    fireEvent.click(screen.getByTestId('room-ns-btn'))
    expect(mocks.pipelineSetNS).toHaveBeenCalledWith(false)
  })

  it('registers and calls remote stream callbacks', async () => {
    await renderApp()
    const remoteStreamCallback = delegateEventBridgeState.callbacks?.onRemoteStream
    expect(remoteStreamCallback).toBeTypeOf('function')

    const stream = {
      id: 'rs1',
      getTracks: () => [{ id: 'rt1', kind: 'audio' }],
      getAudioTracks: () => [{ id: 'rt1', enabled: true, muted: false }]
    } as unknown as MediaStream

    act(() => { remoteStreamCallback?.('peer-r1', stream) })
  })

  it('handles remote stream with no audio tracks', async () => {
    await renderApp()
    const remoteStreamCallback = delegateEventBridgeState.callbacks?.onRemoteStream
    expect(remoteStreamCallback).toBeTypeOf('function')
    const stream = { id: 'rs2', getTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream
    act(() => { remoteStreamCallback?.('peer-r2', stream) })
  })

  it('handles peer manager error callback with toast', async () => {
    await renderApp()
    const errorCallback = delegateEventBridgeState.callbacks?.onError
    expect(errorCallback).toBeTypeOf('function')
    act(() => { errorCallback?.(new Error('conn error'), 'peer') })
    await waitFor(() => expect(screen.getByTestId('toast-notification')).toBeInTheDocument())
  })

  it('handles join room failure', async () => {
    const user = userEvent.setup()
    mocks.joinRoom.mockRejectedValue(new Error('Join failed'))
    await renderApp()

    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeInTheDocument()
      expect(screen.getByTestId('lobby-view')).toBeInTheDocument()
    })
  })

  it('handles pipeline failure and falls back to raw stream', async () => {
    const user = userEvent.setup()
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
    fireEvent.click(screen.getByTestId('room-video-btn'))
  })

  it('handles switchInputDevice returning null', async () => {
    mocks.switchInputDevice.mockResolvedValue(null)
    await renderApp()
    fireEvent.click(screen.getByTestId('change-input-btn'))
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
    fireEvent.click(screen.getByTestId('change-input-btn'))

    await waitFor(() => {
      expect(peerManager.replaceTrack).toHaveBeenCalled()
      expect(peerManager.setLocalStream).toHaveBeenCalled()
    })
  })

  it('joins room with camera enabled', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByTestId('join-cam-btn'))

    await waitFor(() => {
      expect(mocks.startCapture).toHaveBeenCalledWith(expect.objectContaining({ videoEnabled: true }))
      expect(mocks.joinRoom).toHaveBeenCalledWith('test-room-123', 'Alice')
    })
  })

  it('handles startCapture returning null', async () => {
    const user = userEvent.setup()
    mocks.startCapture.mockResolvedValue(null)
    await renderApp()

    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => expect(mocks.joinRoom).toHaveBeenCalled())
  })

  it('covers remote mic helper utility branches', () => {
    expect(normalizeRemoteMicStopReason('busy')).toBe('busy')
    expect(normalizeRemoteMicStopReason('not-a-valid-reason')).toBe('stopped-by-source')
    expect(normalizeRemoteMicStopReason(123)).toBe('stopped-by-source')

    const macDevices = [{ kind: 'audiooutput', label: 'BlackHole 2ch' }] as MediaDeviceInfo[]
    const winDevices = [{ kind: 'audiooutput', label: 'CABLE Input (VB-Audio Virtual Cable)' }] as MediaDeviceInfo[]
    const otherDevices = [{ kind: 'audiooutput', label: 'Built-in Output' }] as MediaDeviceInfo[]
    expect(isVirtualMicOutputReady('mac', macDevices)).toBe(true)
    expect(isVirtualMicOutputReady('mac', otherDevices)).toBe(false)
    expect(isVirtualMicOutputReady('win', winDevices)).toBe(true)
    expect(isVirtualMicOutputReady('linux', otherDevices)).toBe(false)

    expect(getVirtualAudioProviderForPlatform('win')).toBe('vb-cable')
    expect(getVirtualAudioProviderForPlatform('mac')).toBe('blackhole')
    expect(getVirtualAudioProviderForPlatform('linux')).toBeNull()

    expect(getVirtualAudioDeviceName('win')).toBe('VB-CABLE')
    expect(getVirtualAudioDeviceName('mac')).toBe('BlackHole 2ch')
    expect(getVirtualAudioDeviceName('linux')).toBe('Virtual Audio Device')
  })

  it('handles remote mic request busy and request-id failure branches', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    await goToRoom()

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-busy',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))

    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.busy'))

    fireEvent.click(screen.getByTestId('remote-mic-reject-btn'))
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('idle'))

    mocks.sendRemoteMicRequest.mockReturnValueOnce(null)
    fireEvent.click(screen.getByTestId('remote-mic-request-btn'))
    await waitFor(() => expect(getLatestToastText()).toContain('remoteMic.requestFailed'))
  })

  it('ignores mismatched remote mic control message branches', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }
    await goToRoom()

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_response',
        requestId: 'unknown-request',
        accepted: true,
        ts: Date.now()
      })
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_heartbeat',
        requestId: 'unknown-request',
        ts: Date.now()
      })
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_start',
        requestId: 'unknown-request',
        ts: Date.now()
      })
    })
    expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('idle')

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-stop-mismatch',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming'))

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_stop',
        requestId: 'different-request-id',
        reason: 'stopped-by-source',
        ts: Date.now()
      })
    })
    expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('pendingIncoming')
  })

  it('replaces pending timers for outgoing and incoming request flows', async () => {
    useRoomReturnOverrides = {
      roomId: 'room-1',
      connectionState: 'connected',
      peers: new Map([['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, audioLevel: 0, connectionState: 'connected' }]])
    }

    await renderApp()
    fireEvent.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => expect(screen.getByTestId('room-view')).toBeInTheDocument())

    act(() => {
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-timeout',
        sourcePeerId: 'peer-1',
        sourceName: 'Bob',
        targetPeerId: 'local-peer-123',
        ts: Date.now()
      })
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_request',
        requestId: 'req-timeout',
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
        requestId: 'req-timeout',
        ts: Date.now()
      })
      onRemoteMicControlCallback?.('peer-1', {
        type: 'rm_start',
        requestId: 'req-timeout',
        ts: Date.now()
      })
    })
    await waitFor(() => expect(screen.getByTestId('remote-mic-state')).toHaveTextContent('active'))
  })

  it('returns early when remote mic callback registration API is unavailable', async () => {
    const original = (peerManager as any).setOnRemoteMicControl
    ; (peerManager as any).setOnRemoteMicControl = undefined
    try {
      await goToRoom()
      expect(screen.getByTestId('room-view')).toBeInTheDocument()
    } finally {
      ; (peerManager as any).setOnRemoteMicControl = original
    }
  })

  it.each([
    {
      label: 'M toggles mute in room view',
      setup: async () => { await goToRoom() },
      event: { key: 'm' },
      assert: async () => { expect(mocks.toggleMute).toHaveBeenCalled() }
    },
    {
      label: 'Ctrl+Shift+L downloads logs',
      setup: async () => { await renderApp() },
      event: { key: 'l', ctrlKey: true, shiftKey: true },
      assert: async () => { expect(mocks.downloadLogs).toHaveBeenCalled() }
    }
  ])('keyboard shortcut: $label', async ({ setup, event, assert }) => {
    await setup()
    fireEvent.keyDown(window, event)
    await assert()
  })

  it.each([
    {
      label: 'shows leave confirm when connected',
      roomOverride: { connectionState: 'connected', roomId: 'room-1' },
      assert: async () => {
        await waitFor(() => expect(screen.getByTestId('leave-confirm-dialog')).toBeInTheDocument())
      }
    },
    {
      label: 'cancels search when signaling',
      roomOverride: { connectionState: 'signaling' },
      assert: async () => {
        expect(mocks.leaveRoom).toHaveBeenCalled()
      }
    }
  ])('keyboard Escape: $label', async ({ roomOverride, assert }) => {
    useRoomReturnOverrides = roomOverride
    await goToRoom()
    fireEvent.keyDown(window, { key: 'Escape' })
    await assert()
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

  it.each([
    {
      label: 'onDownloadLogs triggers download',
      callbackName: 'onDownloadLogs',
      assert: () => expect(mocks.downloadLogs).toHaveBeenCalled()
    },
    {
      label: 'onTrayToggleMute toggles mute',
      callbackName: 'onTrayToggleMute',
      assert: () => expect(mocks.toggleMute).toHaveBeenCalled()
    }
  ])('electronAPI callback: $label', async ({ callbackName, assert }) => {
    await renderApp()
    expect((electronCallbacks as any)[callbackName]).toBeDefined()
    act(() => { (electronCallbacks as any)[callbackName]() })
    assert()
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

  it.each([
    {
      label: 'mac user agent',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      expectedPlatform: 'mac'
    },
    {
      label: 'linux user agent',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      expectedPlatform: 'linux'
    },
    {
      label: 'unknown user agent defaults to win',
      userAgent: 'CustomAgent/1.0',
      expectedPlatform: 'win'
    }
  ])('derives local platform for $label', async ({ userAgent, expectedPlatform }) => {
    Object.defineProperty(navigator, 'userAgent', {
      value: userAgent,
      writable: true,
      configurable: true
    })

    await goToRoom()
    expect(screen.getByTestId('local-platform')).toHaveTextContent(expectedPlatform)
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
      mocks.respondRemoteMicRequest.mockClear()
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
      const toastCountBefore = screen.queryAllByTestId('toast-notification').length

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
      await waitFor(() => expect(screen.queryAllByTestId('toast-notification').length).toBeGreaterThan(toastCountBefore))
      fireEvent.click(screen.getByTestId('remote-mic-accept-btn'))

      await waitFor(() => expect(mocks.respondRemoteMicRequest).toHaveBeenLastCalledWith(
        installCase.requestId,
        installCase.expectedReason === 'accepted',
        installCase.expectedReason
      ))
      await waitFor(() => expect(getLatestToastText()).toContain(installCase.expectedToast))
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

  it('exports diagnostics bundle from settings panel', async () => {
    await goToSettings()

    fireEvent.click(screen.getByTestId('export-diagnostics-btn'))

    await waitFor(() => {
      expect(mocks.getHealthSnapshot).toHaveBeenCalled()
      expect(mocks.exportDiagnosticsBundle).toHaveBeenCalled()
      expect(getLatestToastText()).toContain('settings.exportDiagnosticsSuccess')
    })
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

  it('supports push-to-talk key down/up flow while muted', async () => {
    useMediaStreamReturnOverrides = {
      isMuted: true
    }
    await goToRoom()

    fireEvent.click(screen.getByTestId('room-ptt-enable-btn'))
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })

    await waitFor(() => expect(mocks.toggleMute).toHaveBeenCalledTimes(2))
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

  it('does not play click sounds for mute/speaker toggles when sound is disabled', async () => {
    await goToRoom()
    fireEvent.click(screen.getByTestId('toggle-sound-btn'))
    mocks.playClick.mockClear()

    fireEvent.click(screen.getByTestId('toggle-mute-btn'))
    fireEvent.click(screen.getByTestId('toggle-speaker-btn'))

    expect(mocks.playClick).not.toHaveBeenCalled()
  })

  it('stops screen share immediately when toggled while already sharing', async () => {
    screenShareState = true
    await goToRoom()

    fireEvent.click(screen.getByTestId('toggle-screen-share-btn'))
    expect(mocks.stopScreenShare).toHaveBeenCalled()
  })

  it('handles screen share callbacks when video tracks are missing', async () => {
    await goToRoom()

    const videoTrack = { id: 'screen-track', kind: 'video', enabled: true } as unknown as MediaStreamTrack
    const withVideo = { getVideoTracks: () => [videoTrack] } as unknown as MediaStream
    const withoutVideo = { getVideoTracks: () => [] } as unknown as MediaStream

    act(() => onScreenShareStartCallback?.(withoutVideo))
    expect(peerManager.replaceTrack).not.toHaveBeenCalled()

    act(() => onScreenShareStartCallback?.(withVideo))
    expect(peerManager.replaceTrack).toHaveBeenCalledWith(videoTrack)
  })

  it('runs screen share stop callback for missing local stream and missing camera track', async () => {
    useMediaStreamReturnOverrides = { localStream: null }
    await goToRoom()

    act(() => onScreenShareStopCallback?.())
    expect(peerManager.broadcastMuteStatus).toHaveBeenCalled()

    cleanup()
    useMediaStreamReturnOverrides = {
      localStream: { getVideoTracks: () => [] }
    }
    await goToRoom()
    ; (peerManager.replaceTrack as any).mockClear()
    act(() => onScreenShareStopCallback?.())
    expect(peerManager.replaceTrack).not.toHaveBeenCalled()
  })

  it('falls back to translated connection error when join failure has no message', async () => {
    mocks.startCapture.mockRejectedValueOnce({})
    const user = userEvent.setup()
    await renderApp()

    await user.click(screen.getByTestId('join-room-btn'))
    await waitFor(() => expect(screen.getByTestId('error-banner')).toHaveTextContent('errors.connectionFailed'))
  })

  it('handles input and video device switches when replacement tracks are missing', async () => {
    useMediaStreamReturnOverrides = {
      switchInputDevice: vi.fn().mockResolvedValue({
        getAudioTracks: () => []
      }),
      switchVideoDevice: vi.fn().mockResolvedValue({
        getVideoTracks: () => []
      })
    }
    mocks.pipelineConnectInput.mockRejectedValueOnce(new Error('pipeline fail'))
    await goToRoom()
    ; (peerManager.replaceTrack as any).mockClear()

    fireEvent.click(screen.getByTestId('room-input-btn'))
    fireEvent.click(screen.getByTestId('room-video-btn'))

    await waitFor(() => expect(peerManager.replaceTrack).not.toHaveBeenCalled())
  })

  it('uses fallback push-to-talk key and disables diagnostics export when flag is off', async () => {
    const originalDiagnosticsFlag = featureFlags.diagnostics_panel
    const originalPttFlag = featureFlags.push_to_talk
    ; (featureFlags as any).diagnostics_panel = false
    ; (featureFlags as any).push_to_talk = true
    useMediaStreamReturnOverrides = { isMuted: true }

    await goToRoom()
    fireEvent.click(screen.getByTestId('room-ptt-enable-btn'))
    fireEvent.click(screen.getByTestId('room-ptt-empty-key-btn'))
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    expect(mocks.toggleMute).toHaveBeenCalled()

    cleanup()
    await goToSettings()
    fireEvent.click(screen.getByTestId('export-diagnostics-btn'))
    expect(mocks.exportDiagnosticsBundle).not.toHaveBeenCalled()

    ; (featureFlags as any).diagnostics_panel = originalDiagnosticsFlag
    ; (featureFlags as any).push_to_talk = originalPttFlag
  })
})
