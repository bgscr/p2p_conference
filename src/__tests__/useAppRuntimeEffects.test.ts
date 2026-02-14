import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Peer } from '@/types'
import {
  useAppRuntimeEffects,
  type UseAppRuntimeEffectsOptions
} from '../renderer/hooks/useAppRuntimeEffects'
import { logger } from '../renderer/utils/Logger'
import { soundManager } from '../renderer/audio-processor/SoundManager'

vi.mock('../renderer/utils/Logger', () => ({
  logger: {
    logSystemInfo: vi.fn(),
    downloadLogs: vi.fn()
  },
  AppLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('../renderer/audio-processor/SoundManager', () => ({
  soundManager: {
    destroy: vi.fn()
  }
}))

function createPeer(id: string): Peer {
  return {
    id,
    name: id,
    isMuted: false,
    audioLevel: 0,
    connectionState: 'connected'
  }
}

function createStream(id: string, audioTrackCount: number = 1): MediaStream {
  const tracks = Array.from({ length: audioTrackCount }, (_, index) => ({
    id: `${id}-audio-${index}`,
    enabled: true,
    muted: false
  })) as unknown as MediaStreamTrack[]

  return {
    id,
    getTracks: () => tracks,
    getAudioTracks: () => tracks
  } as unknown as MediaStream
}

type HookProps = UseAppRuntimeEffectsOptions

function createHookProps(overrides: Partial<HookProps> = {}): HookProps {
  const p2pManager: UseAppRuntimeEffectsOptions['p2pManager'] = {
    on: vi.fn((_event: 'remoteStream' | 'error', _callback: unknown) => vi.fn()),
    setLocalStream: vi.fn()
  }

  const audioPipeline: UseAppRuntimeEffectsOptions['audioPipeline'] = {
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn()
  }

  let remoteStreams = new Map<string, MediaStream>()
  const setRemoteStreams = vi.fn((next: Map<string, MediaStream> | ((prev: Map<string, MediaStream>) => Map<string, MediaStream>)) => {
    remoteStreams = typeof next === 'function' ? next(remoteStreams) : next
    return remoteStreams
  })

  const props: HookProps = {
    p2pManager,
    audioPipeline,
    peers: new Map(),
    appView: 'lobby',
    connectionState: 'idle',
    isMuted: false,
    localStream: null,
    showToast: vi.fn(),
    t: vi.fn((key: string) => key),
    clearToasts: vi.fn(),
    clearRemoteMicTimers: vi.fn(),
    onToggleMute: vi.fn(),
    onRequestLeaveConfirm: vi.fn(),
    onPipelineReady: vi.fn(),
    onPeerDisconnected: vi.fn(),
    setRemoteStreams,
    ...overrides
  }

  return props
}

describe('useAppRuntimeEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes runtime, binds tray/menu listeners, and cleans up on unmount', async () => {
    const downloadUnsub = vi.fn()
    const trayMuteUnsub = vi.fn()
    const trayLeaveUnsub = vi.fn()
    let onDownloadLogs: (() => void) | undefined
    let onTrayToggleMute: (() => void) | undefined
    let onTrayLeaveCall: (() => void) | undefined

    Object.defineProperty(window, 'electronAPI', {
      value: {
        onDownloadLogs: vi.fn((cb: () => void) => {
          onDownloadLogs = cb
          return downloadUnsub
        }),
        onTrayToggleMute: vi.fn((cb: () => void) => {
          onTrayToggleMute = cb
          return trayMuteUnsub
        }),
        onTrayLeaveCall: vi.fn((cb: () => void) => {
          onTrayLeaveCall = cb
          return trayLeaveUnsub
        }),
        showWindow: vi.fn()
      },
      writable: true,
      configurable: true
    })

    const props = createHookProps()
    const { unmount } = renderHook((currentProps: HookProps) => useAppRuntimeEffects(currentProps), {
      initialProps: props
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(logger.logSystemInfo).toHaveBeenCalledTimes(1)
    expect(props.audioPipeline.initialize).toHaveBeenCalledTimes(1)
    expect(props.onPipelineReady).toHaveBeenCalledWith(true)

    act(() => {
      onDownloadLogs?.()
      onTrayToggleMute?.()
      onTrayLeaveCall?.()
    })

    expect(logger.downloadLogs).toHaveBeenCalledTimes(1)
    expect(props.showToast).toHaveBeenCalledWith('settings.downloadLogs', 'success')
    expect(props.onToggleMute).toHaveBeenCalledTimes(1)
    expect(props.onRequestLeaveConfirm).toHaveBeenCalledTimes(1)
    expect(window.electronAPI?.showWindow).toHaveBeenCalledTimes(1)

    unmount()

    expect(downloadUnsub).toHaveBeenCalledTimes(1)
    expect(trayMuteUnsub).toHaveBeenCalledTimes(1)
    expect(trayLeaveUnsub).toHaveBeenCalledTimes(1)
    expect(props.clearToasts).toHaveBeenCalledTimes(1)
    expect(props.clearRemoteMicTimers).toHaveBeenCalledTimes(1)
    expect(props.audioPipeline.destroy).toHaveBeenCalledTimes(1)
    expect(soundManager.destroy).toHaveBeenCalledTimes(1)
  })

  it('registers peer manager event subscriptions and updates remote streams', () => {
    const props = createHookProps()
    renderHook((currentProps: HookProps) => useAppRuntimeEffects(currentProps), {
      initialProps: props
    })

    const onMock = props.p2pManager.on as unknown as ReturnType<typeof vi.fn>
    const remoteStreamListener = onMock.mock.calls.find(([event]) => event === 'remoteStream')?.[1] as
      | ((payload: { peerId: string; stream: MediaStream }) => void)
      | undefined
    const errorListener = onMock.mock.calls.find(([event]) => event === 'error')?.[1] as
      | ((payload: { error: Error; context: string }) => void)
      | undefined
    const remoteStream = createStream('stream-1')

    act(() => {
      remoteStreamListener?.({ peerId: 'peer-1', stream: remoteStream })
      errorListener?.({ error: new Error('transport-lost'), context: 'ice' })
    })

    expect(onMock).toHaveBeenCalledWith('remoteStream', expect.any(Function))
    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function))
    expect(props.setRemoteStreams).toHaveBeenCalled()
    expect(props.showToast).toHaveBeenCalledWith('Connection error: transport-lost', 'error')
  })

  it('tracks disconnected peers, syncs tray state, flashes window, and sets local stream while in room', async () => {
    const flashWindow = vi.fn()
    const updateCallState = vi.fn()
    const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false)

    Object.defineProperty(window, 'electronAPI', {
      value: {
        flashWindow,
        updateCallState
      },
      writable: true,
      configurable: true
    })

    const localStream = createStream('local-stream')
    const initialProps = createHookProps({
      peers: new Map([
        ['peer-1', createPeer('peer-1')],
        ['peer-2', createPeer('peer-2')]
      ]),
      appView: 'room',
      connectionState: 'connected',
      isMuted: true,
      localStream
    })

    const { rerender } = renderHook((currentProps: HookProps) => useAppRuntimeEffects(currentProps), {
      initialProps
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(updateCallState).toHaveBeenCalledWith({ inCall: true, muted: true })
    expect(flashWindow).toHaveBeenCalled()
    expect(initialProps.p2pManager.setLocalStream).toHaveBeenCalledWith(localStream)

    rerender({
      ...initialProps,
      peers: new Map([
        ['peer-1', createPeer('peer-1')]
      ])
    })

    expect(initialProps.onPeerDisconnected).toHaveBeenCalledWith('peer-2')
    hasFocusSpy.mockRestore()
  })
})
