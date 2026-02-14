import { describe, expect, it, vi } from 'vitest'
import { executeSessionExitCleanup } from '../renderer/hooks/sessionExitCleanup'

function createCleanupMocks() {
  return {
    leaveRoom: vi.fn(),
    stopCapture: vi.fn(),
    stopScreenShare: vi.fn(),
    stopRemoteMicSession: vi.fn(),
    resetRemoteMicSession: vi.fn(),
    disconnectAudioPipeline: vi.fn(),
    clearRemoteStreams: vi.fn(),
    resetSpeakerMute: vi.fn(),
    resetPushToTalk: vi.fn(),
    closeChat: vi.fn(),
    resetModerationState: vi.fn(),
    resetChat: vi.fn(),
    setAppView: vi.fn()
  }
}

describe('executeSessionExitCleanup', () => {
  it('runs full cleanup and resets view to lobby', () => {
    const mocks = createCleanupMocks()

    executeSessionExitCleanup({
      ...mocks,
      isScreenSharing: true
    })

    expect(mocks.stopRemoteMicSession).toHaveBeenCalledTimes(1)
    expect(mocks.resetRemoteMicSession).toHaveBeenCalledTimes(1)
    expect(mocks.leaveRoom).toHaveBeenCalledTimes(1)
    expect(mocks.stopCapture).toHaveBeenCalledTimes(1)
    expect(mocks.stopScreenShare).toHaveBeenCalledTimes(1)
    expect(mocks.disconnectAudioPipeline).toHaveBeenCalledTimes(1)
    expect(mocks.clearRemoteStreams).toHaveBeenCalledTimes(1)
    expect(mocks.resetSpeakerMute).toHaveBeenCalledTimes(1)
    expect(mocks.resetPushToTalk).toHaveBeenCalledTimes(1)
    expect(mocks.closeChat).toHaveBeenCalledTimes(1)
    expect(mocks.resetModerationState).toHaveBeenCalledTimes(1)
    expect(mocks.resetChat).toHaveBeenCalledTimes(1)
    expect(mocks.setAppView).toHaveBeenCalledWith('lobby')
  })

  it('skips optional resets when not applicable', () => {
    const mocks = createCleanupMocks()

    executeSessionExitCleanup({
      leaveRoom: mocks.leaveRoom,
      stopCapture: mocks.stopCapture,
      isScreenSharing: false,
      stopScreenShare: mocks.stopScreenShare,
      stopRemoteMicSession: mocks.stopRemoteMicSession,
      resetRemoteMicSession: mocks.resetRemoteMicSession,
      disconnectAudioPipeline: mocks.disconnectAudioPipeline,
      clearRemoteStreams: mocks.clearRemoteStreams,
      resetPushToTalk: mocks.resetPushToTalk,
      closeChat: mocks.closeChat,
      resetModerationState: mocks.resetModerationState,
      resetChat: mocks.resetChat,
      setAppView: mocks.setAppView
    })

    expect(mocks.stopScreenShare).not.toHaveBeenCalled()
    expect(mocks.resetSpeakerMute).not.toHaveBeenCalled()
    expect(mocks.setAppView).toHaveBeenCalledWith('lobby')
  })
})
