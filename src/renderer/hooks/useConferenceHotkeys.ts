import { useEffect, useRef } from 'react'
import type { ConnectionState } from '@/types'

type AppView = 'lobby' | 'room' | 'settings'
type ToastType = 'info' | 'success' | 'warning' | 'error'
type PushToTalkKey = 'space' | 'shift' | 'capslock'

interface UseConferenceHotkeysOptions {
  appView: AppView
  connectionState: ConnectionState
  showToast: (message: string, type?: ToastType) => void
  translate: (key: string) => string
  onToggleMute: () => void
  onToggleSpeakerMute: () => void
  onToggleVideo: () => void
  onToggleChat: () => void
  onToggleScreenShare: () => void
  onCancelSearch: () => void
  onRequestLeaveConfirm: () => void
  onDownloadLogs: () => void
  pushToTalkEnabled: boolean
  pushToTalkKey: PushToTalkKey
  isMuted: boolean
  onPushToTalkStateChange: (active: boolean) => void
}

function isEditableElement(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
}

function matchesPushToTalkKey(event: KeyboardEvent, hotkey: PushToTalkKey): boolean {
  switch (hotkey) {
    case 'shift':
      return event.key === 'Shift'
    case 'capslock':
      return event.key === 'CapsLock' || event.code === 'CapsLock'
    case 'space':
    default:
      return event.code === 'Space' || event.key === ' '
  }
}

export function useConferenceHotkeys({
  appView,
  connectionState,
  showToast,
  translate,
  onToggleMute,
  onToggleSpeakerMute,
  onToggleVideo,
  onToggleChat,
  onToggleScreenShare,
  onCancelSearch,
  onRequestLeaveConfirm,
  onDownloadLogs,
  pushToTalkEnabled,
  pushToTalkKey,
  isMuted,
  onPushToTalkStateChange
}: UseConferenceHotkeysOptions): void {
  const pttActiveRef = useRef(false)
  const pttUnmutedRef = useRef(false)

  useEffect(() => {
    if ((appView !== 'room' || !pushToTalkEnabled) && pttActiveRef.current) {
      pttActiveRef.current = false
      onPushToTalkStateChange(false)
      if (pttUnmutedRef.current) {
        pttUnmutedRef.current = false
        onToggleMute()
      }
    }
  }, [appView, onPushToTalkStateChange, onToggleMute, pushToTalkEnabled])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target)) {
        return
      }

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        onDownloadLogs()
        showToast(translate('settings.downloadLogs'), 'success')
        return
      }

      if (appView !== 'room') {
        return
      }

      if (pushToTalkEnabled && matchesPushToTalkKey(event, pushToTalkKey)) {
        event.preventDefault()
        if (event.repeat || pttActiveRef.current) {
          return
        }

        pttActiveRef.current = true
        onPushToTalkStateChange(true)
        if (isMuted) {
          pttUnmutedRef.current = true
          onToggleMute()
        } else {
          pttUnmutedRef.current = false
        }
        return
      }

      switch (event.key.toLowerCase()) {
        case 'm':
          onToggleMute()
          break
        case 'l':
          onToggleSpeakerMute()
          break
        case 'v':
          onToggleVideo()
          break
        case 't':
          onToggleChat()
          break
        case 's':
          onToggleScreenShare()
          break
        case 'escape':
          if (connectionState === 'signaling' || connectionState === 'connecting') {
            onCancelSearch()
          } else {
            onRequestLeaveConfirm()
          }
          break
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (appView !== 'room' || !pushToTalkEnabled) {
        return
      }

      if (!matchesPushToTalkKey(event, pushToTalkKey)) {
        return
      }

      event.preventDefault()
      if (!pttActiveRef.current) {
        return
      }

      pttActiveRef.current = false
      onPushToTalkStateChange(false)
      if (pttUnmutedRef.current) {
        pttUnmutedRef.current = false
        onToggleMute()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [
    appView,
    connectionState,
    isMuted,
    onCancelSearch,
    onDownloadLogs,
    onPushToTalkStateChange,
    onRequestLeaveConfirm,
    onToggleChat,
    onToggleMute,
    onToggleScreenShare,
    onToggleSpeakerMute,
    onToggleVideo,
    pushToTalkEnabled,
    pushToTalkKey,
    showToast,
    translate
  ])
}
