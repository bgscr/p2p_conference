import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadCredentialsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const delegate = vi.hoisted(() => ({
  joinRoom: vi.fn().mockResolvedValue(undefined),
  leaveRoom: vi.fn(),
  setLocalStream: vi.fn(),
  replaceTrack: vi.fn(),
  broadcastMuteStatus: vi.fn(),
  sendChatMessage: vi.fn(),
  sendRemoteMicRequest: vi.fn().mockReturnValue('req-default'),
  respondRemoteMicRequest: vi.fn().mockReturnValue(true),
  sendRemoteMicStart: vi.fn().mockReturnValue(true),
  sendRemoteMicHeartbeat: vi.fn().mockReturnValue(true),
  sendRemoteMicStop: vi.fn().mockReturnValue(true),
  stopRemoteMicSession: vi.fn(),
  getPeers: vi.fn().mockReturnValue(new Map()),
  getSignalingState: vi.fn().mockReturnValue('connected'),
  getNetworkStatus: vi.fn().mockReturnValue({
    isOnline: true,
    wasInRoomWhenOffline: false,
    reconnectAttempts: 0
  }),
  getDebugInfo: vi.fn().mockReturnValue({ role: 'test' }),
  setCallbacks: vi.fn(),
  setOnSignalingStateChange: vi.fn(),
  getConnectionStats: vi.fn().mockResolvedValue(new Map()),
  setOnChatMessage: vi.fn(),
  setOnRemoteMicControl: vi.fn(),
  setOnModerationControl: vi.fn(),
  setRoomLocked: vi.fn().mockReturnValue(true),
  requestMuteAll: vi.fn().mockReturnValue('mute-req-1'),
  respondMuteAllRequest: vi.fn().mockReturnValue(true),
  setHandRaised: vi.fn().mockReturnValue(true),
  getModerationState: vi.fn().mockReturnValue({
    roomLocked: false,
    roomLockOwnerPeerId: null,
    localHandRaised: false,
    raisedHands: []
  }),
  setOnNetworkStatusChange: vi.fn(),
  setAudioRoutingMode: vi.fn().mockReturnValue(true),
  manualReconnect: vi.fn().mockResolvedValue(true)
}))

vi.mock('../renderer/signaling/SimplePeerManager', () => ({
  loadCredentials: loadCredentialsMock,
  peerManager: delegate,
  selfId: 'self-peer',
  SignalingState: undefined
}))

import { peerManager } from '../renderer/signaling/PeerManagerFacade'

function resetDelegateDefaults(): void {
  delegate.joinRoom = vi.fn().mockResolvedValue(undefined)
  delegate.leaveRoom = vi.fn()
  delegate.setLocalStream = vi.fn()
  delegate.replaceTrack = vi.fn()
  delegate.broadcastMuteStatus = vi.fn()
  delegate.sendChatMessage = vi.fn()
  delegate.sendRemoteMicRequest = vi.fn().mockReturnValue('req-default')
  delegate.respondRemoteMicRequest = vi.fn().mockReturnValue(true)
  delegate.sendRemoteMicStart = vi.fn().mockReturnValue(true)
  delegate.sendRemoteMicHeartbeat = vi.fn().mockReturnValue(true)
  delegate.sendRemoteMicStop = vi.fn().mockReturnValue(true)
  delegate.stopRemoteMicSession = vi.fn()
  delegate.getPeers = vi.fn().mockReturnValue(new Map([['peer-1', { id: 'peer-1' }]]))
  delegate.getSignalingState = vi.fn().mockReturnValue('connected')
  delegate.getNetworkStatus = vi.fn().mockReturnValue({
    isOnline: true,
    wasInRoomWhenOffline: false,
    reconnectAttempts: 2
  })
  delegate.getDebugInfo = vi.fn().mockReturnValue({ role: 'test' })
  delegate.setCallbacks = vi.fn()
  delegate.setOnSignalingStateChange = vi.fn()
  delegate.getConnectionStats = vi.fn().mockResolvedValue(new Map())
  delegate.setOnChatMessage = vi.fn()
  delegate.setOnRemoteMicControl = vi.fn()
  delegate.setOnModerationControl = vi.fn()
  delegate.setRoomLocked = vi.fn().mockReturnValue(true)
  delegate.requestMuteAll = vi.fn().mockReturnValue('mute-req-1')
  delegate.respondMuteAllRequest = vi.fn().mockReturnValue(true)
  delegate.setHandRaised = vi.fn().mockReturnValue(true)
  delegate.getModerationState = vi.fn().mockReturnValue({
    roomLocked: false,
    roomLockOwnerPeerId: null,
    localHandRaised: false,
    raisedHands: []
  })
  delegate.setOnNetworkStatusChange = vi.fn()
  delegate.setAudioRoutingMode = vi.fn().mockReturnValue(true)
  delegate.manualReconnect = vi.fn().mockResolvedValue(true)
}

describe('PeerManagerFacade', () => {
  beforeEach(async () => {
    resetDelegateDefaults()
    loadCredentialsMock.mockReset().mockResolvedValue(undefined)
    await peerManager.dispose()
    vi.clearAllMocks()
  })

  it('initializes with credential preload by default and can skip preload', async () => {
    await peerManager.init()
    expect(loadCredentialsMock).toHaveBeenCalledTimes(1)

    await peerManager.init({ preloadCredentials: false })
    expect(loadCredentialsMock).toHaveBeenCalledTimes(1)
  })

  it('joins and leaves via delegate wrappers', async () => {
    const result = await peerManager.join({ roomId: 'room-1', userName: 'Alice' })
    expect(delegate.joinRoom).toHaveBeenCalledWith('room-1', 'Alice')
    expect(result.localPeerId).toBe('self-peer')

    await peerManager.leave('user-request')
    expect(delegate.leaveRoom).toHaveBeenCalledTimes(1)
  })

  it('updates local media stream, track, and mute status', async () => {
    const stream = { id: 'stream-1' } as unknown as MediaStream
    const track = { id: 'track-1' } as unknown as MediaStreamTrack

    await peerManager.updateLocalMedia({
      stream,
      track,
      muteStatus: {
        micMuted: true,
        speakerMuted: false,
        videoEnabled: false,
        isScreenSharing: true
      }
    })

    expect(delegate.setLocalStream).toHaveBeenCalledWith(stream)
    expect(delegate.replaceTrack).toHaveBeenCalledWith(track)
    expect(delegate.broadcastMuteStatus).toHaveBeenCalledWith(true, false, false, true)
  })

  it('routes sendData payloads for chat and remote-mic control message variants', () => {
    peerManager.sendData({
      type: 'chat',
      content: 'hello',
      senderName: 'Alice'
    })
    expect(delegate.sendChatMessage).toHaveBeenCalledWith('hello', 'Alice')

    peerManager.sendData({ type: 'remote-mic-control', peerId: 'peer-1', message: { type: 'request' } })
    expect(delegate.sendRemoteMicRequest).toHaveBeenCalledWith('peer-1')

    peerManager.sendData({
      type: 'remote-mic-control',
      peerId: 'peer-1',
      message: { type: 'response', requestId: 'r1', accepted: true, reason: 'accepted' }
    })
    expect(delegate.respondRemoteMicRequest).toHaveBeenCalledWith('r1', true, 'accepted')

    peerManager.sendData({
      type: 'remote-mic-control',
      peerId: 'peer-1',
      message: { type: 'start', requestId: 'r2' }
    })
    expect(delegate.sendRemoteMicStart).toHaveBeenCalledWith('peer-1', 'r2')

    peerManager.sendData({
      type: 'remote-mic-control',
      peerId: 'peer-1',
      message: { type: 'heartbeat', requestId: 'r3' }
    })
    expect(delegate.sendRemoteMicHeartbeat).toHaveBeenCalledWith('peer-1', 'r3')

    peerManager.sendData({
      type: 'remote-mic-control',
      peerId: 'peer-1',
      message: { type: 'stop', requestId: 'r4', reason: 'busy' }
    })
    expect(delegate.sendRemoteMicStop).toHaveBeenCalledWith('peer-1', 'r4', 'busy')
  })

  it('builds snapshot from delegate methods and uses fallbacks when optional methods are missing', () => {
    const snapshot = peerManager.getSnapshot()
    expect(snapshot.peerCount).toBe(1)
    expect(snapshot.signalingState).toBe('connected')
    expect(snapshot.network.reconnectAttempts).toBe(2)
    expect(snapshot.debugInfo).toEqual({ role: 'test' })

    const originalGetPeers = delegate.getPeers
    const originalGetSignalingState = delegate.getSignalingState
    const originalGetNetworkStatus = delegate.getNetworkStatus
    const originalGetDebugInfo = delegate.getDebugInfo

    ; (delegate as any).getPeers = undefined
      ; (delegate as any).getSignalingState = undefined
      ; (delegate as any).getNetworkStatus = undefined
      ; (delegate as any).getDebugInfo = undefined

    const fallback = peerManager.getSnapshot()
    expect(fallback.peerCount).toBe(0)
    expect(fallback.signalingState).toBe('idle')
    expect(fallback.network.isOnline).toBe(true)
    expect(fallback.debugInfo).toEqual({})

    delegate.getPeers = originalGetPeers
    delegate.getSignalingState = originalGetSignalingState
    delegate.getNetworkStatus = originalGetNetworkStatus
    delegate.getDebugInfo = originalGetDebugInfo
  })

  it('registers, emits, and unsubscribes facade events through setCallbacks', () => {
    const legacyOnPeerJoin = vi.fn()
    const eventListener = vi.fn()
    const unsubscribe = peerManager.on('peerJoin', eventListener)

    peerManager.setCallbacks({ onPeerJoin: legacyOnPeerJoin })
    const callbacks = delegate.setCallbacks.mock.calls[0][0]
    callbacks.onPeerJoin('peer-1', 'Bob', 'win')

    expect(legacyOnPeerJoin).toHaveBeenCalledWith('peer-1', 'Bob', 'win')
    expect(eventListener).toHaveBeenCalledWith({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })

    unsubscribe()
    callbacks.onPeerJoin('peer-2', 'Cara', 'mac')
    expect(eventListener).toHaveBeenCalledTimes(1)
  })

  it('merges legacy callbacks across multiple setCallbacks calls', () => {
    const legacyOnPeerJoin = vi.fn()
    const legacyOnPeerLeave = vi.fn()

    peerManager.setCallbacks({ onPeerJoin: legacyOnPeerJoin })
    peerManager.setCallbacks({ onPeerLeave: legacyOnPeerLeave })

    const callbackCalls = delegate.setCallbacks.mock.calls
    const callbacks = callbackCalls[callbackCalls.length - 1][0]

    callbacks.onPeerJoin('peer-1', 'Bob', 'win')
    callbacks.onPeerLeave('peer-1', 'Bob', 'win')

    expect(legacyOnPeerJoin).toHaveBeenCalledWith('peer-1', 'Bob', 'win')
    expect(legacyOnPeerLeave).toHaveBeenCalledWith('peer-1', 'Bob', 'win')
  })

  it('keeps event emission working after repeated legacy callback registrations', () => {
    const eventListener = vi.fn()
    peerManager.on('peerJoin', eventListener)

    peerManager.setCallbacks({ onPeerJoin: vi.fn() })
    peerManager.setCallbacks({ onPeerLeave: vi.fn() })

    const callbackCalls = delegate.setCallbacks.mock.calls
    const callbacks = callbackCalls[callbackCalls.length - 1][0]
    callbacks.onPeerJoin('peer-9', 'Nora', 'linux')

    expect(eventListener).toHaveBeenCalledWith({
      peerId: 'peer-9',
      userName: 'Nora',
      platform: 'linux'
    })
  })

  it('installs delegate bridge in constructor so event listeners work before explicit setCallbacks', async () => {
    vi.resetModules()
    resetDelegateDefaults()
    delegate.setCallbacks = vi.fn()

    const module = await import('../renderer/signaling/PeerManagerFacade')
    const freshPeerManager = module.peerManager

    expect(delegate.setCallbacks).toHaveBeenCalledTimes(1)
    const callbacks = delegate.setCallbacks.mock.calls[0][0]

    const eventListener = vi.fn()
    freshPeerManager.on('peerJoin', eventListener)

    callbacks.onPeerJoin('peer-ctor', 'Ctor', 'mac')

    expect(eventListener).toHaveBeenCalledWith({
      peerId: 'peer-ctor',
      userName: 'Ctor',
      platform: 'mac'
    })
  })

  it('ignores setCallbacks when delegate implementation is missing', () => {
    const original = delegate.setCallbacks
      ; (delegate as any).setCallbacks = undefined
    peerManager.setCallbacks({ onPeerJoin: vi.fn() })
    expect(original).not.toHaveBeenCalled()
    delegate.setCallbacks = original
  })

  it('forwards signaling, chat, remote-mic, and network callbacks while emitting typed events', () => {
    const signalingListener = vi.fn()
    const chatListener = vi.fn()
    const remoteMicListener = vi.fn()
    const moderationListener = vi.fn()
    const networkListener = vi.fn()

    const signalOff = peerManager.on('signalingState', signalingListener)
    const chatOff = peerManager.on('chatMessage', chatListener)
    const rmOff = peerManager.on('remoteMicControl', remoteMicListener)
    const modOff = peerManager.on('moderationControl', moderationListener)
    const netOff = peerManager.on('networkStatus', networkListener)

    const externalSignaling = vi.fn()
    const externalChat = vi.fn()
    const externalRemoteMic = vi.fn()
    const externalModeration = vi.fn()
    const externalNetwork = vi.fn()

    peerManager.setOnSignalingStateChange(externalSignaling)
    peerManager.setOnChatMessage(externalChat)
    peerManager.setOnRemoteMicControl(externalRemoteMic)
    peerManager.setOnModerationControl(externalModeration)
    peerManager.setOnNetworkStatusChange(externalNetwork)

    const signalingBridge = delegate.setOnSignalingStateChange.mock.calls[0][0]
    signalingBridge('connecting')
    expect(externalSignaling).toHaveBeenCalledWith('connecting')
    expect(signalingListener).toHaveBeenCalledWith('connecting')

    const chatBridge = delegate.setOnChatMessage.mock.calls[0][0]
    chatBridge({ id: 'm1', sender: 'Bob', content: 'Hi', timestamp: Date.now(), type: 'text' })
    expect(externalChat).toHaveBeenCalled()
    expect(chatListener).toHaveBeenCalled()

    const remoteMicBridge = delegate.setOnRemoteMicControl.mock.calls[0][0]
    remoteMicBridge('peer-1', { type: 'rm_request', requestId: 'r1', sourcePeerId: 'peer-1', sourceName: 'Bob', targetPeerId: 'self-peer', ts: Date.now() })
    expect(externalRemoteMic).toHaveBeenCalled()
    expect(remoteMicListener).toHaveBeenCalled()

    const moderationBridge = delegate.setOnModerationControl.mock.calls[0][0]
    moderationBridge('peer-1', { type: 'mod_room_lock', locked: true, lockedByPeerId: 'peer-1', ts: Date.now() })
    expect(externalModeration).toHaveBeenCalled()
    expect(moderationListener).toHaveBeenCalled()

    const networkBridge = delegate.setOnNetworkStatusChange.mock.calls[0][0]
    networkBridge(false)
    expect(externalNetwork).toHaveBeenCalledWith(false)
    expect(networkListener).toHaveBeenCalledWith({ isOnline: false })

    signalOff()
    chatOff()
    rmOff()
    modOff()
    netOff()
  })

  it('supports guarded delegate methods and fallback return values', async () => {
    expect(peerManager.setAudioRoutingMode('exclusive', 'peer-1')).toBe(true)
    expect(await peerManager.getConnectionStats()).toBeInstanceOf(Map)
    expect(peerManager.sendRemoteMicRequest('peer-1')).toBe('req-default')
    expect(peerManager.respondRemoteMicRequest('r1', true)).toBe(true)
    expect(peerManager.sendRemoteMicStart('peer-1', 'r2')).toBe(true)
    expect(peerManager.sendRemoteMicHeartbeat('peer-1', 'r3')).toBe(true)
    expect(peerManager.sendRemoteMicStop('peer-1', 'r4')).toBe(true)
    expect(peerManager.setRoomLocked(true)).toBe(true)
    expect(peerManager.requestMuteAll()).toBe('mute-req-1')
    expect(peerManager.respondMuteAllRequest('peer-1', 'mute-req-1', true)).toBe(true)
    expect(peerManager.setHandRaised(true)).toBe(true)
    expect(peerManager.getModerationState()).toEqual({
      roomLocked: false,
      roomLockOwnerPeerId: null,
      localHandRaised: false,
      raisedHands: []
    })
    expect(await peerManager.manualReconnect()).toBe(true)
    expect(peerManager.getNetworkStatus().reconnectAttempts).toBe(2)
    expect(peerManager.getSignalingState()).toBe('connected')

    const originalFns = {
      setLocalStream: delegate.setLocalStream,
      replaceTrack: delegate.replaceTrack,
      setAudioRoutingMode: delegate.setAudioRoutingMode,
      broadcastMuteStatus: delegate.broadcastMuteStatus,
      getConnectionStats: delegate.getConnectionStats,
      setOnChatMessage: delegate.setOnChatMessage,
      sendChatMessage: delegate.sendChatMessage,
      setOnRemoteMicControl: delegate.setOnRemoteMicControl,
      setOnModerationControl: delegate.setOnModerationControl,
      sendRemoteMicRequest: delegate.sendRemoteMicRequest,
      respondRemoteMicRequest: delegate.respondRemoteMicRequest,
      sendRemoteMicStart: delegate.sendRemoteMicStart,
      sendRemoteMicHeartbeat: delegate.sendRemoteMicHeartbeat,
      sendRemoteMicStop: delegate.sendRemoteMicStop,
      stopRemoteMicSession: delegate.stopRemoteMicSession,
      setRoomLocked: delegate.setRoomLocked,
      requestMuteAll: delegate.requestMuteAll,
      respondMuteAllRequest: delegate.respondMuteAllRequest,
      setHandRaised: delegate.setHandRaised,
      getModerationState: delegate.getModerationState,
      setOnNetworkStatusChange: delegate.setOnNetworkStatusChange,
      getNetworkStatus: delegate.getNetworkStatus,
      manualReconnect: delegate.manualReconnect
    }

      ; (delegate as any).setLocalStream = undefined
      ; (delegate as any).replaceTrack = undefined
      ; (delegate as any).setAudioRoutingMode = undefined
      ; (delegate as any).broadcastMuteStatus = undefined
      ; (delegate as any).getConnectionStats = undefined
      ; (delegate as any).setOnChatMessage = undefined
      ; (delegate as any).sendChatMessage = undefined
      ; (delegate as any).setOnRemoteMicControl = undefined
      ; (delegate as any).setOnModerationControl = undefined
      ; (delegate as any).sendRemoteMicRequest = undefined
      ; (delegate as any).respondRemoteMicRequest = undefined
      ; (delegate as any).sendRemoteMicStart = undefined
      ; (delegate as any).sendRemoteMicHeartbeat = undefined
      ; (delegate as any).sendRemoteMicStop = undefined
      ; (delegate as any).stopRemoteMicSession = undefined
      ; (delegate as any).setRoomLocked = undefined
      ; (delegate as any).requestMuteAll = undefined
      ; (delegate as any).respondMuteAllRequest = undefined
      ; (delegate as any).setHandRaised = undefined
      ; (delegate as any).getModerationState = undefined
      ; (delegate as any).setOnNetworkStatusChange = undefined
      ; (delegate as any).getNetworkStatus = undefined
      ; (delegate as any).manualReconnect = undefined

    const fakeStream = { id: 's1' } as unknown as MediaStream
    const fakeTrack = { id: 't1' } as unknown as MediaStreamTrack
    peerManager.setLocalStream(fakeStream)
    peerManager.replaceTrack(fakeTrack)
    peerManager.broadcastMuteStatus(true, false)
    peerManager.setOnChatMessage(null)
    peerManager.sendChatMessage('hi', 'me')
    peerManager.setOnRemoteMicControl(null)
    peerManager.setOnModerationControl(null)
    peerManager.stopRemoteMicSession()
    peerManager.setOnNetworkStatusChange(() => { })

    expect(peerManager.setAudioRoutingMode('broadcast')).toBe(false)
    expect(await peerManager.getConnectionStats()).toEqual(new Map())
    expect(peerManager.sendRemoteMicRequest('peer-1')).toBeNull()
    expect(peerManager.respondRemoteMicRequest('r1', false)).toBe(false)
    expect(peerManager.sendRemoteMicStart('peer-1', 'r2')).toBe(false)
    expect(peerManager.sendRemoteMicHeartbeat('peer-1', 'r3')).toBe(false)
    expect(peerManager.sendRemoteMicStop('peer-1', 'r4')).toBe(false)
    expect(peerManager.setRoomLocked(true)).toBe(false)
    expect(peerManager.requestMuteAll()).toBeNull()
    expect(peerManager.respondMuteAllRequest('peer-1', 'r1', true)).toBe(false)
    expect(peerManager.setHandRaised(true)).toBe(false)
    expect(peerManager.getModerationState()).toEqual({
      roomLocked: false,
      roomLockOwnerPeerId: null,
      localHandRaised: false,
      raisedHands: []
    })
    expect(peerManager.getNetworkStatus()).toEqual({
      isOnline: true,
      wasInRoomWhenOffline: false,
      reconnectAttempts: 0
    })
    expect(await peerManager.manualReconnect()).toBe(false)

    Object.assign(delegate, originalFns)
  })

  it('forwards explicit remote-mic stop reason and stop-session reason defaults', () => {
    peerManager.sendRemoteMicStop('peer-1', 'req-1')
    expect(delegate.sendRemoteMicStop).toHaveBeenCalledWith('peer-1', 'req-1', 'unknown')

    peerManager.stopRemoteMicSession()
    expect(delegate.stopRemoteMicSession).toHaveBeenCalledWith('unknown')
  })

  it('exposes joinRoom and leaveRoom legacy wrappers', async () => {
    await peerManager.joinRoom('room-legacy', 'LegacyUser')
    expect(delegate.joinRoom).toHaveBeenCalledWith('room-legacy', 'LegacyUser')
    peerManager.leaveRoom()
    expect(delegate.leaveRoom).toHaveBeenCalled()
  })

  it('cleans up listeners on dispose', async () => {
    const listener = vi.fn()
    peerManager.on('peerJoin', listener)
    peerManager.setCallbacks({})
    const callbacks = delegate.setCallbacks.mock.calls[0][0]
    callbacks.onPeerJoin('peer-1', 'Alice', 'win')
    expect(listener).toHaveBeenCalledTimes(1)

    await peerManager.dispose()
    callbacks.onPeerJoin('peer-2', 'Bob', 'mac')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(delegate.leaveRoom).toHaveBeenCalled()
  })
})
