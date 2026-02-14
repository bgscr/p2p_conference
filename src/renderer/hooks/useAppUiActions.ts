import { useCallback, useState } from 'react'
import { soundManager } from '../audio-processor/SoundManager'
import type { ConnectionState } from '@/types'

interface UseAppUiActionsOptions {
  t: (key: string, params?: Record<string, string | number>) => string
  showToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  roomId: string | null
  localPeerId: string
  userName: string
  connectionState: ConnectionState
  participantCount: number
  remoteMicState: string
  soundEnabled: boolean
  setSoundEnabled: (value: boolean) => void
  onCopyError: (error: unknown) => void
  onDiagnosticsError: (error: unknown) => void
}

interface UseAppUiActionsResult {
  diagnosticsExportInProgress: boolean
  handleCopyRoomId: () => Promise<void>
  handleToggleSound: () => void
  handleOpenRemoteMicSetup: () => Promise<void>
  handleExportDiagnostics: () => Promise<void>
}

export function useAppUiActions({
  t,
  showToast,
  roomId,
  localPeerId,
  userName,
  connectionState,
  participantCount,
  remoteMicState,
  soundEnabled,
  setSoundEnabled,
  onCopyError,
  onDiagnosticsError
}: UseAppUiActionsOptions): UseAppUiActionsResult {
  const [diagnosticsExportInProgress, setDiagnosticsExportInProgress] = useState(false)

  const handleCopyRoomId = useCallback(async () => {
    if (!roomId) {
      return
    }

    try {
      await navigator.clipboard.writeText(roomId)
      showToast(t('room.roomIdCopied'), 'success')
    } catch (err) {
      onCopyError(err)
    }
  }, [onCopyError, roomId, showToast, t])

  const handleToggleSound = useCallback(() => {
    const newValue = !soundEnabled
    setSoundEnabled(newValue)
    soundManager.setEnabled(newValue)
    showToast(newValue ? t('room.soundEnabled') : t('room.soundDisabled'), 'info')
  }, [setSoundEnabled, showToast, soundEnabled, t])

  const handleOpenRemoteMicSetup = useCallback(async () => {
    const opened = await window.electronAPI?.openRemoteMicSetupDoc?.()
    if (!opened) {
      showToast(t('remoteMic.setupDocUnavailable'), 'warning')
    }
  }, [showToast, t])

  const handleExportDiagnostics = useCallback(async () => {
    if (diagnosticsExportInProgress) {
      return
    }

    if (!window.electronAPI?.exportDiagnosticsBundle) {
      showToast(t('settings.exportDiagnosticsUnavailable'), 'warning')
      return
    }

    setDiagnosticsExportInProgress(true)
    try {
      const health = await window.electronAPI.getHealthSnapshot?.()
      const result = await window.electronAPI.exportDiagnosticsBundle({
        session: {
          roomId,
          localPeerId,
          userName,
          connectionState,
          participantCount,
          remoteMicState
        },
        health
      })

      if (!result?.ok) {
        showToast(t('settings.exportDiagnosticsFailed'), 'error')
        return
      }
      showToast(t('settings.exportDiagnosticsSuccess'), 'success')
    } catch (err) {
      onDiagnosticsError(err)
      showToast(t('settings.exportDiagnosticsFailed'), 'error')
    } finally {
      setDiagnosticsExportInProgress(false)
    }
  }, [
    connectionState,
    diagnosticsExportInProgress,
    localPeerId,
    onDiagnosticsError,
    participantCount,
    remoteMicState,
    roomId,
    showToast,
    t,
    userName
  ])

  return {
    diagnosticsExportInProgress,
    handleCopyRoomId,
    handleToggleSound,
    handleOpenRemoteMicSetup,
    handleExportDiagnostics
  }
}
