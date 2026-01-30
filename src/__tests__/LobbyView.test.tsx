
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LobbyView } from '../renderer/components/LobbyView';
import '@testing-library/jest-dom';

// Mocks
vi.mock('../renderer/hooks/useI18n', () => ({
    useI18n: () => ({
        t: (key: string) => key,
    })
}));

vi.mock('../renderer/utils/Logger', () => ({
    UILog: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}));

vi.mock('../renderer/audio-processor/AudioPipeline', () => ({
    getAudioPipeline: () => ({
        initialize: vi.fn(),
        connectInputStream: vi.fn(),
        getAnalyserNode: vi.fn().mockReturnValue({
            frequencyBinCount: 128,
            getByteFrequencyData: vi.fn(),
        }),
        disconnect: vi.fn(),
    })
}));

// Mock DeviceSelector to avoid complexity
vi.mock('../renderer/components/DeviceSelector', () => ({
    DeviceSelector: ({ onSelect }: any) => <select data-testid="device-select" onChange={e => onSelect(e.target.value)} />
}));

vi.mock('../renderer/components/AudioMeter', () => ({
    AudioMeter: () => <div data-testid="audio-meter" />
}));

describe('LobbyView', () => {
    const mockOnJoinRoom = vi.fn();
    const mockProps = {
        onJoinRoom: mockOnJoinRoom,
        inputDevices: [],
        outputDevices: [],
        selectedInputDevice: null,
        selectedOutputDevice: null,
        onInputDeviceChange: vi.fn(),
        onOutputDeviceChange: vi.fn(),
        onRefreshDevices: vi.fn(),
        audioLevel: 0,
        isLoading: false,
        onOpenSettings: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Mock getUserMedia
        Object.defineProperty(global.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockResolvedValue({
                    getTracks: () => [{ stop: vi.fn() }]
                })
            },
            writable: true
        });

        // Mock localStorage
        Storage.prototype.getItem = vi.fn();
        Storage.prototype.setItem = vi.fn();
    });

    it('should render correctly', () => {
        render(<LobbyView {...mockProps} />);
        expect(screen.getByTestId('lobby-title')).toBeInTheDocument();
        expect(screen.getByTestId('lobby-join-btn')).toBeInTheDocument();
    });

    it('should validate inputs before joining', () => {
        render(<LobbyView {...mockProps} />);
        const joinBtn = screen.getByTestId('lobby-join-btn');
        const nameInput = screen.getByTestId('lobby-name-input');
        const roomInput = screen.getByTestId('lobby-room-input');

        // Empty inputs
        fireEvent.click(joinBtn);
        // Alert is mocked? No, window.alert needs mock.

        // Enter invalid data
        fireEvent.change(nameInput, { target: { value: 'A' } });
        fireEvent.change(roomInput, { target: { value: '123' } });
        fireEvent.click(joinBtn);
        expect(mockOnJoinRoom).not.toHaveBeenCalled();
    });

    it('should join room with valid inputs', async () => {
        // Mock alert
        window.alert = vi.fn();

        render(<LobbyView {...mockProps} />);
        const joinBtn = screen.getByTestId('lobby-join-btn');
        const nameInput = screen.getByTestId('lobby-name-input');
        const roomInput = screen.getByTestId('lobby-room-input');

        fireEvent.change(nameInput, { target: { value: 'TestUser' } });
        fireEvent.change(roomInput, { target: { value: 'TestRoom' } });

        fireEvent.click(joinBtn);

        await waitFor(() => {
            expect(mockOnJoinRoom).toHaveBeenCalledWith('TestRoom', 'TestUser');
        });
    });

    it('should generate room ID', () => {
        render(<LobbyView {...mockProps} />);
        const generateBtn = screen.getByTestId('lobby-generate-btn');
        const roomInput = screen.getByTestId('lobby-room-input') as HTMLInputElement;

        fireEvent.click(generateBtn);
        expect(roomInput.value).not.toBe('');
        expect(roomInput.value.length).toBeGreaterThan(0);
    });
});
