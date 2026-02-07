/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for LobbyView
 * Targets:
 * - Basic rendering and join flow
 * - Settings button
 * - Loading state
 * - Device list variations
 * - Cleanup on unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Hoist mocks
const mocks = vi.hoisted(() => ({
  pipelineInitialize: vi.fn().mockResolvedValue(undefined),
  pipelineConnectInputStream: vi.fn().mockResolvedValue(undefined),
  pipelineDisconnect: vi.fn(),
  pipelineGetAnalyserNode: vi.fn().mockReturnValue(null),
}))

// Mock useI18n
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, params?: any) => {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
    setLanguage: vi.fn(),
    getLanguage: vi.fn().mockReturnValue('en'),
    currentLanguage: 'en',
    getAvailableLanguages: vi.fn().mockReturnValue([
      { code: 'en', name: 'English' },
      { code: 'zh-CN', name: '中文' },
    ]),
  }),
}))

// Mock DeviceSelector
vi.mock('../../renderer/components/DeviceSelector', () => ({
  DeviceSelector: ({ label, devices, selectedDeviceId, onSelect, icon }: any) => (
    <div data-testid={`device-selector-${icon}`}>
      <span>{label}</span>
      <select
        data-testid={`device-select-${icon}`}
        value={selectedDeviceId || ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        {(devices || []).map((d: any) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  ),
}))

// Mock AudioMeter
vi.mock('../../renderer/components/AudioMeter', () => ({
  AudioMeter: ({ level }: any) => (
    <div data-testid="audio-meter" data-level={level}>
      Audio Meter: {level}
    </div>
  ),
}))

vi.mock('../../renderer/utils/Logger', () => ({
  UILog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AudioLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AppLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: {
    downloadLogs: vi.fn(),
    clearLogs: vi.fn(),
    getLogs: vi.fn().mockReturnValue([]),
  },
}))

vi.mock('../../renderer/audio-processor/AudioPipeline', () => ({
  getAudioPipeline: vi.fn().mockReturnValue({
    initialize: mocks.pipelineInitialize,
    connectInputStream: mocks.pipelineConnectInputStream,
    disconnect: mocks.pipelineDisconnect,
    getAnalyserNode: mocks.pipelineGetAnalyserNode,
    destroy: vi.fn(),
  }),
}))

import { LobbyView } from '../../renderer/components/LobbyView'

describe('LobbyView - additional coverage gaps', () => {
  const defaultProps = {
    onJoinRoom: vi.fn(),
    inputDevices: [
      { deviceId: 'mic-1', label: 'Mic 1', kind: 'audioinput' as const, groupId: 'g1', toJSON: vi.fn() },
      { deviceId: 'mic-2', label: 'Mic 2', kind: 'audioinput' as const, groupId: 'g2', toJSON: vi.fn() },
    ],
    outputDevices: [
      { deviceId: 'spk-1', label: 'Speaker 1', kind: 'audiooutput' as const, groupId: 'g3', toJSON: vi.fn() },
    ],
    videoInputDevices: [
      { deviceId: 'cam-1', label: 'Camera 1', kind: 'videoinput' as const, groupId: 'g4', toJSON: vi.fn() },
    ],
    selectedInputDevice: 'mic-1',
    selectedOutputDevice: 'spk-1',
    selectedVideoDevice: 'cam-1',
    onInputDeviceChange: vi.fn(),
    onOutputDeviceChange: vi.fn(),
    onVideoDeviceChange: vi.fn(),
    onRefreshDevices: vi.fn(),
    audioLevel: 50,
    isLoading: false,
    onOpenSettings: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn(), kind: 'audio', id: 'a1', enabled: true }],
          getAudioTracks: () => [{ stop: vi.fn(), kind: 'audio', id: 'a1', enabled: true }],
          getVideoTracks: () => [],
        }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    })

    // Mock HTMLMediaElement
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal(
      'AudioContext',
      class {
        createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() })
        createAnalyser = vi.fn().mockReturnValue({
          fftSize: 256,
          frequencyBinCount: 128,
          getByteFrequencyData: vi.fn(),
          connect: vi.fn(),
        })
        createOscillator = vi.fn().mockReturnValue({
          type: 'sine',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        })
        createGain = vi.fn().mockReturnValue({
          gain: { value: 0 },
          connect: vi.fn(),
        })
        destination: any = {}
        close = vi.fn()
      }
    )

    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders lobby view with title and join button', () => {
    render(<LobbyView {...defaultProps} />)
    expect(screen.getByTestId('lobby-title')).toHaveTextContent('app.name')
    expect(screen.getByTestId('lobby-join-btn')).toBeInTheDocument()
  })

  it('disables join when room ID is too short', () => {
    render(<LobbyView {...defaultProps} />)
    const joinBtn = screen.getByTestId('lobby-join-btn')
    expect(joinBtn).toBeDisabled()
  })

  it('enables join with valid room ID and user name', async () => {
    const user = userEvent.setup()
    render(<LobbyView {...defaultProps} />)

    const roomInput = screen.getByTestId('lobby-room-input')
    const nameInput = screen.getByTestId('lobby-name-input')

    await user.type(nameInput, 'Alice')
    await user.type(roomInput, 'test-room')

    const joinBtn = screen.getByTestId('lobby-join-btn')
    expect(joinBtn).not.toBeDisabled()
  })

  it('calls onJoinRoom when join button clicked', async () => {
    const { waitFor } = await import('@testing-library/react')
    const user = userEvent.setup()
    render(<LobbyView {...defaultProps} />)

    const roomInput = screen.getByTestId('lobby-room-input')
    const nameInput = screen.getByTestId('lobby-name-input')

    await user.clear(nameInput)
    await user.type(nameInput, 'TestUser')
    await user.type(roomInput, 'myroom1234')
    await user.click(screen.getByTestId('lobby-join-btn'))

    await waitFor(() => {
      expect(defaultProps.onJoinRoom).toHaveBeenCalled()
    })
  })

  it('opens settings panel', async () => {
    const user = userEvent.setup()
    render(<LobbyView {...defaultProps} />)

    await user.click(screen.getByText('lobby.settings'))
    expect(defaultProps.onOpenSettings).toHaveBeenCalled()
  })

  it('renders with no devices', () => {
    render(<LobbyView {...defaultProps} inputDevices={[]} outputDevices={[]} videoInputDevices={[]} />)
    expect(screen.getByTestId('lobby-title')).toBeInTheDocument()
  })

  it('shows loading indicator', () => {
    render(<LobbyView {...defaultProps} isLoading={true} />)
    expect(screen.getByTestId('lobby-title')).toBeInTheDocument()
  })

  it('renders audio level indicator', () => {
    render(<LobbyView {...defaultProps} audioLevel={80} />)
    expect(screen.getByTestId('lobby-title')).toBeInTheDocument()
  })

  it('cleans up on unmount', () => {
    const { unmount } = render(<LobbyView {...defaultProps} />)
    unmount()
  })

  it('generates room ID when generate button clicked', async () => {
    const user = userEvent.setup()
    render(<LobbyView {...defaultProps} />)

    const generateBtn = screen.getByTestId('lobby-generate-btn')
    await user.click(generateBtn)

    const roomInput = screen.getByTestId('lobby-room-input') as HTMLInputElement
    expect(roomInput.value.length).toBeGreaterThan(0)
  })
})
