/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SettingsPanel } from '../../renderer/components/SettingsPanel'

// Use vi.hoisted to properly hoist mock functions
const mockSetLanguage = vi.hoisted(() => vi.fn())
const mockDownloadLogs = vi.hoisted(() => vi.fn())
const mockClearLogs = vi.hoisted(() => vi.fn())
const mockGetLogs = vi.hoisted(() => vi.fn().mockReturnValue([1, 2, 3]))

// Mock useI18n with hoisted variables
vi.mock('../../renderer/hooks/useI18n', () => ({
    useI18n: () => ({
        t: (key: string, params?: Record<string, string>) => {
            const translations: Record<string, string> = {
                'settings.title': 'Settings',
                'settings.close': 'Close',
                'settings.language': 'Language',
                'settings.devices': 'Audio Devices',
                'settings.inputDevice': 'Input Device',
                'settings.outputDevice': 'Output Device',
                'settings.audioProcessing': 'Audio Processing',
                'settings.noiseSuppression': 'Noise Suppression',
                'settings.noiseSuppressionDesc': 'AI-powered background noise removal',
                'settings.echoCancellation': 'Echo Cancellation',
                'settings.echoCancellationDesc': 'Prevents audio feedback',
                'settings.autoGainControl': 'Auto Gain Control',
                'settings.autoGainControlDesc': 'Automatically adjusts microphone volume',
                'settings.debug': 'Debug & Troubleshooting',
                'settings.downloadLogsDesc': 'Download logs for troubleshooting',
                'settings.downloadLogs': 'Download Logs',
                'settings.clearLogs': 'Clear Logs',
                'settings.logsCleared': `${params?.count || 0} logs cleared`,
                'warnings.symmetricNat': 'NAT warning. Connection may fail in some networks.',
                'app.name': 'P2P Conference',
                'app.tagline': 'Serverless Audio',
                'app.version': 'v1.0.0'
            }
            return translations[key] || key
        },
        currentLanguage: 'en',
        setLanguage: mockSetLanguage,
        getAvailableLanguages: () => [
            { code: 'en', name: 'English' },
            { code: 'zh', name: '中文' }
        ]
    })
}))

// Mock Logger with hoisted functions
vi.mock('../../renderer/utils/Logger', () => ({
    logger: {
        downloadLogs: mockDownloadLogs,
        getLogs: mockGetLogs,
        clearLogs: mockClearLogs
    }
}))

// Mock DeviceSelector component
vi.mock('../../renderer/components/DeviceSelector', () => ({
    DeviceSelector: ({ label, devices, selectedDeviceId, onSelect }: any) => (
        <div data-testid={`device-selector-${label || 'unnamed'}`}>
            <select
                value={selectedDeviceId || ''}
                onChange={(e) => onSelect(e.target.value)}
            >
                {devices.map((d: any) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
            </select>
        </div>
    )
}))

describe('SettingsPanel', () => {
    const mockInputDevices = [
        { deviceId: 'mic1', label: 'Mic 1', kind: 'audioinput' as const, groupId: '1' }
    ]
    const mockOutputDevices = [
        { deviceId: 'speaker1', label: 'Speaker 1', kind: 'audiooutput' as const, groupId: '1' }
    ]

    const defaultProps = {
        settings: {
            noiseSuppressionEnabled: true,
            echoCancellationEnabled: true,
            autoGainControlEnabled: true,
            selectedInputDevice: 'default',
            selectedOutputDevice: 'default'
        },
        inputDevices: mockInputDevices,
        outputDevices: mockOutputDevices,
        selectedInputDevice: 'mic1',
        selectedOutputDevice: 'speaker1',
        onSettingsChange: vi.fn(),
        onInputDeviceChange: vi.fn(),
        onOutputDeviceChange: vi.fn(),
        onClose: vi.fn(),
        onShowToast: vi.fn()
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders settings title', () => {
        render(<SettingsPanel {...defaultProps} />)

        expect(screen.getByText('Settings')).toBeInTheDocument()
    })

    it('renders language selection', () => {
        render(<SettingsPanel {...defaultProps} />)

        expect(screen.getByText('Language')).toBeInTheDocument()
        expect(screen.getByText('English')).toBeInTheDocument()
        expect(screen.getByText('中文')).toBeInTheDocument()
    })

    it('calls setLanguage when language button is clicked', () => {
        render(<SettingsPanel {...defaultProps} />)

        const chineseBtn = screen.getByText('中文')
        fireEvent.click(chineseBtn)

        expect(mockSetLanguage).toHaveBeenCalledWith('zh')
    })

    it('renders audio device selectors', () => {
        render(<SettingsPanel {...defaultProps} />)

        expect(screen.getByText('Audio Devices')).toBeInTheDocument()
        expect(screen.getByText('Input Device')).toBeInTheDocument()
        expect(screen.getByText('Output Device')).toBeInTheDocument()
    })

    it('renders audio processing toggles', () => {
        render(<SettingsPanel {...defaultProps} />)

        expect(screen.getByText('Audio Processing')).toBeInTheDocument()
        expect(screen.getByText('Noise Suppression')).toBeInTheDocument()
        expect(screen.getByText('Echo Cancellation')).toBeInTheDocument()
        expect(screen.getByText('Auto Gain Control')).toBeInTheDocument()
    })

    it('calls onSettingsChange when noise suppression is toggled', () => {
        const onSettingsChange = vi.fn()
        render(<SettingsPanel {...defaultProps} onSettingsChange={onSettingsChange} />)

        // Find the checkbox for noise suppression (first checkbox)
        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])

        expect(onSettingsChange).toHaveBeenCalledWith({ noiseSuppressionEnabled: false })
    })

    it('calls onSettingsChange when echo cancellation is toggled', () => {
        const onSettingsChange = vi.fn()
        render(<SettingsPanel {...defaultProps} onSettingsChange={onSettingsChange} />)

        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[1])

        expect(onSettingsChange).toHaveBeenCalledWith({ echoCancellationEnabled: false })
    })

    it('calls onSettingsChange when AGC is toggled', () => {
        const onSettingsChange = vi.fn()
        render(<SettingsPanel {...defaultProps} onSettingsChange={onSettingsChange} />)

        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[2])

        expect(onSettingsChange).toHaveBeenCalledWith({ autoGainControlEnabled: false })
    })

    it('renders debug section', () => {
        render(<SettingsPanel {...defaultProps} />)

        expect(screen.getByText('Debug & Troubleshooting')).toBeInTheDocument()
        expect(screen.getByText('Download Logs')).toBeInTheDocument()
        expect(screen.getByText('Clear Logs')).toBeInTheDocument()
    })

    it('calls downloadLogs when download button is clicked', () => {
        render(<SettingsPanel {...defaultProps} />)

        const downloadBtn = screen.getByText('Download Logs')
        fireEvent.click(downloadBtn)

        expect(mockDownloadLogs).toHaveBeenCalledTimes(1)
    })

    it('calls clearLogs and shows toast when clear button is clicked', () => {
        const onShowToast = vi.fn()

        render(<SettingsPanel {...defaultProps} onShowToast={onShowToast} />)

        const clearBtn = screen.getByText('Clear Logs')
        fireEvent.click(clearBtn)

        expect(mockClearLogs).toHaveBeenCalledTimes(1)
        expect(onShowToast).toHaveBeenCalledWith('3 logs cleared', 'success')
    })

    it('calls onClose when close button in header is clicked', () => {
        const onClose = vi.fn()
        render(<SettingsPanel {...defaultProps} onClose={onClose} />)

        // Find close button by title
        const closeBtn = screen.getByTitle('Close')
        fireEvent.click(closeBtn)

        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when footer close button is clicked', () => {
        const onClose = vi.fn()
        render(<SettingsPanel {...defaultProps} onClose={onClose} />)

        // There are two close buttons - one in header and one in footer
        const closeButtons = screen.getAllByText('Close')
        fireEvent.click(closeButtons[closeButtons.length - 1]) // Click the footer one

        expect(onClose).toHaveBeenCalled()
    })

    it('renders NAT warning notice', () => {
        render(<SettingsPanel {...defaultProps} />)

        // Use getAllByText since there might be multiple elements
        const natWarnings = screen.getAllByText(/NAT warning/)
        expect(natWarnings.length).toBeGreaterThan(0)
    })

    it('renders about section', () => {
        render(<SettingsPanel {...defaultProps} />)

        expect(screen.getByText('About')).toBeInTheDocument()
        expect(screen.getByText('Peer-to-peer WebRTC connections')).toBeInTheDocument()
    })

    it('checkboxes reflect settings state', () => {
        render(<SettingsPanel {...defaultProps} settings={{
            noiseSuppressionEnabled: false,
            echoCancellationEnabled: true,
            autoGainControlEnabled: false,
            selectedInputDevice: 'default',
            selectedOutputDevice: 'default'
        }} />)

        const checkboxes = screen.getAllByRole('checkbox')

        expect(checkboxes[0]).not.toBeChecked()
        expect(checkboxes[1]).toBeChecked()
        expect(checkboxes[2]).not.toBeChecked()
    })

    it('handles empty device lists gracefully', () => {
        render(<SettingsPanel {...defaultProps} inputDevices={[]} outputDevices={[]} />)

        // Should still render device selectors
        const deviceSelectors = screen.getAllByTestId('device-selector-unnamed')
        expect(deviceSelectors).toHaveLength(2)
    })

    it('handles null selected devices gracefully', () => {
        render(<SettingsPanel
            {...defaultProps}
            selectedInputDevice={null}
            selectedOutputDevice={null}
        />)

        // Should render without errors
        expect(screen.getByText('Settings')).toBeInTheDocument()
    })

    it('displays device labels correctly', () => {
        const devicesWithLabels = [
            { deviceId: 'mic1', label: 'My Microphone', kind: 'audioinput' as const, groupId: '1' },
            { deviceId: 'mic2', label: 'External Mic', kind: 'audioinput' as const, groupId: '2' }
        ]

        render(<SettingsPanel {...defaultProps} inputDevices={devicesWithLabels} />)

        expect(screen.getByText('My Microphone')).toBeInTheDocument()
        expect(screen.getByText('External Mic')).toBeInTheDocument()
    })
})
