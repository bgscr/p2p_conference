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
})
