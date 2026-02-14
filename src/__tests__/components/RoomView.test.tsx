/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RoomView } from '../../renderer/components/RoomView'
import {
    clickRemoteMicIncomingAction,
    expectRemoteMicIncomingControlsDisabled,
    createPeer,
    createRemoteMicSession,
    createRoomViewProps,
    createVirtualAudioInstallerState,
    createVirtualMicDeviceStatus,
    expectRemoteMicIncomingModal
} from '../helpers/roomViewTestUtils'

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
        ...createRoomViewProps({
            roomId: '123',
            localPeerId: 'local',
            selectedInputDevice: 'default',
            selectedVideoDevice: 'default',
            settings: {
                selectedInputDevice: 'default',
                selectedVideoDevice: 'default',
                selectedOutputDevice: 'default'
            }
        }),
        remoteMuteStatuses: new Map()
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
        for (let i = 0; i < 8; i++) peers.set(`p${i}`, createPeer({ id: `p${i}`, name: `P${i}` }))

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
        const peers = new Map([['p1', createPeer({ id: 'p1', name: 'Peer 1' })]])
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
                remoteMicSession={createRemoteMicSession({
                    state: 'pendingIncoming',
                    requestId: 'req-1',
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    expiresAt: Date.now() + 10000
                })}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={createVirtualMicDeviceStatus()}
            />
        )

        expectRemoteMicIncomingModal({ title: 'remoteMic.incomingTitle' })
        clickRemoteMicIncomingAction({
            actionLabel: 'remoteMic.accept',
            onRespondRemoteMicRequest,
            expectedAccepted: true
        })
        clickRemoteMicIncomingAction({
            actionLabel: 'remoteMic.reject',
            onRespondRemoteMicRequest,
            expectedAccepted: false
        })
    })

    it.each([
        {
            name: 'shows install-and-accept action when virtual mic device is not ready',
            platform: 'win' as const,
            requestId: 'req-2',
            expectedDeviceHint: 'CABLE Input (VB-CABLE)'
        },
        {
            name: 'shows install-and-accept action on macOS targets when BlackHole is not ready',
            platform: 'mac' as const,
            requestId: 'req-mac-1',
            expectedDeviceHint: 'BlackHole 2ch'
        }
    ])('$name', ({ platform, requestId, expectedDeviceHint }) => {
        const onRespondRemoteMicRequest = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                localPlatform={platform}
                remoteMicSession={createRemoteMicSession({
                    state: 'pendingIncoming',
                    requestId,
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    needsVirtualDeviceSetup: true,
                    expiresAt: Date.now() + 10000
                })}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={createVirtualMicDeviceStatus({
                    platform,
                    detected: false,
                    ready: false,
                    outputDeviceId: null,
                    outputDeviceLabel: null,
                    expectedDeviceHint
                })}
                virtualAudioInstallerState={createVirtualAudioInstallerState()}
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
                remoteMicSession={createRemoteMicSession({
                    state: 'pendingIncoming',
                    requestId: 'req-2b',
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    needsVirtualDeviceSetup: true,
                    expiresAt: Date.now() + 10000
                })}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={createVirtualMicDeviceStatus({
                    platform: 'win',
                    detected: false,
                    ready: false,
                    outputDeviceId: null,
                    outputDeviceLabel: null,
                    expectedDeviceHint: 'CABLE Input (VB-CABLE)'
                })}
                virtualAudioInstallerState={createVirtualAudioInstallerState({
                    bundleReady: false,
                    bundleMessage: 'VB-CABLE installer binary missing.'
                })}
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
                remoteMicSession={createRemoteMicSession({
                    state: 'pendingIncoming',
                    requestId: 'req-3',
                    sourcePeerId: 'peer-1',
                    sourceName: 'Bob',
                    role: 'target',
                    needsVirtualDeviceSetup: true,
                    isInstallingVirtualDevice: true,
                    expiresAt: Date.now() + 10000
                })}
                onRespondRemoteMicRequest={onRespondRemoteMicRequest}
                virtualMicDeviceStatus={createVirtualMicDeviceStatus({
                    platform: 'win',
                    detected: false,
                    ready: false,
                    outputDeviceId: null,
                    outputDeviceLabel: null,
                    expectedDeviceHint: 'CABLE Input (VB-CABLE)'
                })}
                virtualAudioInstallerState={createVirtualAudioInstallerState({ inProgress: true })}
            />
        )

        expectRemoteMicIncomingControlsDisabled({
            rejectLabel: 'remoteMic.reject',
            actionLabel: 'remoteMic.installing'
        })
    })

    it('triggers remote mic mapping request from peer card action', () => {
        const peers = new Map([
            ['p1', {
                ...createPeer({ id: 'p1', name: 'Peer 1' }),
            }]
        ])
        const onRequestRemoteMic = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                peers={peers}
                remoteMicSession={createRemoteMicSession()}
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
                remoteMicSession={createRemoteMicSession({
                    state: 'pendingOutgoing',
                    requestId: 'req-stop-1',
                    sourcePeerId: 'local-user',
                    targetPeerId: 'peer-1',
                    targetName: 'Bob',
                    role: 'source',
                    expiresAt: Date.now() + 10000
                })}
                onStopRemoteMic={onStopRemoteMic}
            />
        )

        fireEvent.click(screen.getByText('remoteMic.stop'))
        expect(onStopRemoteMic).toHaveBeenCalledWith()
    })

    it('shows moderation room-locked banner and queue when enabled', () => {
        render(
            <RoomView
                {...defaultProps}
                moderationEnabled={true}
                roomLocked={true}
                roomLockOwnerName="Host"
                raisedHands={[
                    { peerId: 'local', name: 'Alice', raisedAt: Date.now(), isLocal: true }
                ]}
            />
        )

        expect(screen.getByTestId('room-locked-banner')).toBeInTheDocument()
        expect(screen.getByTestId('raised-hands-queue')).toBeInTheDocument()
    })

    it('triggers moderation footer actions', () => {
        const onToggleRoomLock = vi.fn()
        const onRequestMuteAll = vi.fn()
        const onToggleHandRaise = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                moderationEnabled={true}
                roomLocked={false}
                isHandRaised={false}
                onToggleRoomLock={onToggleRoomLock}
                onRequestMuteAll={onRequestMuteAll}
                onToggleHandRaise={onToggleHandRaise}
            />
        )

        fireEvent.click(screen.getByTestId('room-lock-btn'))
        fireEvent.click(screen.getByTestId('room-mute-all-btn'))
        fireEvent.click(screen.getByTestId('room-hand-raise-btn'))

        expect(onToggleRoomLock).toHaveBeenCalled()
        expect(onRequestMuteAll).toHaveBeenCalled()
        expect(onToggleHandRaise).toHaveBeenCalled()
    })

    it('shows mute-all request modal and accepts/declines', () => {
        const onRespondMuteAllRequest = vi.fn()

        render(
            <RoomView
                {...defaultProps}
                moderationEnabled={true}
                pendingMuteAllRequest={{
                    requestId: 'mute-req-1',
                    requestedByPeerId: 'peer-1',
                    requestedByName: 'Host'
                }}
                onRespondMuteAllRequest={onRespondMuteAllRequest}
            />
        )

        fireEvent.click(screen.getByText('moderation.acceptAndMute'))
        fireEvent.click(screen.getByText('moderation.decline'))

        expect(onRespondMuteAllRequest).toHaveBeenCalledWith('mute-req-1', true)
        expect(onRespondMuteAllRequest).toHaveBeenCalledWith('mute-req-1', false)
    })
})
