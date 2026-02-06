/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

// Hoist mocks
const mocks = vi.hoisted(() => ({
  pipelineInitialize: vi.fn().mockResolvedValue(undefined),
  pipelineConnectInputStream: vi.fn().mockResolvedValue(undefined),
  pipelineDisconnect: vi.fn(),
  pipelineGetAnalyserNode: vi.fn(),
  getUserMedia: vi.fn(),
}))

// --- Mock child components ---
vi.mock('../renderer/components/DeviceSelector', () => ({
  DeviceSelector: ({ label, devices, selectedDeviceId, onSelect, icon }: any) => (
    <div data-testid={`device-selector-${icon}`}>
      <span>{label}</span>
      <select
        data-testid={`device-select-${icon}`}
        value={selectedDeviceId || ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        {(devices || []).map((d: any) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>
    </div>
  ),
}))

vi.mock('../renderer/components/AudioMeter', () => ({
  AudioMeter: ({ level }: any) => (
    <div data-testid="audio-meter" data-level={level}>Audio Meter: {level}</div>
  ),
}))

// --- Mock hooks and services ---
vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, _params?: Record<string, any>) => key,
    currentLanguage: 'en',
    setLanguage: vi.fn(),
    getAvailableLanguages: vi.fn().mockReturnValue([]),
  }),
}))

vi.mock('../renderer/utils/Logger', () => ({
  UILog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logger: {
    downloadLogs: vi.fn(),
    clearLogs: vi.fn(),
    getLogs: vi.fn().mockReturnValue([]),
  },
}))

vi.mock('../renderer/audio-processor/AudioPipeline', () => ({
  getAudioPipeline: vi.fn().mockReturnValue({
    initialize: mocks.pipelineInitialize,
    connectInputStream: mocks.pipelineConnectInputStream,
    disconnect: mocks.pipelineDisconnect,
    getAnalyserNode: mocks.pipelineGetAnalyserNode,
    destroy: vi.fn(),
  }),
}))

// Import after mocks
import { LobbyView } from '../renderer/components/LobbyView'
import { UILog } from '../renderer/utils/Logger'

// Helper: default props for LobbyView
function defaultProps(overrides: Partial<React.ComponentProps<typeof LobbyView>> = {}) {
  return {
    onJoinRoom: vi.fn(),
    inputDevices: [],
    outputDevices: [],
    videoInputDevices: [],
    selectedInputDevice: 'input-1',
    selectedOutputDevice: 'output-1',
    selectedVideoDevice: 'video-1',
    onInputDeviceChange: vi.fn(),
    onOutputDeviceChange: vi.fn(),
    onVideoDeviceChange: vi.fn(),
    onRefreshDevices: vi.fn(),
    audioLevel: 0,
    isLoading: false,
    onOpenSettings: vi.fn(),
    ...overrides,
  }
}

describe('LobbyView', () => {
  let user: ReturnType<typeof userEvent.setup>
  let mockGetUserMedia: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup()
    localStorage.clear()

    // Setup navigator.mediaDevices.getUserMedia mock
    const mockTrack = { stop: vi.fn(), kind: 'audio', id: 'track-1', label: 'Test', enabled: true }
    const mockStream = {
      getTracks: () => [mockTrack],
      getAudioTracks: () => [mockTrack],
      getVideoTracks: () => [],
      id: 'mock-stream-1',
    }
    mockGetUserMedia = vi.fn().mockResolvedValue(mockStream)
    mocks.getUserMedia = mockGetUserMedia

    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    })

    // Mock crypto.getRandomValues
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: (arr: Uint32Array) => {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 4294967296)
          }
          return arr
        },
      },
      writable: true,
      configurable: true,
    })

    // Mock requestAnimationFrame / cancelAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((_cb) => {
      return 42 as unknown as number
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { })

    // Mock HTMLVideoElement.play to return a Promise (jsdom doesn't implement it)
    HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined)

    // Default analyser mock
    mocks.pipelineGetAnalyserNode.mockReturnValue({
      frequencyBinCount: 4,
      getByteFrequencyData: vi.fn((arr: Uint8Array) => {
        arr[0] = 100
        arr[1] = 100
        arr[2] = 100
        arr[3] = 100
      }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- Basic Rendering ---
  it('renders the lobby title', () => {
    render(<LobbyView {...defaultProps()} />)
    expect(screen.getByTestId('lobby-title')).toHaveTextContent('app.name')
  })

  it('renders the form inputs', () => {
    render(<LobbyView {...defaultProps()} />)
    expect(screen.getByTestId('lobby-name-input')).toBeInTheDocument()
    expect(screen.getByTestId('lobby-room-input')).toBeInTheDocument()
    expect(screen.getByTestId('lobby-generate-btn')).toBeInTheDocument()
    expect(screen.getByTestId('lobby-join-btn')).toBeInTheDocument()
  })

  it('loads stored username from localStorage', () => {
    localStorage.setItem('p2p-conf-username', 'StoredUser')
    render(<LobbyView {...defaultProps()} />)
    expect(screen.getByTestId('lobby-name-input')).toHaveValue('StoredUser')
  })

  it('generates a random username when no stored username', () => {
    render(<LobbyView {...defaultProps()} />)
    const input = screen.getByTestId('lobby-name-input') as HTMLInputElement
    expect(input.value).toMatch(/^User-/)
  })

  // --- handleUserNameChange ---
  it('updates username and persists to localStorage', async () => {
    render(<LobbyView {...defaultProps()} />)
    const input = screen.getByTestId('lobby-name-input')

    await user.clear(input)
    await user.type(input, 'NewName')

    expect(input).toHaveValue('NewName')
    expect(localStorage.getItem('p2p-conf-username')).toBe('NewName')
  })

  // --- handleGenerateRoom ---
  it('generates a room ID when generate button is clicked', async () => {
    render(<LobbyView {...defaultProps()} />)
    const roomInput = screen.getByTestId('lobby-room-input') as HTMLInputElement

    expect(roomInput.value).toBe('')
    await user.click(screen.getByTestId('lobby-generate-btn'))

    expect(roomInput.value.length).toBe(12)
    expect(UILog.debug).toHaveBeenCalledWith('Generated room ID', expect.any(Object))
  })

  // --- Room ID Security Warning ---
  it('shows security warning for short room IDs (1-7 chars)', async () => {
    render(<LobbyView {...defaultProps()} />)
    const roomInput = screen.getByTestId('lobby-room-input')

    await user.type(roomInput, 'abc')
    expect(screen.getByText('lobby.roomIdSecurityWarning')).toBeInTheDocument()
  })

  it('does not show security warning for empty room ID', () => {
    render(<LobbyView {...defaultProps()} />)
    expect(screen.queryByText('lobby.roomIdSecurityWarning')).not.toBeInTheDocument()
  })

  it('does not show security warning for room IDs >= 8 chars', async () => {
    render(<LobbyView {...defaultProps()} />)
    const roomInput = screen.getByTestId('lobby-room-input')

    await user.type(roomInput, 'abcdefgh')
    expect(screen.queryByText('lobby.roomIdSecurityWarning')).not.toBeInTheDocument()
  })

  // --- handleJoin validation paths ---
  it('alerts when room ID is too short (< 4 chars after trim)', async () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { })
    const props = defaultProps()
    render(<LobbyView {...props} />)

    const roomInput = screen.getByTestId('lobby-room-input')

    // Type 4 chars including trailing spaces: "a   " -> roomId.length=4 (button enabled), trim="a" (length 1 < 4)
    await user.type(roomInput, 'a   ')

    const joinBtn = screen.getByTestId('lobby-join-btn')
    await user.click(joinBtn)

    expect(alertMock).toHaveBeenCalledWith('lobby.roomIdMinLength')
    expect(props.onJoinRoom).not.toHaveBeenCalled()

    alertMock.mockRestore()
  })

  it('alerts when username is too short (< 2 chars)', async () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { })
    const props = defaultProps()
    render(<LobbyView {...props} />)

    // Set a valid room ID
    const roomInput = screen.getByTestId('lobby-room-input')
    await user.type(roomInput, 'validroom')

    // Set a very short username
    const nameInput = screen.getByTestId('lobby-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'A')

    const joinBtn = screen.getByTestId('lobby-join-btn')
    await user.click(joinBtn)

    expect(alertMock).toHaveBeenCalledWith('lobby.nameMinLength')
    expect(props.onJoinRoom).not.toHaveBeenCalled()

    alertMock.mockRestore()
  })

  it('calls onJoinRoom with correct args on successful join', async () => {
    const props = defaultProps()
    render(<LobbyView {...props} />)

    const roomInput = screen.getByTestId('lobby-room-input')
    const nameInput = screen.getByTestId('lobby-name-input')

    await user.clear(nameInput)
    await user.type(nameInput, 'TestUser')
    await user.type(roomInput, 'myroom1234')

    const joinBtn = screen.getByTestId('lobby-join-btn')
    await user.click(joinBtn)

    await waitFor(() => {
      expect(props.onJoinRoom).toHaveBeenCalledWith('myroom1234', 'TestUser', false)
    })
  })

  it('passes cameraEnabled=true when camera toggle is on', async () => {
    const props = defaultProps()
    render(<LobbyView {...props} />)

    const nameInput = screen.getByTestId('lobby-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'TestUser')

    const roomInput = screen.getByTestId('lobby-room-input')
    await user.type(roomInput, 'myroom1234')

    // Toggle camera ON
    const cameraToggle = screen.getByTestId('camera-toggle')
    await user.click(cameraToggle)

    const joinBtn = screen.getByTestId('lobby-join-btn')
    await user.click(joinBtn)

    await waitFor(() => {
      expect(props.onJoinRoom).toHaveBeenCalledWith('myroom1234', 'TestUser', true)
    })
  })

  it('disables join button when isLoading is true', () => {
    render(<LobbyView {...defaultProps({ isLoading: true })} />)
    expect(screen.getByTestId('lobby-join-btn')).toBeDisabled()
  })

  // --- Camera Toggle ---
  it('toggles camera enabled state', async () => {
    render(<LobbyView {...defaultProps()} />)
    const cameraToggle = screen.getByTestId('camera-toggle')

    // Initially camera is off (bg-gray-300)
    expect(cameraToggle.className).toContain('bg-gray-300')

    await user.click(cameraToggle)
    // Now camera is on (bg-blue-600)
    expect(cameraToggle.className).toContain('bg-blue-600')

    await user.click(cameraToggle)
    // Back to off
    expect(cameraToggle.className).toContain('bg-gray-300')
  })

  // --- Privacy Notice Toggle ---
  it('toggles the privacy notice text', async () => {
    render(<LobbyView {...defaultProps()} />)

    // The privacy notice header is always visible
    expect(screen.getByText('lobby.privacyNotice')).toBeInTheDocument()

    // The detailed text is initially hidden
    expect(screen.queryByText('lobby.privacyText')).not.toBeInTheDocument()

    // Click to expand
    const privacyToggle = screen.getByText('lobby.privacyNotice')
    await user.click(privacyToggle)

    expect(screen.getByText('lobby.privacyText')).toBeInTheDocument()

    // Click again to collapse
    await user.click(privacyToggle)
    expect(screen.queryByText('lobby.privacyText')).not.toBeInTheDocument()
  })

  // --- startMicTest / stopMicTest ---
  it('starts and stops mic test via test microphone button', async () => {
    render(<LobbyView {...defaultProps()} />)

    // Find the "Test Microphone" button by the audio setup section
    const testMicBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testMicrophone')
    })
    await user.click(testMicBtn)

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: { deviceId: { exact: 'input-1' } },
        video: false,
      })
    })

    expect(mocks.pipelineInitialize).toHaveBeenCalled()
    expect(mocks.pipelineConnectInputStream).toHaveBeenCalled()

    // After starting, we should see stop text and audio meter
    await waitFor(() => {
      expect(screen.getByTestId('audio-meter')).toBeInTheDocument()
    })

    // The "micWorking" text is rendered as "✓ lobby.micWorking" - use a substring matcher
    const micWorkingEl = screen.getByText((content) => content.includes('lobby.micWorking'))
    expect(micWorkingEl).toBeInTheDocument()

    // Find the stop button in the mic section (first stop button)
    const allStopButtons = screen.getAllByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.stopTest')
    })
    await user.click(allStopButtons[0])

    await waitFor(() => {
      expect(screen.getByText((content, element) => {
        return element?.tagName === 'BUTTON' && content.includes('lobby.testMicrophone')
      })).toBeInTheDocument()
    })
    expect(mocks.pipelineDisconnect).toHaveBeenCalled()
  })

  it('uses default audio constraint when no input device is selected', async () => {
    render(<LobbyView {...defaultProps({ selectedInputDevice: null })} />)

    const testMicBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testMicrophone')
    })
    await user.click(testMicBtn)

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: true,
        video: false,
      })
    })
  })

  it('shows alert when mic test fails with permission denied', async () => {
    mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied'))
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { })

    render(<LobbyView {...defaultProps()} />)
    const testMicBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testMicrophone')
    })
    await user.click(testMicBtn)

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('lobby.micPermissionDenied')
    })
    expect(UILog.error).toHaveBeenCalledWith('Microphone test failed', expect.any(Object))

    alertMock.mockRestore()
  })

  it('throws error when pipeline analyser is not available', async () => {
    mocks.pipelineGetAnalyserNode.mockReturnValueOnce(null)
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { })

    render(<LobbyView {...defaultProps()} />)
    const testMicBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testMicrophone')
    })
    await user.click(testMicBtn)

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('lobby.micPermissionDenied')
    })
    expect(UILog.error).toHaveBeenCalledWith('Microphone test failed', expect.any(Object))

    alertMock.mockRestore()
  })

  // --- handleTestSpeaker ---
  it('starts speaker test and verifies oscillator setup', async () => {
    const mockOscillator = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const mockGain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
    const mockCtxClose = vi.fn()

      // Use a class-based mock for AudioContext (required for `new` calls)
      ; (window as any).AudioContext = class MockAudioContext {
        createOscillator() { return mockOscillator }
        createGain() { return mockGain }
        destination = {}
        currentTime = 0
        close = mockCtxClose
      }

    render(<LobbyView {...defaultProps()} />)

    const testSpeakerBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testSpeaker')
    })
    await user.click(testSpeakerBtn)

    // Wait for the async handler to complete
    await waitFor(() => {
      expect(mockOscillator.connect).toHaveBeenCalledWith(mockGain)
    })
    expect(mockGain.connect).toHaveBeenCalled()
    expect(mockOscillator.start).toHaveBeenCalled()

    // Auto-stop happens after 1 second via setTimeout; we wait for it
    await waitFor(() => {
      expect(mockCtxClose).toHaveBeenCalled()
    }, { timeout: 2000 })
  })

  it('stops speaker test when clicked while testing', async () => {
    const mockCtxClose = vi.fn()

      ; (window as any).AudioContext = class MockAudioContext {
        createOscillator() {
          return {
            type: 'sine',
            frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
          }
        }
        createGain() {
          return {
            gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
            connect: vi.fn(),
          }
        }
        destination = {}
        currentTime = 0
        close = mockCtxClose
      }

    render(<LobbyView {...defaultProps()} />)

    const testSpeakerBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testSpeaker')
    })
    await user.click(testSpeakerBtn)

    // Wait for the async handler to complete and state to update
    await waitFor(() => {
      expect(screen.getByText((content, element) => {
        return element?.tagName === 'BUTTON' && content.includes('lobby.stopTest')
      })).toBeInTheDocument()
    })

    // Click the stop button to manually stop
    const stopBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.stopTest')
    })
    await user.click(stopBtn)

    await waitFor(() => {
      expect(mockCtxClose).toHaveBeenCalled()
    })
  })

  it('handles speaker test failure gracefully', async () => {
    ; (window as any).AudioContext = class FailingAudioContext {
      constructor() { throw new Error('Audio not supported') }
    }

    render(<LobbyView {...defaultProps()} />)
    const testSpeakerBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testSpeaker')
    })
    await user.click(testSpeakerBtn)

    expect(UILog.error).toHaveBeenCalledWith('Speaker test failed', expect.any(Object))
  })

  it('tries to set sink ID when selectedOutputDevice is set and setSinkId exists', async () => {
    const mockSetSinkId = vi.fn().mockResolvedValue(undefined)

      ; (window as any).AudioContext = class MockAudioContextWithSink {
        createOscillator() {
          return {
            type: 'sine',
            frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
          }
        }
        createGain() {
          return {
            gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
            connect: vi.fn(),
          }
        }
        destination = { setSinkId: mockSetSinkId }
        currentTime = 0
        close = vi.fn()
      }

    render(<LobbyView {...defaultProps({ selectedOutputDevice: 'speaker-device-1' })} />)
    const testSpeakerBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testSpeaker')
    })
    await user.click(testSpeakerBtn)

    await waitFor(() => {
      expect(mockSetSinkId).toHaveBeenCalledWith('speaker-device-1')
    })
  })

  // --- startCameraTest / stopCameraTest ---
  it('starts and stops camera test', async () => {
    const mockVideoTrack = { stop: vi.fn(), kind: 'video', id: 'vtrack-1' }
    const mockVideoStream = {
      getTracks: () => [mockVideoTrack],
      getAudioTracks: () => [],
      getVideoTracks: () => [mockVideoTrack],
      id: 'video-stream-1',
    }
    mockGetUserMedia.mockResolvedValueOnce(mockVideoStream)

    render(<LobbyView {...defaultProps()} />)

    const testCameraBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testCamera')
    })
    await user.click(testCameraBtn)

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: false,
        video: { deviceId: { exact: 'video-1' } },
      })
    })

    // Should see video element after camera starts
    await waitFor(() => {
      expect(document.querySelector('video')).toBeInTheDocument()
    })

    expect(UILog.info).toHaveBeenCalledWith('Camera test started')

    // Stop camera test - find the camera stop button
    const stopBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.stopTest')
    })
    await user.click(stopBtn)

    await waitFor(() => {
      expect(screen.getByText((content, element) => {
        return element?.tagName === 'BUTTON' && content.includes('lobby.testCamera')
      })).toBeInTheDocument()
    })
    expect(mockVideoTrack.stop).toHaveBeenCalled()
  })

  it('uses default video constraint when no video device selected', async () => {
    const mockVideoStream = {
      getTracks: () => [{ stop: vi.fn(), kind: 'video' }],
      getAudioTracks: () => [],
      getVideoTracks: () => [{ stop: vi.fn() }],
      id: 'video-stream-2',
    }
    mockGetUserMedia.mockResolvedValueOnce(mockVideoStream)

    render(<LobbyView {...defaultProps({ selectedVideoDevice: null })} />)

    const testCameraBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testCamera')
    })
    await user.click(testCameraBtn)

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: false,
        video: true,
      })
    })
  })

  it('shows alert when camera test fails with permission denied', async () => {
    mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied'))
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { })

    render(<LobbyView {...defaultProps()} />)
    const testCameraBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testCamera')
    })
    await user.click(testCameraBtn)

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('lobby.cameraPermissionDenied')
    })
    expect(UILog.error).toHaveBeenCalledWith('Camera test failed', expect.any(Object))

    alertMock.mockRestore()
  })

  // --- onOpenSettings ---
  it('calls onOpenSettings when settings button is clicked', async () => {
    const props = defaultProps()
    render(<LobbyView {...props} />)

    const settingsBtn = screen.getByText('lobby.settings')
    await user.click(settingsBtn)

    expect(props.onOpenSettings).toHaveBeenCalled()
  })

  // --- Join stops mic test first ---
  it('stops mic test before joining the room', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const userFake = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<LobbyView {...defaultProps()} />)

    // Start mic test
    const testMicBtn = screen.getByText((content, element) => {
      return element?.tagName === 'BUTTON' && content.includes('lobby.testMicrophone')
    })
    await userFake.click(testMicBtn)

    await waitFor(() => {
      expect(screen.getByTestId('audio-meter')).toBeInTheDocument()
    })

    // Set username and room
    const nameInput = screen.getByTestId('lobby-name-input')
    await userFake.clear(nameInput)
    await userFake.type(nameInput, 'TestUser')

    const roomInput = screen.getByTestId('lobby-room-input')
    await userFake.type(roomInput, 'myroom1234')

    // Join
    const joinBtn = screen.getByTestId('lobby-join-btn')
    await userFake.click(joinBtn)

    // Pipeline should have been disconnected (stopMicTest called)
    expect(mocks.pipelineDisconnect).toHaveBeenCalled()

    vi.useRealTimers()
  })

  // --- Loading/joining state shows spinner ---
  it('shows joining text when join is in progress', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const userFake = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const onJoinRoom = vi.fn()
    render(<LobbyView {...defaultProps({ onJoinRoom })} />)

    const nameInput = screen.getByTestId('lobby-name-input')
    await userFake.clear(nameInput)
    await userFake.type(nameInput, 'TestUser')

    const roomInput = screen.getByTestId('lobby-room-input')
    await userFake.type(roomInput, 'myroom1234')

    const joinBtn = screen.getByTestId('lobby-join-btn')
    await userFake.click(joinBtn)

    // The button should show "joining" text
    await waitFor(() => {
      expect(screen.getByText('lobby.joining')).toBeInTheDocument()
    })

    vi.useRealTimers()
  })
})
