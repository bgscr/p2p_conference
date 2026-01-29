/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LobbyView } from '../../renderer/components/LobbyView'

// Mock useI18n
vi.mock('../../renderer/hooks/useI18n', () => ({
    useI18n: () => ({
        t: (key: string) => {
            const translations: Record<string, string> = {
                'app.name': 'P2P Conference',
                'app.tagline': 'Serverless Audio Conferencing',
                'app.version': 'v1.0.0',
                'lobby.yourName': 'Your Name',
                'lobby.enterName': 'Enter your name',
                'lobby.roomId': 'Room ID',
                'lobby.enterRoomId': 'Enter room ID',
                'lobby.generate': 'Generate',
                'lobby.shareRoomId': 'Share this ID with others to join',
                'lobby.roomIdSecurityWarning': 'Short room IDs are easier to guess',
                'lobby.audioSetup': 'Audio Setup',
                'lobby.testMicrophone': 'Test Microphone',
                'lobby.stopTest': 'Stop Test',
                'lobby.microphone': 'Microphone',
                'lobby.speaker': 'Speaker',
                'lobby.inputLevel': 'Input Level',
                'lobby.micWorking': 'Microphone is working',
                'lobby.privacyNotice': 'Privacy Notice',
                'lobby.privacyText': 'Your IP will be visible to others',
                'lobby.joinRoom': 'Join Room',
                'lobby.joining': 'Joining...',
                'lobby.settings': 'Settings',
                'lobby.roomIdMinLength': 'Room ID must be at least 4 characters',
                'lobby.nameMinLength': 'Name must be at least 2 characters',
                'lobby.micPermissionDenied': 'Microphone permission denied'
            }
            return translations[key] || key
        }
    })
}))

// Mock Logger
vi.mock('../../renderer/utils/Logger', () => ({
    UILog: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

// Mock AudioPipeline
const mockInitialize = vi.fn().mockResolvedValue(undefined)
const mockConnectInputStream = vi.fn().mockResolvedValue(undefined)
const mockDisconnect = vi.fn()
const mockGetAnalyserNode = vi.fn().mockReturnValue({
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn()
})

vi.mock('../../renderer/audio-processor/AudioPipeline', () => ({
    getAudioPipeline: () => ({
        initialize: mockInitialize,
        connectInputStream: mockConnectInputStream,
        disconnect: mockDisconnect,
        getAnalyserNode: mockGetAnalyserNode
    })
}))

// Mock DeviceSelector component
vi.mock('../../renderer/components/DeviceSelector', () => ({
    DeviceSelector: ({ label, devices, selectedDeviceId, onSelect }: any) => (
        <div data-testid={`device-selector-${label}`}>
            <select 
                value={selectedDeviceId || ''} 
                onChange={(e) => onSelect(e.target.value)}
                data-testid={`select-${label}`}
            >
                {devices.map((d: any) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
            </select>
        </div>
    )
}))

// Mock AudioMeter component
vi.mock('../../renderer/components/AudioMeter', () => ({
    AudioMeter: ({ level }: { level: number }) => (
        <div data-testid="audio-meter" data-level={level}>Audio Level: {level}</div>
    )
}))

// Mock crypto.getRandomValues
Object.defineProperty(global, 'crypto', {
    value: {
        getRandomValues: (arr: Uint32Array) => {
            for (let i = 0; i < arr.length; i++) {
                arr[i] = Math.floor(Math.random() * 0xFFFFFFFF)
            }
            return arr
        }
    }
})

// Mock localStorage
const localStorageMock = {
    store: {} as Record<string, string>,
    getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
        localStorageMock.store[key] = value
    }),
    clear: vi.fn(() => {
        localStorageMock.store = {}
    })
}
Object.defineProperty(global, 'localStorage', { value: localStorageMock })

// Mock alert
global.alert = vi.fn()

describe('LobbyView', () => {
    const mockInputDevices = [
        { deviceId: 'mic1', label: 'Mic 1', kind: 'audioinput' as const, groupId: '1' },
        { deviceId: 'mic2', label: 'Mic 2', kind: 'audioinput' as const, groupId: '2' }
    ]
    const mockOutputDevices = [
        { deviceId: 'speaker1', label: 'Speaker 1', kind: 'audiooutput' as const, groupId: '1' }
    ]

    const defaultProps = {
        onJoinRoom: vi.fn(),
        inputDevices: mockInputDevices,
        outputDevices: mockOutputDevices,
        selectedInputDevice: 'mic1',
        selectedOutputDevice: 'speaker1',
        onInputDeviceChange: vi.fn(),
        onOutputDeviceChange: vi.fn(),
        onRefreshDevices: vi.fn(),
        audioLevel: 0,
        isLoading: false,
        onOpenSettings: vi.fn()
    }

    beforeEach(() => {
        vi.clearAllMocks()
        localStorageMock.clear()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('renders lobby header', () => {
        render(<LobbyView {...defaultProps} />)
        
        expect(screen.getByText('P2P Conference')).toBeInTheDocument()
        expect(screen.getByText('Serverless Audio Conferencing')).toBeInTheDocument()
    })

    it('renders name input field', () => {
        render(<LobbyView {...defaultProps} />)
        
        expect(screen.getByText('Your Name')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument()
    })

    it('renders room ID input field', () => {
        render(<LobbyView {...defaultProps} />)
        
        expect(screen.getByText('Room ID')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Enter room ID')).toBeInTheDocument()
    })

    it('generates random room ID when generate button is clicked', () => {
        render(<LobbyView {...defaultProps} />)
        
        const generateBtn = screen.getByText('Generate')
        fireEvent.click(generateBtn)
        
        const roomInput = screen.getByPlaceholderText('Enter room ID') as HTMLInputElement
        expect(roomInput.value.length).toBe(12) // Generated ID should be 12 characters
    })

    it('shows security warning for short room IDs', () => {
        render(<LobbyView {...defaultProps} />)
        
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        fireEvent.change(roomInput, { target: { value: 'abc' } })
        
        expect(screen.getByText('Short room IDs are easier to guess')).toBeInTheDocument()
    })

    it('calls onJoinRoom when join button is clicked with valid inputs', async () => {
        const onJoinRoom = vi.fn()
        render(<LobbyView {...defaultProps} onJoinRoom={onJoinRoom} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name')
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        
        fireEvent.change(nameInput, { target: { value: 'Test User' } })
        fireEvent.change(roomInput, { target: { value: 'test-room-123' } })
        
        const joinBtn = screen.getByText('Join Room')
        
        await act(async () => {
            fireEvent.click(joinBtn)
            vi.advanceTimersByTime(200)
        })
        
        expect(onJoinRoom).toHaveBeenCalledWith('test-room-123', 'Test User')
    })

    it('disables join button for room ID less than 4 characters', () => {
        render(<LobbyView {...defaultProps} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name')
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        
        fireEvent.change(nameInput, { target: { value: 'Test User' } })
        fireEvent.change(roomInput, { target: { value: 'ab' } }) // 2 chars, less than 4
        
        const joinBtn = screen.getByText('Join Room')
        
        // Button should be disabled, preventing the alert from being called
        expect(joinBtn.closest('button')).toBeDisabled()
    })

    it('shows alert for name less than 2 characters when room ID is valid', async () => {
        render(<LobbyView {...defaultProps} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name')
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        
        fireEvent.change(nameInput, { target: { value: 'A' } }) // 1 char, less than 2
        fireEvent.change(roomInput, { target: { value: 'test-room' } }) // Valid room ID
        
        const joinBtn = screen.getByText('Join Room')
        
        await act(async () => {
            fireEvent.click(joinBtn)
        })
        
        expect(global.alert).toHaveBeenCalledWith('Name must be at least 2 characters')
    })

    it('toggles privacy notice when clicked', () => {
        render(<LobbyView {...defaultProps} />)
        
        // Initially collapsed
        expect(screen.queryByText('Your IP will be visible to others')).not.toBeInTheDocument()
        
        // Click to expand
        const privacyNotice = screen.getByText('Privacy Notice')
        fireEvent.click(privacyNotice.closest('div')!)
        
        expect(screen.getByText('Your IP will be visible to others')).toBeInTheDocument()
        
        // Click to collapse
        fireEvent.click(privacyNotice.closest('div')!)
        
        expect(screen.queryByText('Your IP will be visible to others')).not.toBeInTheDocument()
    })

    it('calls onOpenSettings when settings button is clicked', () => {
        const onOpenSettings = vi.fn()
        render(<LobbyView {...defaultProps} onOpenSettings={onOpenSettings} />)
        
        const settingsBtn = screen.getByText('Settings')
        fireEvent.click(settingsBtn)
        
        expect(onOpenSettings).toHaveBeenCalledTimes(1)
    })

    it('disables join button when loading', () => {
        render(<LobbyView {...defaultProps} isLoading={true} />)
        
        // The text is inside a span, so we need to find the button parent
        const joiningText = screen.getByText('Joining...')
        const joinBtn = joiningText.closest('button')
        expect(joinBtn).toBeDisabled()
    })

    it('loads saved username from localStorage', () => {
        localStorageMock.store['p2p-conf-username'] = 'Saved User'
        
        render(<LobbyView {...defaultProps} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name') as HTMLInputElement
        expect(nameInput.value).toBe('Saved User')
    })

    it('saves username to localStorage when changed', () => {
        render(<LobbyView {...defaultProps} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name')
        fireEvent.change(nameInput, { target: { value: 'New Name' } })
        
        expect(localStorageMock.setItem).toHaveBeenCalledWith('p2p-conf-username', 'New Name')
    })

    it('renders device selectors', () => {
        render(<LobbyView {...defaultProps} />)
        
        expect(screen.getByTestId('device-selector-Microphone')).toBeInTheDocument()
        expect(screen.getByTestId('device-selector-Speaker')).toBeInTheDocument()
    })

    it('shows test microphone button', () => {
        render(<LobbyView {...defaultProps} />)
        
        expect(screen.getByText(/Test Microphone/)).toBeInTheDocument()
    })

    it('renders version in footer', () => {
        render(<LobbyView {...defaultProps} />)
        
        expect(screen.getByText(/v1.0.0/)).toBeInTheDocument()
    })

    it('enables join button when room ID is exactly 4 characters', () => {
        render(<LobbyView {...defaultProps} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name')
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        
        fireEvent.change(nameInput, { target: { value: 'Test User' } })
        fireEvent.change(roomInput, { target: { value: 'abcd' } }) // Exactly 4 chars
        
        const joinBtn = screen.getByText('Join Room').closest('button')
        expect(joinBtn).not.toBeDisabled()
    })

    it('enables join button when room ID is more than 4 characters', () => {
        render(<LobbyView {...defaultProps} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name')
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        
        fireEvent.change(nameInput, { target: { value: 'Test User' } })
        fireEvent.change(roomInput, { target: { value: 'abcdefghij' } }) // 10 chars
        
        const joinBtn = screen.getByText('Join Room').closest('button')
        expect(joinBtn).not.toBeDisabled()
    })

    it('hides security warning when room ID is 8 or more characters', () => {
        render(<LobbyView {...defaultProps} />)
        
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        
        // First show warning with short ID
        fireEvent.change(roomInput, { target: { value: 'abc' } })
        expect(screen.queryByText('Short room IDs are easier to guess')).toBeInTheDocument()
        
        // Then hide with longer ID
        fireEvent.change(roomInput, { target: { value: 'abcdefgh' } }) // 8 chars
        expect(screen.queryByText('Short room IDs are easier to guess')).not.toBeInTheDocument()
    })

    it('does not show security warning for empty room ID', () => {
        render(<LobbyView {...defaultProps} />)
        
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        fireEvent.change(roomInput, { target: { value: '' } })
        
        expect(screen.queryByText('Short room IDs are easier to guess')).not.toBeInTheDocument()
    })

    it('handles device selector callbacks', () => {
        const onInputDeviceChange = vi.fn()
        const onOutputDeviceChange = vi.fn()
        
        render(<LobbyView 
            {...defaultProps} 
            onInputDeviceChange={onInputDeviceChange}
            onOutputDeviceChange={onOutputDeviceChange}
        />)
        
        // Change input device
        const micSelect = screen.getByTestId('select-Microphone')
        fireEvent.change(micSelect, { target: { value: 'mic2' } })
        expect(onInputDeviceChange).toHaveBeenCalledWith('mic2')
        
        // Change output device  
        const speakerSelect = screen.getByTestId('select-Speaker')
        fireEvent.change(speakerSelect, { target: { value: 'speaker1' } })
        expect(onOutputDeviceChange).toHaveBeenCalledWith('speaker1')
    })

    it('generates unique room IDs on multiple clicks', () => {
        render(<LobbyView {...defaultProps} />)
        
        const generateBtn = screen.getByText('Generate')
        const roomInput = screen.getByPlaceholderText('Enter room ID') as HTMLInputElement
        
        fireEvent.click(generateBtn)
        const firstId = roomInput.value
        
        fireEvent.click(generateBtn)
        const secondId = roomInput.value
        
        // IDs should be different (with high probability)
        expect(firstId).not.toBe(secondId)
    })

    it('does not call onJoinRoom when button is disabled', async () => {
        const onJoinRoom = vi.fn()
        render(<LobbyView {...defaultProps} onJoinRoom={onJoinRoom} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name')
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        
        fireEvent.change(nameInput, { target: { value: 'Test User' } })
        fireEvent.change(roomInput, { target: { value: 'ab' } }) // Too short
        
        const joinBtn = screen.getByText('Join Room')
        
        await act(async () => {
            fireEvent.click(joinBtn)
        })
        
        // Should not call onJoinRoom because button is disabled
        expect(onJoinRoom).not.toHaveBeenCalled()
    })

    it('trims whitespace from room ID and name before joining', async () => {
        const onJoinRoom = vi.fn()
        render(<LobbyView {...defaultProps} onJoinRoom={onJoinRoom} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name')
        const roomInput = screen.getByPlaceholderText('Enter room ID')
        
        fireEvent.change(nameInput, { target: { value: '  Test User  ' } })
        fireEvent.change(roomInput, { target: { value: '  test-room  ' } })
        
        const joinBtn = screen.getByText('Join Room')
        
        await act(async () => {
            fireEvent.click(joinBtn)
            vi.advanceTimersByTime(200)
        })
        
        expect(onJoinRoom).toHaveBeenCalledWith('test-room', 'Test User')
    })

    it('respects max length for room ID input', () => {
        render(<LobbyView {...defaultProps} />)
        
        const roomInput = screen.getByPlaceholderText('Enter room ID') as HTMLInputElement
        expect(roomInput).toHaveAttribute('maxLength', '32')
    })

    it('respects max length for name input', () => {
        render(<LobbyView {...defaultProps} />)
        
        const nameInput = screen.getByPlaceholderText('Enter your name') as HTMLInputElement
        expect(nameInput).toHaveAttribute('maxLength', '32')
    })

    it('shows joining state during loading', () => {
        render(<LobbyView {...defaultProps} isLoading={true} />)
        
        expect(screen.getByText('Joining...')).toBeInTheDocument()
        expect(screen.queryByText('Join Room')).not.toBeInTheDocument()
    })

    it('handles empty device lists gracefully', () => {
        render(<LobbyView 
            {...defaultProps} 
            inputDevices={[]} 
            outputDevices={[]} 
        />)
        
        // Should render device selectors even with empty lists
        expect(screen.getByTestId('device-selector-Microphone')).toBeInTheDocument()
        expect(screen.getByTestId('device-selector-Speaker')).toBeInTheDocument()
    })

    it('handles null selected devices gracefully', () => {
        render(<LobbyView 
            {...defaultProps} 
            selectedInputDevice={null} 
            selectedOutputDevice={null} 
        />)
        
        // Should render without errors
        expect(screen.getByText('P2P Conference')).toBeInTheDocument()
    })
})
