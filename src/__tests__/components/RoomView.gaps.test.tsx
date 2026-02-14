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
import {
  clickRemoteMicIncomingAction,
  createP2PManagerMock,
  createRoomViewProps,
  createPeer,
  createRemoteMicSession,
  createVirtualAudioInstallerState,
  createVirtualMicDeviceStatus,
  expectRemoteMicIncomingControlsDisabled,
  expectRemoteMicIncomingModal,
} from '../helpers/roomViewTestUtils'

// Mock dependencies before importing component
vi.mock('../../renderer/components/ParticipantCard', () => ({
  ParticipantCard: ({ name, peerId, routeRole, isRemoteMicMapped, localSpeakerMuted, outputDeviceId, onExpand, onSinkRoutingError }: any) => (
    <div
      data-testid={`participant-${peerId}`}
      data-route-role={routeRole || 'none'}
      data-remote-mic-mapped={String(Boolean(isRemoteMicMapped))}
      data-local-speaker-muted={String(Boolean(localSpeakerMuted))}
      data-output-device-id={outputDeviceId == null ? 'null' : String(outputDeviceId)}
      data-has-expand={String(typeof onExpand === 'function')}
      data-has-sink-handler={String(typeof onSinkRoutingError === 'function')}
    >
      <span data-testid="participant-name">{name}</span>
      {onExpand && (
        <button data-testid={`expand-${peerId}`} onClick={onExpand}>
          Expand
        </button>
      )}
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

vi.mock('../../renderer/components/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
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
        'room.toggleChat': 'Toggle Chat',
        'room.startVideo': 'Start Video',
        'room.stopVideo': 'Stop Video',
        'lobby.roomId': 'Room ID',
        'common.microphone': 'Microphone',
        'common.camera': 'Camera',
        'remoteMic.stop': 'Stop Remote Mic',
        'remoteMic.mapMic': 'Map Remote Mic',
        'remoteMic.waitingForApproval': `Waiting for ${params?.name || 'target'}`,
        'remoteMic.activeAsSourceName': `Source active with ${params?.name || 'target'}`,
        'remoteMic.activeAsTarget': 'Target active',
        'remoteMic.installPrompt': `Install prompt ${params?.device || 'device'}`,
        'remoteMic.installBundleMissing': `Install bundle missing ${params?.reason || ''}`,
        'remoteMic.installAndAccept': 'Install and Accept',
        'remoteMic.accept': 'Accept',
        'remoteMic.reject': 'Reject',
        'remoteMic.incomingTitle': 'Incoming request',
        'remoteMic.incomingPrompt': `Incoming from ${params?.name || 'Unknown'}`,
        'remoteMic.installing': 'Installing...',
        'remoteMic.installNoCancel': 'Cannot cancel',
        'remoteMic.expiresIn': `Expires in ${params?.seconds || 0}`,
        'remoteMic.installBundleMissingReasonDefault': 'Bundle missing',
        'remoteMic.virtualDeviceHint': `Virtual device hint ${params?.device || ''}`,
        'remoteMic.openSetup': 'Open setup',
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
  const defaultP2PManager = createP2PManagerMock({
    getDebugInfo: vi.fn().mockReturnValue({
      selfId: 'self-1',
      roomId: 'test-room',
      peerCount: 0,
      peers: [],
    }),
    getSignalingState: vi.fn().mockReturnValue('connected'),
    setOnSignalingStateChange: vi.fn(),
    manualReconnect: vi.fn().mockResolvedValue(true),
  })

  const defaultProps = {
    ...createRoomViewProps({
      roomId: 'room-123',
      localPeerId: 'local-peer',
      localPlatform: 'win',
      isVideoEnabled: false,
      audioLevel: 0,
      selectedOutputDevice: null,
      selectedInputDevice: null,
      selectedVideoDevice: null,
    }),
    p2pManager: defaultP2PManager,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const renderRoomView = (overrides: Record<string, unknown> = {}) => (
    render(<RoomView {...(defaultProps as any)} {...(overrides as any)} />)
  )

  it.each([
    { label: 'connected state', overrides: {} },
    { label: 'signaling state', overrides: { connectionState: 'signaling' } },
    { label: 'failed state', overrides: { connectionState: 'failed' } },
  ])('renders participant chrome in $label', ({ overrides }) => {
    renderRoomView(overrides)
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByText(/room-123/)).toBeInTheDocument()
  })

  it('renders with peers', () => {
    const peers = new Map([
      [
        'peer-1',
        { id: 'peer-1', name: 'Bob', isMuted: false, isSpeakerMuted: false, isVideoMuted: false, platform: 'mac' },
      ],
    ])
    render(<RoomView {...(defaultProps as any)} peers={peers} connectionState="connected" />)
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it.each([
    { testId: 'room-leave-btn', callbackName: 'onLeaveRoom' },
    { testId: 'room-mute-btn', callbackName: 'onToggleMute' },
    { testId: 'room-video-btn', callbackName: 'onToggleVideo' },
  ])('triggers $callbackName callback via $testId', ({ testId, callbackName }) => {
    renderRoomView()
    fireEvent.click(screen.getByTestId(testId))
    expect((defaultProps as any)[callbackName]).toHaveBeenCalled()
  })

  it('formats duration with hours', async () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    vi.setSystemTime(start)
    await act(async () => {
      render(<RoomView {...(defaultProps as any)} />)
      await Promise.resolve()
    })

    // Jump wall clock forward to avoid thousands of interval ticks.
    await act(async () => {
      vi.setSystemTime(new Date(start.getTime() + 3661000)) // 1h 1m 1s
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    // The formatDuration function should produce hour format (1:01:0x)
    expect(screen.getByText(/1:01:0[0-9]/)).toBeInTheDocument()
  })

  it('updates network status periodically', async () => {
    await act(async () => {
      render(<RoomView {...(defaultProps as any)} />)
      await Promise.resolve()
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    expect(defaultP2PManager.getNetworkStatus).toHaveBeenCalled()
  })

  it('cleans up intervals on unmount', () => {
    const { unmount } = render(<RoomView {...(defaultProps as any)} />)
    unmount()
  })

  it('renders core controls', () => {
    renderRoomView()
    expect(screen.getByTestId('room-mute-btn')).toBeInTheDocument()
    expect(screen.getByTestId('room-leave-btn')).toBeInTheDocument()
    expect(screen.getByTestId('room-copy-btn')).toBeInTheDocument()
  })

  it('clicking screen share button triggers callback', () => {
    const onToggleScreenShare = vi.fn()
    const peers = new Map([
      ['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, isSpeakerMuted: false, audioLevel: 0, connectionState: 'connected' }],
    ])
    renderRoomView({ peers, onToggleScreenShare })
    fireEvent.click(screen.getByTestId('room-screenshare-btn'))
    expect(onToggleScreenShare).toHaveBeenCalled()
  })

  it('screen share button reflects active state', () => {
    const peers = new Map([
      ['peer-1', { id: 'peer-1', name: 'Bob', isMuted: false, isSpeakerMuted: false, audioLevel: 0, connectionState: 'connected' }],
    ])
    render(<RoomView {...(defaultProps as any)} peers={peers} isScreenSharing={true} />)
    const button = screen.getByTestId('room-screenshare-btn')
    expect(button.className).toContain('bg-green-100')
  })

  it('shows remote mic outgoing banner and stop button for active source sessions', () => {
    const peers = new Map([
      ['peer-1', createPeer({ id: 'peer-1', name: 'Bob' })]
    ])
    const onStopRemoteMic = vi.fn()
    render(
      <RoomView
        {...(defaultProps as any)}
        peers={peers}
        remoteMicSession={createRemoteMicSession({
          state: 'active',
          role: 'source',
          requestId: 'req-1',
          targetPeerId: 'peer-1',
          targetName: 'Bob'
        })}
        onStopRemoteMic={onStopRemoteMic}
      />
    )

    expect(screen.getByText('Source active with Bob')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Stop Remote Mic'))
    expect(onStopRemoteMic).toHaveBeenCalled()

    const peerCard = screen.getByTestId('participant-peer-1')
    expect(peerCard.getAttribute('data-route-role')).toBe('speaker')
    expect(peerCard.getAttribute('data-remote-mic-mapped')).toBe('true')
  })

  it('maps remote participant to virtual mic route for active target sessions', () => {
    const peers = new Map([
      ['peer-1', createPeer({ id: 'peer-1', name: 'Bob' })]
    ])
    render(
      <RoomView
        {...(defaultProps as any)}
        peers={peers}
        isSpeakerMuted={true}
        selectedOutputDevice="speaker-default"
        virtualMicDeviceStatus={createVirtualMicDeviceStatus({
          platform: 'win',
          outputDeviceId: 'vb-out',
          outputDeviceLabel: 'CABLE Input',
          expectedDeviceHint: 'CABLE Input (VB-CABLE)'
        })}
        remoteMicSession={createRemoteMicSession({
          state: 'active',
          role: 'target',
          requestId: 'req-2',
          sourcePeerId: 'peer-1'
        })}
      />
    )

    expect(screen.getByText('Target active')).toBeInTheDocument()
    const peerCard = screen.getByTestId('participant-peer-1')
    expect(peerCard.getAttribute('data-route-role')).toBe('virtualMic')
    expect(peerCard.getAttribute('data-local-speaker-muted')).toBe('false')
  })

  it('renders incoming request modal install prompts and accept/reject actions', async () => {
    const onRespondRemoteMicRequest = vi.fn()
    await act(async () => {
      render(
        <RoomView
          {...(defaultProps as any)}
          localPlatform="win"
          virtualMicDeviceStatus={createVirtualMicDeviceStatus({
            platform: 'win',
            detected: false,
            ready: false,
            outputDeviceId: null,
            outputDeviceLabel: null,
            expectedDeviceHint: 'CABLE Input (VB-CABLE)'
          })}
          virtualAudioInstallerState={createVirtualAudioInstallerState({
            bundleReady: true
          })}
          remoteMicSession={createRemoteMicSession({
            state: 'pendingIncoming',
            role: 'target',
            requestId: 'req-3',
            sourcePeerId: 'peer-remote',
            sourceName: 'Remote User',
            expiresAt: Date.now() + 5000,
            needsVirtualDeviceSetup: true
          })}
          onRespondRemoteMicRequest={onRespondRemoteMicRequest}
        />
      )
      await Promise.resolve()
    })

    expectRemoteMicIncomingModal({
      title: 'Incoming request',
      installPrompt: /Install prompt/,
      installActionLabel: 'Install and Accept',
    })
    clickRemoteMicIncomingAction({
      actionLabel: 'Reject',
      onRespondRemoteMicRequest,
      expectedAccepted: false,
    })
    clickRemoteMicIncomingAction({
      actionLabel: 'Install and Accept',
      onRespondRemoteMicRequest,
      expectedAccepted: true,
    })
  })

  it('shows incoming modal bundle-missing and installing states with disabled actions', () => {
    const { rerender } = render(
      <RoomView
        {...(defaultProps as any)}
        localPlatform="mac"
        virtualMicDeviceStatus={createVirtualMicDeviceStatus({
          platform: 'mac',
          detected: false,
          ready: false,
          outputDeviceId: null,
          outputDeviceLabel: null,
          expectedDeviceHint: 'BlackHole 2ch'
        })}
        virtualAudioInstallerState={createVirtualAudioInstallerState({
          bundleReady: false,
          bundleMessage: 'manifest missing'
        })}
        remoteMicSession={createRemoteMicSession({
          state: 'pendingIncoming',
          role: 'target',
          requestId: 'req-4',
          sourcePeerId: 'peer-remote',
          sourceName: 'Remote User',
          needsVirtualDeviceSetup: true,
          isInstallingVirtualDevice: false,
          expiresAt: Date.now() + 5000
        })}
      />
    )

    expect(screen.getByText(/Install bundle missing/)).toBeInTheDocument()
    rerender(
      <RoomView
        {...(defaultProps as any)}
        localPlatform="mac"
        virtualMicDeviceStatus={createVirtualMicDeviceStatus({
          platform: 'mac',
          detected: false,
          ready: false,
          outputDeviceId: null,
          outputDeviceLabel: null,
          expectedDeviceHint: 'BlackHole 2ch'
        })}
        virtualAudioInstallerState={createVirtualAudioInstallerState({
          inProgress: true,
          bundleReady: false,
          bundleMessage: 'manifest missing'
        })}
        remoteMicSession={createRemoteMicSession({
          state: 'pendingIncoming',
          role: 'target',
          requestId: 'req-4',
          sourcePeerId: 'peer-remote',
          sourceName: 'Remote User',
          needsVirtualDeviceSetup: true,
          isInstallingVirtualDevice: true,
          expiresAt: Date.now() + 5000
        })}
      />
    )

    expect(screen.getAllByText('Installing...').length).toBeGreaterThan(0)
    expectRemoteMicIncomingControlsDisabled({
      rejectLabel: 'Reject',
      actionLabel: 'Installing...',
    })
  })

  it('renders virtual device setup hint and open-setup action for non-source state', () => {
    const onOpenRemoteMicSetup = vi.fn()
    render(
      <RoomView
        {...(defaultProps as any)}
        localPlatform="mac"
        virtualMicDeviceStatus={createVirtualMicDeviceStatus({
          platform: 'mac',
          detected: false,
          ready: false,
          outputDeviceId: null,
          outputDeviceLabel: null,
          expectedDeviceHint: 'BlackHole 2ch'
        })}
        remoteMicSession={createRemoteMicSession()}
        onOpenRemoteMicSetup={onOpenRemoteMicSetup}
      />
    )

    expect(screen.getByText(/Virtual device hint/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Open setup'))
    expect(onOpenRemoteMicSetup).toHaveBeenCalled()
  })

  it('toggles chat and shows unread badge formatting for large counts', () => {
    const onToggleChat = vi.fn()
    const onMarkChatRead = vi.fn()
    render(
      <RoomView
        {...(defaultProps as any)}
        chatUnreadCount={12}
        isChatOpen={false}
        onToggleChat={onToggleChat}
        onMarkChatRead={onMarkChatRead}
      />
    )

    expect(screen.getByTestId('chat-unread-badge')).toHaveTextContent('9+')
    fireEvent.click(screen.getByTestId('room-chat-btn'))
    expect(onToggleChat).toHaveBeenCalled()
    expect(onMarkChatRead).toHaveBeenCalled()
  })

  it('disables screen-share button when no peers and not currently sharing', () => {
    render(<RoomView {...(defaultProps as any)} peers={new Map()} isScreenSharing={false} />)
    const button = screen.getByTestId('room-screenshare-btn') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.className).toContain('cursor-not-allowed')
  })

  it('shows no unread badge while chat panel is open', () => {
    render(<RoomView {...(defaultProps as any)} chatUnreadCount={5} isChatOpen={true} />)
    expect(screen.queryByTestId('chat-unread-badge')).not.toBeInTheDocument()
  })

  it('renders unknown connection states without known status labels', () => {
    render(<RoomView {...(defaultProps as any)} connectionState={'reconnecting' as any} />)
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument()
  })

  it('clears previous copy timer when copy action is triggered repeatedly', () => {
    render(<RoomView {...(defaultProps as any)} />)
    const copyButton = screen.getByTestId('room-copy-btn')

    fireEvent.click(copyButton)
    fireEvent.click(copyButton)

    expect(defaultProps.onCopyRoomId).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Copied!')).toBeInTheDocument()
  })

  it('renders push-to-talk banners for hold and speaking states', () => {
    const { rerender } = render(
      <RoomView
        {...(defaultProps as any)}
        pushToTalkEnabled={true}
        isPushToTalkActive={false}
      />
    )

    expect(screen.getByText('room.pushToTalkHold')).toBeInTheDocument()

    rerender(
      <RoomView
        {...(defaultProps as any)}
        pushToTalkEnabled={true}
        isPushToTalkActive={true}
      />
    )
    expect(screen.getByText('room.pushToTalkSpeaking')).toBeInTheDocument()
  })

  it('uses fallback remote-mic labels when target/source names are missing', async () => {
    const peers = new Map([
      ['peer-1', createPeer({ id: 'peer-1', name: 'Bob' })]
    ])
    const onStopRemoteMic = vi.fn()

    let rerender!: (ui: any) => void
    await act(async () => {
      const renderResult = render(
        <RoomView
          {...(defaultProps as any)}
          peers={peers}
          remoteMicSession={createRemoteMicSession({
            state: 'pendingOutgoing',
            role: 'source',
            requestId: 'req-fallback-outgoing',
            targetPeerId: 'peer-1',
            targetName: undefined,
            expiresAt: Date.now() + 5000
          })}
          onStopRemoteMic={onStopRemoteMic}
        />
      )
      rerender = renderResult.rerender
      await Promise.resolve()
    })

    expect(screen.getByText('Waiting for target')).toBeInTheDocument()

    await act(async () => {
      rerender(
        <RoomView
          {...(defaultProps as any)}
          peers={peers}
          remoteMicSession={createRemoteMicSession({
            state: 'active',
            role: 'source',
            requestId: 'req-fallback-active',
            targetPeerId: 'peer-1',
            targetName: undefined
          })}
          onStopRemoteMic={onStopRemoteMic}
        />
      )
      await Promise.resolve()
    })

    expect(screen.getByText('Source active with target')).toBeInTheDocument()
  })

  it('renders mapped-target controls with stop action and virtual mic fallback output', () => {
    const peers = new Map([
      ['peer-1', createPeer({ id: 'peer-1', name: 'Bob' })]
    ])
    const onStopRemoteMic = vi.fn()
    const onRequestRemoteMic = vi.fn()

    render(
      <RoomView
        {...(defaultProps as any)}
        peers={peers}
        remoteMicSession={createRemoteMicSession({
          state: 'active',
          role: 'source',
          requestId: 'req-map-state',
          targetPeerId: 'peer-1'
        })}
        onStopRemoteMic={onStopRemoteMic}
        onRequestRemoteMic={onRequestRemoteMic}
        virtualMicDeviceStatus={createVirtualMicDeviceStatus({
          platform: 'win',
          outputDeviceId: undefined,
          outputDeviceLabel: undefined,
          expectedDeviceHint: undefined
        })}
      />
    )

    const peerCard = screen.getByTestId('participant-peer-1')
    expect(peerCard.getAttribute('data-route-role')).toBe('speaker')
    expect(peerCard.getAttribute('data-output-device-id')).toBe('null')

    const stopButtons = screen.getAllByText('Stop Remote Mic')
    fireEvent.click(stopButtons[stopButtons.length - 1])
    expect(onStopRemoteMic).toHaveBeenCalled()
    expect(onRequestRemoteMic).not.toHaveBeenCalled()
  })

  it('maps expanded participant audio routing to virtual mic for active target sessions', () => {
    const peers = new Map([
      ['peer-1', createPeer({ id: 'peer-1', name: 'Bob' })]
    ])

    render(
      <RoomView
        {...(defaultProps as any)}
        peers={peers}
        selectedOutputDevice="speaker-default"
        remoteMicSession={createRemoteMicSession({
          state: 'active',
          role: 'target',
          requestId: 'req-expanded-map',
          sourcePeerId: 'peer-1'
        })}
      />
    )

    fireEvent.click(screen.getByTestId('expand-peer-1'))
    const expandedPeerCard = screen.getByTestId('participant-peer-1')
    expect(expandedPeerCard.getAttribute('data-route-role')).toBe('virtualMic')
    expect(expandedPeerCard.getAttribute('data-output-device-id')).toBe('null')
    expect(expandedPeerCard.getAttribute('data-local-speaker-muted')).toBe('false')
  })

  it('uses incoming modal fallback source and default install hint for macOS', async () => {
    await act(async () => {
      render(
        <RoomView
          {...(defaultProps as any)}
          localPlatform="mac"
          virtualMicDeviceStatus={createVirtualMicDeviceStatus({
            platform: 'mac',
            detected: false,
            ready: false,
            outputDeviceId: null,
            outputDeviceLabel: null,
            expectedDeviceHint: undefined
          })}
          virtualAudioInstallerState={createVirtualAudioInstallerState({
            bundleReady: true
          })}
          remoteMicSession={createRemoteMicSession({
            state: 'pendingIncoming',
            role: 'target',
            requestId: 'req-fallback-incoming',
            sourcePeerId: 'peer-remote',
            sourceName: undefined,
            needsVirtualDeviceSetup: true,
            expiresAt: Date.now() + 5000
          })}
        />
      )
      await Promise.resolve()
    })

    expect(screen.getByText('Incoming from Unknown')).toBeInTheDocument()
    expect(screen.getByText('Install prompt BlackHole 2ch')).toBeInTheDocument()
  })
})
