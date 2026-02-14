/**
 * SettingsPanel Component
 * Full settings page for audio configuration, language, and debugging
 */

import React from 'react'
import { DeviceSelector } from './DeviceSelector'
import { useI18n } from '../hooks/useI18n'
import { logger } from '../utils/Logger'
import type { AudioDevice, AppSettings, VirtualMicDeviceStatus } from '@/types'
import { isFeatureEnabled } from '../config/featureFlags'

interface SettingsPanelProps {
  settings: AppSettings
  inputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  videoInputDevices: AudioDevice[]
  selectedInputDevice: string | null
  selectedOutputDevice: string | null
  selectedVideoDevice: string | null
  localStream: MediaStream | null
  onSettingsChange: (settings: Partial<AppSettings>) => void
  onInputDeviceChange: (deviceId: string) => void
  onOutputDeviceChange: (deviceId: string) => void
  onVideoDeviceChange: (deviceId: string) => void
  onClose: () => void
  onShowToast?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void
  virtualMicDeviceStatus?: VirtualMicDeviceStatus
  virtualAudioInstallerState?: {
    inProgress: boolean
    platformSupported: boolean
    bundleReady?: boolean
    bundleMessage?: string
  }
  onInstallRemoteMicDriver?: () => void
  onRecheckRemoteMicDevice?: () => void
  onOpenRemoteMicSetup?: () => void
  onExportDiagnostics?: () => void
  diagnosticsExportInProgress?: boolean
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  inputDevices,
  outputDevices,
  videoInputDevices,
  selectedInputDevice,
  selectedOutputDevice,
  selectedVideoDevice,
  localStream,
  onSettingsChange,
  onInputDeviceChange,
  onOutputDeviceChange,
  onVideoDeviceChange,
  onClose,
  onShowToast,
  virtualMicDeviceStatus,
  virtualAudioInstallerState,
  onInstallRemoteMicDriver,
  onRecheckRemoteMicDevice,
  onOpenRemoteMicSetup,
  onExportDiagnostics,
  diagnosticsExportInProgress,
}) => {
  const { t, currentLanguage, setLanguage, getAvailableLanguages } = useI18n()

  const handleDownloadLogs = () => {
    logger.downloadLogs()
  }

  const handleClearLogs = () => {
    const count = logger.getLogs().length
    logger.clearLogs()
    if (onShowToast) {
      onShowToast(t('settings.logsCleared', { count: count.toString() }), 'success')
    }
  }

  const installerBundleReady = virtualAudioInstallerState?.bundleReady !== false
  const canAutoInstallVirtualDevice = Boolean(virtualAudioInstallerState?.platformSupported) && installerBundleReady
  const pushToTalkEnabled = isFeatureEnabled('push_to_talk')
  const diagnosticsPanelEnabled = isFeatureEnabled('diagnostics_panel')
  const showInstallerBundleWarning = Boolean(
    (virtualMicDeviceStatus?.platform === 'win' || virtualMicDeviceStatus?.platform === 'mac') &&
    virtualMicDeviceStatus?.ready === false &&
    !installerBundleReady
  )
  const installerPrecheckReason = virtualAudioInstallerState?.bundleMessage || t('remoteMic.installBundleMissingReasonDefault')

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">{t('settings.title')}</h1>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title={t('settings.close')}
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-8">

          {/* Language Selection */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
              </svg>
              {t('settings.language')}
            </h2>

            <div className="flex flex-wrap gap-2">
              {getAvailableLanguages().map(lang => (
                <button
                  key={lang.code}
                  onClick={() => setLanguage(lang.code)}
                  className={`px-4 py-2 rounded-lg border transition-colors ${currentLanguage === lang.code
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                >
                  {lang.name}
                </button>
              ))}
            </div>
          </section>

          {/* Audio Devices */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              {t('settings.devices')}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('settings.inputDevice')}
                </label>
                <DeviceSelector
                  label=""
                  devices={inputDevices}
                  selectedDeviceId={selectedInputDevice}
                  onSelect={onInputDeviceChange}
                  icon="mic"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('settings.outputDevice')}
                </label>
                <DeviceSelector
                  label=""
                  devices={outputDevices}
                  selectedDeviceId={selectedOutputDevice}
                  onSelect={onOutputDeviceChange}
                  icon="speaker"
                />
              </div>
            </div>
          </section>

          {/* Remote Mic Mapping */}
          {virtualMicDeviceStatus && (
            <section className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                {t('remoteMic.title')}
              </h2>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('remoteMic.expectedDevice')}</span>
                  <span className="font-medium text-gray-900">{virtualMicDeviceStatus.expectedDeviceHint}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('remoteMic.detectedDevice')}</span>
                  <span className={virtualMicDeviceStatus.ready ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>
                    {virtualMicDeviceStatus.outputDeviceLabel || t('remoteMic.notDetected')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('remoteMic.status')}</span>
                  <span className={virtualMicDeviceStatus.ready ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                    {virtualMicDeviceStatus.ready ? t('remoteMic.ready') : t('remoteMic.notReady')}
                  </span>
                </div>

                {!virtualMicDeviceStatus.ready && (
                  <div className="flex flex-wrap gap-2">
                    {showInstallerBundleWarning && (
                      <div className="w-full rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {t('remoteMic.installBundleMissing', { reason: installerPrecheckReason })}
                      </div>
                    )}
                    {(virtualMicDeviceStatus.platform === 'win' || virtualMicDeviceStatus.platform === 'mac') && (
                      <button
                        onClick={onInstallRemoteMicDriver}
                        disabled={virtualAudioInstallerState?.inProgress || !canAutoInstallVirtualDevice}
                        className="btn btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {virtualAudioInstallerState?.inProgress
                          ? t('remoteMic.installing')
                          : t('remoteMic.installButton')}
                      </button>
                    )}
                    <button
                      onClick={onOpenRemoteMicSetup}
                      className="btn btn-secondary"
                    >
                      {t('remoteMic.openSetup')}
                    </button>
                  </div>
                )}

                <button
                  onClick={onRecheckRemoteMicDevice}
                  className="btn btn-secondary"
                >
                  {t('remoteMic.recheckDevice')}
                </button>
              </div>
            </section>
          )}

          {/* Video Devices */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {t('settings.videoDevices')}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('settings.videoDevice')}
                </label>
                <DeviceSelector
                  label=""
                  devices={videoInputDevices}
                  selectedDeviceId={selectedVideoDevice}
                  onSelect={onVideoDeviceChange}
                  icon="video"
                />
              </div>

              {localStream && localStream.getVideoTracks().length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('settings.cameraPreview')}
                  </label>
                  <div className="bg-black rounded-lg overflow-hidden aspect-video relative">
                    <video
                      ref={video => {
                        if (video && localStream) {
                          video.srcObject = localStream
                        }
                      }}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Audio Processing */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              {t('settings.audioProcessing')}
            </h2>

            <div className="space-y-4">
              {/* Noise Suppression */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <div>
                  <p className="font-medium text-gray-900">{t('settings.noiseSuppression')}</p>
                  <p className="text-sm text-gray-500">{t('settings.noiseSuppressionDesc')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.noiseSuppressionEnabled}
                    onChange={(e) => onSettingsChange({ noiseSuppressionEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Echo Cancellation */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <div>
                  <p className="font-medium text-gray-900">{t('settings.echoCancellation')}</p>
                  <p className="text-sm text-gray-500">{t('settings.echoCancellationDesc')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.echoCancellationEnabled}
                    onChange={(e) => onSettingsChange({ echoCancellationEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Auto Gain Control */}
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-gray-900">{t('settings.autoGainControl')}</p>
                  <p className="text-sm text-gray-500">{t('settings.autoGainControlDesc')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoGainControlEnabled}
                    onChange={(e) => onSettingsChange({ autoGainControlEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {pushToTalkEnabled && (
                <div className="flex flex-col gap-3 py-3 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{t('settings.pushToTalk')}</p>
                      <p className="text-sm text-gray-500">{t('settings.pushToTalkDesc')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSettingsChange({ pushToTalkEnabled: !settings.pushToTalkEnabled })}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        settings.pushToTalkEnabled
                          ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      data-testid="settings-ptt-toggle"
                    >
                      {settings.pushToTalkEnabled ? t('room.on') : t('room.off')}
                    </button>
                  </div>
                  {settings.pushToTalkEnabled && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">{t('settings.pushToTalkKey')}</span>
                      <select
                        value={settings.pushToTalkKey || 'space'}
                        onChange={(event) => {
                          onSettingsChange({
                            pushToTalkKey: event.target.value as 'space' | 'shift' | 'capslock'
                          })
                        }}
                        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
                        data-testid="settings-ptt-key"
                      >
                        <option value="space">Space</option>
                        <option value="shift">Shift</option>
                        <option value="capslock">CapsLock</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Debug / Troubleshooting */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {t('settings.debug')}
            </h2>

            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {t('settings.downloadLogsDesc')}
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleDownloadLogs}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {t('settings.downloadLogs')}
                </button>

                <button
                  onClick={handleClearLogs}
                  className="btn btn-secondary flex items-center gap-2 text-red-600 hover:bg-red-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {t('settings.clearLogs')}
                </button>

                {diagnosticsPanelEnabled && (
                  <button
                    onClick={onExportDiagnostics}
                    disabled={!onExportDiagnostics || diagnosticsExportInProgress}
                    className="btn btn-secondary flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    data-testid="settings-export-diagnostics-btn"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 17v-2a4 4 0 014-4h6m0 0l-3-3m3 3l-3 3M5 3h8a2 2 0 012 2v4m0 0H5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-2" />
                    </svg>
                    {diagnosticsExportInProgress
                      ? t('settings.exportDiagnosticsRunning')
                      : t('settings.exportDiagnostics')}
                  </button>
                )}
              </div>

              <p className="text-xs text-gray-400">
                Keyboard shortcut: <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">Ctrl+Shift+L</kbd>
              </p>
            </div>
          </section>

          {/* Network Info */}
          <section className="card p-6 bg-yellow-50 border-yellow-200">
            <h2 className="text-lg font-semibold text-yellow-800 mb-2 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {t('warnings.symmetricNat').split('.')[0]}
            </h2>
            <p className="text-sm text-yellow-700">
              {t('warnings.symmetricNat')}
            </p>
          </section>

          {/* About */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              About
            </h2>

            <div className="space-y-3 text-sm text-gray-600">
              <p>
                <strong>{t('app.name')}</strong> - {t('app.tagline')}
              </p>
              <ul className="list-disc list-inside space-y-1 text-gray-500">
                <li>Peer-to-peer WebRTC connections</li>
                <li>End-to-end encrypted (DTLS-SRTP)</li>
                <li>Cross-platform: Windows, macOS, Linux</li>
              </ul>
              <p className="text-xs text-gray-400 pt-2">
                {t('app.version')} | Built with Electron + React
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex justify-end">
          <button
            onClick={onClose}
            className="btn btn-primary"
          >
            {t('settings.close')}
          </button>
        </div>
      </footer>
    </div>
  )
}
