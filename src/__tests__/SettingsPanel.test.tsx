/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

// Hoist mocks
const mocks = vi.hoisted(() => ({
  downloadLogs: vi.fn(),
  clearLogs: vi.fn(),
  getLogs: vi.fn().mockReturnValue([
    { timestamp: '2024-01-01', level: 'info', module: 'test', message: 'log1' },
    { timestamp: '2024-01-02', level: 'info', module: 'test', message: 'log2' },
    { timestamp: '2024-01-03', level: 'info', module: 'test', message: 'log3' },
  ]),
  setLanguage: vi.fn(),
  getAvailableLanguages: vi.fn().mockReturnValue([
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Espanol' },
    { code: 'fr', name: 'Francais' },
  ]),
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

// --- Mock hooks and services ---
vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockImplementation(() => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params) {
        let result = key
        for (const [k, v] of Object.entries(params)) {
          result += `[${k}=${v}]`
        }
        return result
      }
      return key
    },
    currentLanguage: 'en',
    setLanguage: mocks.setLanguage,
    getAvailableLanguages: mocks.getAvailableLanguages,
  })),
}))

vi.mock('../renderer/utils/Logger', () => ({
  logger: {
    downloadLogs: mocks.downloadLogs,
    clearLogs: mocks.clearLogs,
    getLogs: mocks.getLogs,
  },
  UILog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { SettingsPanel } from '../renderer/components/SettingsPanel'
import type { AppSettings } from '@/types'

// Helper: default props
function defaultProps(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const settings: AppSettings = {
    noiseSuppressionEnabled: true,
    echoCancellationEnabled: true,
    autoGainControlEnabled: false,
    selectedInputDevice: 'input-1',
    selectedOutputDevice: 'output-1',
    selectedVideoDevice: 'video-1',
  }

  return {
    settings,
    inputDevices: [
      { deviceId: 'input-1', label: 'Mic 1', kind: 'audioinput' as const, groupId: 'g1' },
    ],
    outputDevices: [
      { deviceId: 'output-1', label: 'Speaker 1', kind: 'audiooutput' as const, groupId: 'g2' },
    ],
    videoInputDevices: [
      { deviceId: 'video-1', label: 'Camera 1', kind: 'videoinput' as const, groupId: 'g3' },
    ],
    selectedInputDevice: 'input-1',
    selectedOutputDevice: 'output-1',
    selectedVideoDevice: 'video-1',
    localStream: null,
    onSettingsChange: vi.fn(),
    onInputDeviceChange: vi.fn(),
    onOutputDeviceChange: vi.fn(),
    onVideoDeviceChange: vi.fn(),
    onClose: vi.fn(),
    onShowToast: vi.fn(),
    ...overrides,
  }
}

describe('SettingsPanel', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- Basic Rendering ---
  it('renders the settings title', () => {
    render(<SettingsPanel {...defaultProps()} />)
    expect(screen.getByText('settings.title')).toBeInTheDocument()
  })

  it('renders device selectors', () => {
    render(<SettingsPanel {...defaultProps()} />)
    expect(screen.getByTestId('device-selector-mic')).toBeInTheDocument()
    expect(screen.getByTestId('device-selector-speaker')).toBeInTheDocument()
    expect(screen.getByTestId('device-selector-video')).toBeInTheDocument()
  })

  it('renders audio processing toggles', () => {
    render(<SettingsPanel {...defaultProps()} />)
    expect(screen.getByText('settings.noiseSuppression')).toBeInTheDocument()
    expect(screen.getByText('settings.echoCancellation')).toBeInTheDocument()
    expect(screen.getByText('settings.autoGainControl')).toBeInTheDocument()
  })

  it('renders debug section with download and clear buttons', () => {
    render(<SettingsPanel {...defaultProps()} />)
    expect(screen.getByText('settings.downloadLogs')).toBeInTheDocument()
    expect(screen.getByText('settings.clearLogs')).toBeInTheDocument()
  })

  // --- Close button ---
  it('calls onClose when header close button is clicked', async () => {
    const props = defaultProps()
    render(<SettingsPanel {...props} />)

    // There are two close buttons: the X icon in the header and the footer close button
    // The footer one has text "settings.close"
    const closeButtons = screen.getAllByText('settings.close')
    // The footer button
    await user.click(closeButtons[closeButtons.length - 1])
    expect(props.onClose).toHaveBeenCalled()
  })

  // --- Audio Processing Settings Toggle ---
  it('toggles noise suppression setting', async () => {
    const props = defaultProps()
    render(<SettingsPanel {...props} />)

    // Find the checkboxes - they are sr-only inputs
    const checkboxes = screen.getAllByRole('checkbox')
    // First checkbox is noise suppression (checked by default)
    const nsCheckbox = checkboxes[0]
    expect(nsCheckbox).toBeChecked()

    await user.click(nsCheckbox)
    expect(props.onSettingsChange).toHaveBeenCalledWith({ noiseSuppressionEnabled: false })
  })

  it('toggles echo cancellation setting', async () => {
    const props = defaultProps()
    render(<SettingsPanel {...props} />)

    const checkboxes = screen.getAllByRole('checkbox')
    const ecCheckbox = checkboxes[1]
    expect(ecCheckbox).toBeChecked()

    await user.click(ecCheckbox)
    expect(props.onSettingsChange).toHaveBeenCalledWith({ echoCancellationEnabled: false })
  })

  it('toggles auto gain control setting', async () => {
    const props = defaultProps()
    render(<SettingsPanel {...props} />)

    const checkboxes = screen.getAllByRole('checkbox')
    const agcCheckbox = checkboxes[2]
    expect(agcCheckbox).not.toBeChecked()

    await user.click(agcCheckbox)
    expect(props.onSettingsChange).toHaveBeenCalledWith({ autoGainControlEnabled: true })
  })

  // --- handleDownloadLogs ---
  it('calls logger.downloadLogs when download button is clicked', async () => {
    render(<SettingsPanel {...defaultProps()} />)

    const downloadBtn = screen.getByText('settings.downloadLogs')
    await user.click(downloadBtn)

    expect(mocks.downloadLogs).toHaveBeenCalled()
  })

  // --- handleClearLogs with onShowToast ---
  it('calls logger.clearLogs and onShowToast when clear button is clicked', async () => {
    const props = defaultProps()
    render(<SettingsPanel {...props} />)

    const clearBtn = screen.getByText('settings.clearLogs')
    await user.click(clearBtn)

    expect(mocks.getLogs).toHaveBeenCalled()
    expect(mocks.clearLogs).toHaveBeenCalled()
    expect(props.onShowToast).toHaveBeenCalledWith(
      'settings.logsCleared[count=3]',
      'success'
    )
  })

  it('does not crash when onShowToast is not provided and clear logs is clicked', async () => {
    const props = defaultProps({ onShowToast: undefined })
    render(<SettingsPanel {...props} />)

    const clearBtn = screen.getByText('settings.clearLogs')
    await user.click(clearBtn)

    expect(mocks.clearLogs).toHaveBeenCalled()
    // No crash = success
  })

  // --- Language Selection ---
  it('renders language selection buttons', () => {
    render(<SettingsPanel {...defaultProps()} />)

    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('Espanol')).toBeInTheDocument()
    expect(screen.getByText('Francais')).toBeInTheDocument()
  })

  it('highlights the current language button', () => {
    render(<SettingsPanel {...defaultProps()} />)

    const englishBtn = screen.getByText('English')
    // Current language is 'en', so the English button should have the active class
    expect(englishBtn.className).toContain('bg-blue-600')

    const spanishBtn = screen.getByText('Espanol')
    expect(spanishBtn.className).not.toContain('bg-blue-600')
  })

  it('calls setLanguage when a language button is clicked', async () => {
    render(<SettingsPanel {...defaultProps()} />)

    const spanishBtn = screen.getByText('Espanol')
    await user.click(spanishBtn)

    expect(mocks.setLanguage).toHaveBeenCalledWith('es')
  })

  it('calls setLanguage with correct code for each language', async () => {
    render(<SettingsPanel {...defaultProps()} />)

    await user.click(screen.getByText('Francais'))
    expect(mocks.setLanguage).toHaveBeenCalledWith('fr')

    await user.click(screen.getByText('English'))
    expect(mocks.setLanguage).toHaveBeenCalledWith('en')
  })

  // --- Video Preview with localStream ---
  it('renders video preview when localStream has video tracks', () => {
    const mockVideoTrack = { kind: 'video', id: 'vt-1', label: 'Camera', enabled: true }
    const mockLocalStream = {
      getVideoTracks: () => [mockVideoTrack],
      getAudioTracks: () => [],
      getTracks: () => [mockVideoTrack],
      id: 'local-stream-1',
    } as unknown as MediaStream

    render(<SettingsPanel {...defaultProps({ localStream: mockLocalStream })} />)

    // The camera preview label should be visible
    expect(screen.getByText('settings.cameraPreview')).toBeInTheDocument()

    // A video element should be rendered
    const videoEl = document.querySelector('video')
    expect(videoEl).toBeInTheDocument()
  })

  it('sets video srcObject via ref callback when localStream is present', () => {
    const mockVideoTrack = { kind: 'video', id: 'vt-1', label: 'Camera', enabled: true }
    const mockLocalStream = {
      getVideoTracks: () => [mockVideoTrack],
      getAudioTracks: () => [],
      getTracks: () => [mockVideoTrack],
      id: 'local-stream-2',
    } as unknown as MediaStream

    render(<SettingsPanel {...defaultProps({ localStream: mockLocalStream })} />)

    const videoEl = document.querySelector('video') as HTMLVideoElement
    expect(videoEl).toBeInTheDocument()
    // The ref callback should have set srcObject
    expect(videoEl.srcObject).toBe(mockLocalStream)
  })

  it('does not render video preview when localStream is null', () => {
    render(<SettingsPanel {...defaultProps({ localStream: null })} />)
    expect(screen.queryByText('settings.cameraPreview')).not.toBeInTheDocument()
  })

  it('does not render video preview when localStream has no video tracks', () => {
    const mockLocalStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [{ kind: 'audio', id: 'at-1' }],
      getTracks: () => [{ kind: 'audio', id: 'at-1' }],
      id: 'audio-only-stream',
    } as unknown as MediaStream

    render(<SettingsPanel {...defaultProps({ localStream: mockLocalStream })} />)
    expect(screen.queryByText('settings.cameraPreview')).not.toBeInTheDocument()
  })

  // --- Network Info section ---
  it('renders the network info warning section', () => {
    render(<SettingsPanel {...defaultProps()} />)
    expect(screen.getByText('warnings.symmetricNat')).toBeInTheDocument()
  })

  // --- About section ---
  it('renders the about section', () => {
    render(<SettingsPanel {...defaultProps()} />)
    expect(screen.getByText('About')).toBeInTheDocument()
    expect(screen.getByText('app.name')).toBeInTheDocument()
  })
})
