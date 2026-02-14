export type AppView = 'lobby' | 'room' | 'settings'

interface SessionExitCleanupOptions {
  leaveRoom: () => void
  stopCapture: () => void
  isScreenSharing: boolean
  stopScreenShare: () => void
  stopRemoteMicSession: () => void
  resetRemoteMicSession: () => void
  disconnectAudioPipeline: () => void
  clearRemoteStreams: () => void
  resetSpeakerMute?: () => void
  resetPushToTalk: () => void
  closeChat: () => void
  resetModerationState: () => void
  resetChat: () => void
  setAppView: (view: AppView) => void
}

export function executeSessionExitCleanup(options: SessionExitCleanupOptions): void {
  options.stopRemoteMicSession()
  options.resetRemoteMicSession()
  options.leaveRoom()
  options.stopCapture()

  if (options.isScreenSharing) {
    options.stopScreenShare()
  }

  options.disconnectAudioPipeline()
  options.clearRemoteStreams()
  options.resetSpeakerMute?.()
  options.resetPushToTalk()
  options.closeChat()
  options.resetModerationState()
  options.resetChat()
  options.setAppView('lobby')
}
