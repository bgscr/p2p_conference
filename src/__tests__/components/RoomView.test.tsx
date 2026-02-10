/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RoomView } from '../../renderer/components/RoomView'

// Mocks
vi.mock('../../renderer/components/ParticipantCard', () => ({
    ParticipantCard: ({ name }: { name: string }) => <div data-testid="participant-card">{name}</div>
}))
vi.mock('../../renderer/components/AudioMeter', () => ({
    AudioMeter: () => <div data-testid="audio-meter" />
}))
vi.mock('../../renderer/components/DeviceSelector', () => ({
    DeviceSelector: ({ label }: { label: string }) => <div data-testid="device-selector">{label}</div>
}))
vi.mock('../../renderer/components/ChatPanel', () => ({
    ChatPanel: () => <div data-testid="chat-panel" />
}))
vi.mock('../../renderer/hooks/useI18n', () => ({
    useI18n: () => ({ t: (key: string) => key })
}))

describe('RoomView', () => {
    const defaultProps = {
        userName: 'Alice',
        roomId: '123',
        localPeerId: 'local',
        peers: new Map(),
        remoteStreams: new Map(),
        remoteMuteStatuses: new Map(),
        localStream: null as MediaStream | null,
        connectionState: 'connected' as const,
        isMuted: false,
        isVideoEnabled: true,
        isSpeakerMuted: false,
        audioLevel: 0,
        selectedOutputDevice: 'default',
        inputDevices: [],
        videoInputDevices: [],
        outputDevices: [],
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
        chatMessages: [],
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
            selectedInputDevice: 'default',
            selectedVideoDevice: 'default',
            selectedOutputDevice: 'default'
        },
        onSettingsChange: vi.fn()
    }

    it('renders room header with room ID', () => {
        render(<RoomView {...defaultProps} />)
        expect(screen.getByText('123')).toBeInTheDocument()
    })

    it('renders local participant card', () => {
        render(<RoomView {...defaultProps} />)
        expect(screen.getByText('Alice (room.you)')).toBeInTheDocument()
    })

    it('toggles mute when mute button is clicked', () => {
        render(<RoomView {...defaultProps} />)
        const muteButton = screen.getByTitle('room.muteHint')
        fireEvent.click(muteButton)
        expect(defaultProps.onToggleMute).toHaveBeenCalled()
    })

    it('shows participant warning when limit reached', () => {
        const peers = new Map()
        // Add 8 peers to trigger warning
        for (let i = 0; i < 8; i++) peers.set(`p${i}`, { id: `p${i}`, name: `P${i}`, connectionState: 'connected' })

        render(<RoomView {...defaultProps} peers={peers} />)
        // Warning text contains "count" parameter which mock translation returns as "room.performanceWarning" if not handled perfectly,
        // but the key is consistent. Let's check for the key if simplistic mock, or part of logic.
        // The simplistic mock returns key. 
        // Warning component renders: t('room.performanceWarning', { count: ... })
        // If mock t returns key, we look for 'room.performanceWarning'
        expect(screen.getByText(/room.performanceWarning/)).toBeInTheDocument()
    })

    it('opens device settings panel', () => {
        render(<RoomView {...defaultProps} />)
        const settingsButton = screen.getByTitle('room.audioSettings')
        fireEvent.click(settingsButton)

        expect(screen.getByText('common.microphone')).toBeInTheDocument()
        expect(screen.getByText('common.speaker')).toBeInTheDocument()
    })

    it('renders screen share button and triggers toggle', () => {
        const peers = new Map([['p1', { id: 'p1', name: 'Peer 1', isMuted: false, isSpeakerMuted: false, audioLevel: 0, connectionState: 'connected' as const }]])
        render(<RoomView {...defaultProps} peers={peers} />)
        const button = screen.getByTestId('room-screenshare-btn')
        fireEvent.click(button)
        expect(defaultProps.onToggleScreenShare).toHaveBeenCalled()
    })

    it('shows incoming remote mic modal and handles accept/reject', () => {
        const onRespondRemoteMicRequest = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                remoteMicSession={{
                    state: 'pendingIncoming',
                    requestId: 'req-1',
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    expiresAt: Date.now() + 10000
                }}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={{
                    platform: 'win',
                    supported: true,
                    detected: true,
                    ready: true,
                    outputDeviceId: 'virtual',
                    outputDeviceLabel: 'CABLE Input',
                    expectedDeviceHint: 'CABLE Input (VB-CABLE)'
                }}
            />
        )

        expect(screen.getByText('remoteMic.incomingTitle')).toBeInTheDocument()
        fireEvent.click(screen.getByText('remoteMic.accept'))
        expect(onRespondRemoteMicRequest).toHaveBeenCalledWith(true)

        fireEvent.click(screen.getByText('remoteMic.reject'))
        expect(onRespondRemoteMicRequest).toHaveBeenCalledWith(false)
    })

    it('shows install-and-accept action when virtual mic device is not ready', () => {
        const onRespondRemoteMicRequest = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                localPlatform="win"
                remoteMicSession={{
                    state: 'pendingIncoming',
                    requestId: 'req-2',
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    needsVirtualDeviceSetup: true,
                    expiresAt: Date.now() + 10000
                }}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={{
                    platform: 'win',
                    supported: true,
                    detected: false,
                    ready: false,
                    outputDeviceId: null,
                    outputDeviceLabel: null,
                    expectedDeviceHint: 'CABLE Input (VB-CABLE)'
                }}
                virtualAudioInstallerState={{
                    inProgress: false,
                    platformSupported: true
                }}
            />
        )

        expect(screen.getByText('remoteMic.installAndAccept')).toBeInTheDocument()
        fireEvent.click(screen.getByText('remoteMic.installAndAccept'))
        expect(onRespondRemoteMicRequest).toHaveBeenCalledWith(true)
    })

    it('shows install-and-accept action on macOS targets when BlackHole is not ready', () => {
        const onRespondRemoteMicRequest = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                localPlatform="mac"
                remoteMicSession={{
                    state: 'pendingIncoming',
                    requestId: 'req-mac-1',
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    needsVirtualDeviceSetup: true,
                    expiresAt: Date.now() + 10000
                }}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={{
                    platform: 'mac',
                    supported: true,
                    detected: false,
                    ready: false,
                    outputDeviceId: null,
                    outputDeviceLabel: null,
                    expectedDeviceHint: 'BlackHole 2ch'
                }}
                virtualAudioInstallerState={{
                    inProgress: false,
                    platformSupported: true
                }}
            />
        )

        const installButton = screen.getByRole('button', { name: 'remoteMic.installAndAccept' }) as HTMLButtonElement
        expect(installButton.disabled).toBe(false)
        fireEvent.click(installButton)
        expect(onRespondRemoteMicRequest).toHaveBeenCalledWith(true)
    })

    it('shows installer pre-check warning and disables accept when bundled installer is unavailable', () => {
        const onRespondRemoteMicRequest = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                localPlatform="win"
                remoteMicSession={{
                    state: 'pendingIncoming',
                    requestId: 'req-2b',
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    needsVirtualDeviceSetup: true,
                    expiresAt: Date.now() + 10000
                }}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={{
                    platform: 'win',
                    supported: true,
                    detected: false,
                    ready: false,
                    outputDeviceId: null,
                    outputDeviceLabel: null,
                    expectedDeviceHint: 'CABLE Input (VB-CABLE)'
                }}
                virtualAudioInstallerState={{
                    inProgress: false,
                    platformSupported: true,
                    bundleReady: false,
                    bundleMessage: 'VB-CABLE installer binary missing.'
                }}
            />
        )

        expect(screen.getByText('remoteMic.installBundleMissing')).toBeInTheDocument()
        const installButton = screen.getByRole('button', { name: 'remoteMic.installAndAccept' }) as HTMLButtonElement
        expect(installButton.disabled).toBe(true)
        expect(onRespondRemoteMicRequest).not.toHaveBeenCalled()
    })

    it('disables incoming request controls while virtual driver is installing', () => {
        const onRespondRemoteMicRequest = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                localPlatform="win"
                remoteMicSession={{
                    state: 'pendingIncoming',
                    requestId: 'req-3',
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    needsVirtualDeviceSetup: true,
                    isInstallingVirtualDevice: true,
                    expiresAt: Date.now() + 10000
                }}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={{
                    platform: 'win',
                    supported: true,
                    detected: false,
                    ready: false,
                    outputDeviceId: null,
                    outputDeviceLabel: null,
                    expectedDeviceHint: 'CABLE Input (VB-CABLE)'
                }}
                virtualAudioInstallerState={{
                    inProgress: true,
                    platformSupported: true
                }}
            />
        )

        const rejectButton = screen.getByText('remoteMic.reject') as HTMLButtonElement
        const installButton = screen.getByRole('button', { name: 'remoteMic.installing' }) as HTMLButtonElement
        expect(rejectButton.disabled).toBe(true)
        expect(installButton.disabled).toBe(true)
    })

    it('triggers remote mic mapping request from peer card action', () => {
        const peers = new Map([
            ['p1', {
                id: 'p1',
                name: 'Peer 1',
                isMuted: false,
                isSpeakerMuted: false,
                audioLevel: 0,
                connectionState: 'connected' as const
            }]
        ])
        const onRequestRemoteMic = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                peers={peers}
                remoteMicSession={{ state: 'idle' }}
                onRequestRemoteMic={onRequestRemoteMic}
            />
        )

        fireEvent.click(screen.getByText('remoteMic.mapMic'))
        expect(onRequestRemoteMic).toHaveBeenCalledWith('p1')
    })

    it('calls onStopRemoteMic without passing click event payload', () => {
        const onStopRemoteMic = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                remoteMicSession={{
                    state: 'pendingOutgoing',
                    requestId: 'req-stop-1',
                    sourcePeerId: 'local-user',
                    targetPeerId: 'peer-1',
                    targetName: 'Bob',
                    role: 'source',
                    expiresAt: Date.now() + 10000
                }}
                onStopRemoteMic={onStopRemoteMic}
            />
        )

        fireEvent.click(screen.getByText('remoteMic.stop'))
        expect(onStopRemoteMic).toHaveBeenCalledWith()
    })
})
