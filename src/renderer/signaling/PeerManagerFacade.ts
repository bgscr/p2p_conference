import type {
  ChatMessage,
  ConnectionQuality,
  RemoteMicControlMessage,
  ModerationControlMessage,
  ModerationState,
  AudioRoutingMode,
  RemoteMicStopReason
} from '@/types'
import {
  loadCredentials,
  peerManager as legacyPeerManager,
  selfId,
  type SignalingState,
  type SimplePeerManager
} from './SimplePeerManager'

type PeerPlatform = 'win' | 'mac' | 'linux'

export interface InitOptions {
  preloadCredentials?: boolean
}

export interface JoinRequest {
  roomId: string
  userName: string
}

export interface JoinResult {
  localPeerId: string
}

export type LeaveReason = 'user-request' | 'cleanup' | 'unknown'

export interface LocalMediaPatch {
  stream?: MediaStream
  track?: MediaStreamTrack
  muteStatus?: {
    micMuted: boolean
    speakerMuted: boolean
    videoEnabled?: boolean
    isScreenSharing?: boolean
  }
}

export type DataMessage =
  | {
    type: 'chat'
    content: string
    senderName: string
  }
  | {
    type: 'remote-mic-control'
    peerId: string
    message:
    | {
      type: 'request'
    }
    | {
      type: 'response'
      requestId: string
      accepted: boolean
      reason?:
      | 'accepted'
      | 'rejected'
      | 'busy'
      | 'virtual-device-missing'
      | 'virtual-device-install-failed'
      | 'virtual-device-restart-required'
      | 'user-cancelled'
      | 'unknown'
    }
    | {
      type: 'start'
      requestId: string
    }
    | {
      type: 'heartbeat'
      requestId: string
    }
    | {
      type: 'stop'
      requestId: string
      reason?: RemoteMicStopReason
    }
  }

export interface PeerSnapshot {
  peerCount: number
  signalingState: SignalingState
  network: {
    isOnline: boolean
    wasInRoomWhenOffline: boolean
    reconnectAttempts: number
  }
  debugInfo: object
}

export interface PeerManagerEventMap {
  signalingState: SignalingState
  peerJoin: {
    peerId: string
    userName: string
    platform: PeerPlatform
  }
  peerLeave: {
    peerId: string
    userName: string
    platform: PeerPlatform
  }
  remoteStream: {
    peerId: string
    stream: MediaStream
  }
  error: {
    error: Error
    context: string
  }
  peerMuteChange: {
    peerId: string
    muteStatus: {
      micMuted: boolean
      speakerMuted: boolean
      videoMuted?: boolean
      videoEnabled?: boolean
      isScreenSharing?: boolean
    }
  }
  chatMessage: ChatMessage
  remoteMicControl: {
    peerId: string
    message: RemoteMicControlMessage
  }
  moderationControl: {
    peerId: string
    message: ModerationControlMessage
  }
  networkStatus: {
    isOnline: boolean
  }
}

interface LegacyCallbacks {
  onPeerJoin?: (peerId: string, userName: string, platform: PeerPlatform) => void
  onPeerLeave?: (peerId: string, userName: string, platform: PeerPlatform) => void
  onRemoteStream?: (peerId: string, stream: MediaStream) => void
  onError?: (error: Error, context: string) => void
  onPeerMuteChange?: (
    peerId: string,
    muteStatus: {
      micMuted: boolean
      speakerMuted: boolean
      videoMuted?: boolean
      videoEnabled?: boolean
      isScreenSharing?: boolean
    }
  ) => void
}

export interface PeerManager {
  init(opts?: InitOptions): Promise<void>
  join(req: JoinRequest): Promise<JoinResult>
  leave(reason?: LeaveReason): Promise<void>
  updateLocalMedia(patch: LocalMediaPatch): Promise<void>
  startScreenShare(): Promise<void>
  stopScreenShare(): Promise<void>
  sendData(msg: DataMessage): void
  getSnapshot(): PeerSnapshot
  on<K extends keyof PeerManagerEventMap>(event: K, cb: (payload: PeerManagerEventMap[K]) => void): () => void
  dispose(): Promise<void>
  setCallbacks(callbacks: LegacyCallbacks): void
  setOnSignalingStateChange(callback: (state: SignalingState) => void): void
  getSignalingState(): SignalingState
  setLocalStream(stream: MediaStream): void
  replaceTrack(newTrack: MediaStreamTrack): void
  setAudioRoutingMode(mode: AudioRoutingMode, targetPeerId?: string): boolean
  broadcastMuteStatus(micMuted: boolean, speakerMuted: boolean, videoEnabled?: boolean, isScreenSharing?: boolean): void
  getConnectionStats(): Promise<Map<string, ConnectionQuality>>
  setOnChatMessage(callback: ((msg: ChatMessage) => void) | null): void
  sendChatMessage(content: string, senderName: string): void
  setOnRemoteMicControl(callback: ((peerId: string, message: RemoteMicControlMessage) => void) | null): void
  setOnModerationControl(callback: ((peerId: string, message: ModerationControlMessage) => void) | null): void
  sendRemoteMicRequest(targetPeerId: string): string | null
  respondRemoteMicRequest(
    requestId: string,
    accepted: boolean,
    reason?:
    | 'accepted'
    | 'rejected'
    | 'busy'
    | 'virtual-device-missing'
    | 'virtual-device-install-failed'
    | 'virtual-device-restart-required'
    | 'user-cancelled'
    | 'unknown'
  ): boolean
  sendRemoteMicStart(peerId: string, requestId: string): boolean
  sendRemoteMicHeartbeat(peerId: string, requestId: string): boolean
  sendRemoteMicStop(peerId: string, requestId: string, reason?: RemoteMicStopReason): boolean
  stopRemoteMicSession(reason?: RemoteMicStopReason): void
  setRoomLocked(locked: boolean): boolean
  requestMuteAll(reason?: string): string | null
  respondMuteAllRequest(peerId: string, requestId: string, accepted: boolean): boolean
  setHandRaised(raised: boolean): boolean
  getModerationState(): ModerationState
  setOnNetworkStatusChange(callback: (isOnline: boolean) => void): void
  getNetworkStatus(): { isOnline: boolean; wasInRoomWhenOffline: boolean; reconnectAttempts: number }
  manualReconnect(): Promise<boolean>
  joinRoom(roomId: string, userName: string): Promise<void>
  leaveRoom(): void
}

class SimplePeerManagerFacade implements PeerManager {
  private listeners: {
    [K in keyof PeerManagerEventMap]: Set<(payload: PeerManagerEventMap[K]) => void>
  } = {
      signalingState: new Set(),
      peerJoin: new Set(),
      peerLeave: new Set(),
      remoteStream: new Set(),
      error: new Set(),
      peerMuteChange: new Set(),
      chatMessage: new Set(),
      remoteMicControl: new Set(),
      moderationControl: new Set(),
      networkStatus: new Set()
    }

  private legacyCallbacks: LegacyCallbacks = {}
  private onSignalingStateChange: ((state: SignalingState) => void) | null = null
  private onChatMessage: ((msg: ChatMessage) => void) | null = null
  private onRemoteMicControl: ((peerId: string, message: RemoteMicControlMessage) => void) | null = null
  private onModerationControl: ((peerId: string, message: ModerationControlMessage) => void) | null = null
  private onNetworkStatusChange: ((isOnline: boolean) => void) | null = null

  constructor(private readonly delegate: SimplePeerManager) {
    this.applyDelegateCallbacks()
  }

  private applyDelegateCallbacks(): void {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setCallbacks !== 'function') {
      return
    }

    delegate.setCallbacks({
      onPeerJoin: (peerId, userName, platform) => {
        this.legacyCallbacks.onPeerJoin?.(peerId, userName, platform)
        this.emit('peerJoin', { peerId, userName, platform })
      },
      onPeerLeave: (peerId, userName, platform) => {
        this.legacyCallbacks.onPeerLeave?.(peerId, userName, platform)
        this.emit('peerLeave', { peerId, userName, platform })
      },
      onRemoteStream: (peerId, stream) => {
        this.legacyCallbacks.onRemoteStream?.(peerId, stream)
        this.emit('remoteStream', { peerId, stream })
      },
      onError: (error, context) => {
        this.legacyCallbacks.onError?.(error, context)
        this.emit('error', { error, context })
      },
      onPeerMuteChange: (peerId, muteStatus) => {
        this.legacyCallbacks.onPeerMuteChange?.(peerId, muteStatus)
        this.emit('peerMuteChange', { peerId, muteStatus })
      }
    })
  }

  private emit<K extends keyof PeerManagerEventMap>(event: K, payload: PeerManagerEventMap[K]): void {
    this.listeners[event].forEach(listener => listener(payload))
  }

  async init(opts?: InitOptions): Promise<void> {
    if (opts?.preloadCredentials !== false) {
      await loadCredentials()
    }
  }

  async join(req: JoinRequest): Promise<JoinResult> {
    await this.delegate.joinRoom(req.roomId, req.userName)
    return { localPeerId: selfId }
  }

  async leave(_reason: LeaveReason = 'unknown'): Promise<void> {
    this.delegate.leaveRoom()
  }

  async updateLocalMedia(patch: LocalMediaPatch): Promise<void> {
    if (patch.stream) {
      this.delegate.setLocalStream(patch.stream)
    }
    if (patch.track) {
      this.delegate.replaceTrack(patch.track)
    }
    if (patch.muteStatus) {
      this.delegate.broadcastMuteStatus(
        patch.muteStatus.micMuted,
        patch.muteStatus.speakerMuted,
        patch.muteStatus.videoEnabled ?? true,
        patch.muteStatus.isScreenSharing ?? false
      )
    }
  }

  async startScreenShare(): Promise<void> {
    return
  }

  async stopScreenShare(): Promise<void> {
    return
  }

  sendData(msg: DataMessage): void {
    if (msg.type === 'chat') {
      this.delegate.sendChatMessage(msg.content, msg.senderName)
      return
    }

    const { peerId, message } = msg
    switch (message.type) {
      case 'request':
        this.delegate.sendRemoteMicRequest(peerId)
        break
      case 'response':
        this.delegate.respondRemoteMicRequest(message.requestId, message.accepted, message.reason)
        break
      case 'start':
        this.delegate.sendRemoteMicStart(peerId, message.requestId)
        break
      case 'heartbeat':
        this.delegate.sendRemoteMicHeartbeat(peerId, message.requestId)
        break
      case 'stop':
        this.delegate.sendRemoteMicStop(peerId, message.requestId, message.reason)
        break
    }
  }

  getSnapshot(): PeerSnapshot {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    const peers = typeof delegate.getPeers === 'function' ? delegate.getPeers() : new Map()
    const signalingState = typeof delegate.getSignalingState === 'function' ? delegate.getSignalingState() : 'idle'
    const networkStatus = typeof delegate.getNetworkStatus === 'function'
      ? delegate.getNetworkStatus()
      : { isOnline: true, wasInRoomWhenOffline: false, reconnectAttempts: 0 }
    const debugInfo = typeof delegate.getDebugInfo === 'function' ? delegate.getDebugInfo() : {}

    return {
      peerCount: peers.size,
      signalingState,
      network: networkStatus,
      debugInfo
    }
  }

  on<K extends keyof PeerManagerEventMap>(event: K, cb: (payload: PeerManagerEventMap[K]) => void): () => void {
    const listenerSet = this.listeners[event]
    listenerSet.add(cb)
    return () => {
      listenerSet.delete(cb)
    }
  }

  async dispose(): Promise<void> {
    this.delegate.leaveRoom()
    this.listeners.signalingState.clear()
    this.listeners.peerJoin.clear()
    this.listeners.peerLeave.clear()
    this.listeners.remoteStream.clear()
    this.listeners.error.clear()
    this.listeners.peerMuteChange.clear()
    this.listeners.chatMessage.clear()
    this.listeners.remoteMicControl.clear()
    this.listeners.moderationControl.clear()
    this.listeners.networkStatus.clear()
  }

  setCallbacks(callbacks: LegacyCallbacks): void {
    this.legacyCallbacks = { ...this.legacyCallbacks, ...callbacks }
    this.applyDelegateCallbacks()
  }

  setOnSignalingStateChange(callback: (state: SignalingState) => void): void {
    this.onSignalingStateChange = callback
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setOnSignalingStateChange === 'function') {
      delegate.setOnSignalingStateChange((state) => {
        this.onSignalingStateChange?.(state)
        this.emit('signalingState', state)
      })
    }
  }

  getSignalingState(): SignalingState {
    return this.delegate.getSignalingState()
  }

  setLocalStream(stream: MediaStream): void {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setLocalStream === 'function') {
      delegate.setLocalStream(stream)
    }
  }

  replaceTrack(newTrack: MediaStreamTrack): void {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.replaceTrack === 'function') {
      delegate.replaceTrack(newTrack)
    }
  }

  setAudioRoutingMode(mode: AudioRoutingMode, targetPeerId?: string): boolean {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setAudioRoutingMode === 'function') {
      return delegate.setAudioRoutingMode(mode, targetPeerId)
    }
    return false
  }

  broadcastMuteStatus(
    micMuted: boolean,
    speakerMuted: boolean,
    videoEnabled: boolean = true,
    isScreenSharing: boolean = false
  ): void {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.broadcastMuteStatus === 'function') {
      delegate.broadcastMuteStatus(micMuted, speakerMuted, videoEnabled, isScreenSharing)
    }
  }

  getConnectionStats(): Promise<Map<string, ConnectionQuality>> {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.getConnectionStats === 'function') {
      return delegate.getConnectionStats()
    }
    return Promise.resolve(new Map())
  }

  setOnChatMessage(callback: ((msg: ChatMessage) => void) | null): void {
    this.onChatMessage = callback
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setOnChatMessage === 'function') {
      delegate.setOnChatMessage((message) => {
        this.onChatMessage?.(message)
        this.emit('chatMessage', message)
      })
    }
  }

  sendChatMessage(content: string, senderName: string): void {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.sendChatMessage === 'function') {
      delegate.sendChatMessage(content, senderName)
    }
  }

  setOnRemoteMicControl(callback: ((peerId: string, message: RemoteMicControlMessage) => void) | null): void {
    this.onRemoteMicControl = callback
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setOnRemoteMicControl === 'function') {
      delegate.setOnRemoteMicControl((peerId, message) => {
        this.onRemoteMicControl?.(peerId, message)
        this.emit('remoteMicControl', { peerId, message })
      })
    }
  }

  setOnModerationControl(callback: ((peerId: string, message: ModerationControlMessage) => void) | null): void {
    this.onModerationControl = callback
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setOnModerationControl === 'function') {
      delegate.setOnModerationControl((peerId, message) => {
        this.onModerationControl?.(peerId, message)
        this.emit('moderationControl', { peerId, message })
      })
    }
  }

  sendRemoteMicRequest(targetPeerId: string): string | null {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.sendRemoteMicRequest === 'function') {
      return delegate.sendRemoteMicRequest(targetPeerId)
    }
    return null
  }

  respondRemoteMicRequest(
    requestId: string,
    accepted: boolean,
    reason:
    | 'accepted'
    | 'rejected'
    | 'busy'
    | 'virtual-device-missing'
    | 'virtual-device-install-failed'
    | 'virtual-device-restart-required'
    | 'user-cancelled'
    | 'unknown' = accepted ? 'accepted' : 'rejected'
  ): boolean {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.respondRemoteMicRequest === 'function') {
      return delegate.respondRemoteMicRequest(requestId, accepted, reason)
    }
    return false
  }

  sendRemoteMicStart(peerId: string, requestId: string): boolean {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.sendRemoteMicStart === 'function') {
      return delegate.sendRemoteMicStart(peerId, requestId)
    }
    return false
  }

  sendRemoteMicHeartbeat(peerId: string, requestId: string): boolean {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.sendRemoteMicHeartbeat === 'function') {
      return delegate.sendRemoteMicHeartbeat(peerId, requestId)
    }
    return false
  }

  sendRemoteMicStop(peerId: string, requestId: string, reason: RemoteMicStopReason = 'unknown'): boolean {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.sendRemoteMicStop === 'function') {
      return delegate.sendRemoteMicStop(peerId, requestId, reason)
    }
    return false
  }

  stopRemoteMicSession(reason: RemoteMicStopReason = 'unknown'): void {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.stopRemoteMicSession === 'function') {
      delegate.stopRemoteMicSession(reason)
    }
  }

  setRoomLocked(locked: boolean): boolean {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setRoomLocked === 'function') {
      return delegate.setRoomLocked(locked)
    }
    return false
  }

  requestMuteAll(reason: string = 'host-request'): string | null {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.requestMuteAll === 'function') {
      return delegate.requestMuteAll(reason)
    }
    return null
  }

  respondMuteAllRequest(peerId: string, requestId: string, accepted: boolean): boolean {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.respondMuteAllRequest === 'function') {
      return delegate.respondMuteAllRequest(peerId, requestId, accepted)
    }
    return false
  }

  setHandRaised(raised: boolean): boolean {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setHandRaised === 'function') {
      return delegate.setHandRaised(raised)
    }
    return false
  }

  getModerationState(): ModerationState {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.getModerationState === 'function') {
      return delegate.getModerationState()
    }
    return {
      roomLocked: false,
      roomLockOwnerPeerId: null,
      localHandRaised: false,
      raisedHands: []
    }
  }

  setOnNetworkStatusChange(callback: (isOnline: boolean) => void): void {
    this.onNetworkStatusChange = callback
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.setOnNetworkStatusChange === 'function') {
      delegate.setOnNetworkStatusChange((isOnline) => {
        this.onNetworkStatusChange?.(isOnline)
        this.emit('networkStatus', { isOnline })
      })
    }
  }

  getNetworkStatus(): { isOnline: boolean; wasInRoomWhenOffline: boolean; reconnectAttempts: number } {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.getNetworkStatus === 'function') {
      return delegate.getNetworkStatus()
    }
    return {
      isOnline: true,
      wasInRoomWhenOffline: false,
      reconnectAttempts: 0
    }
  }

  manualReconnect(): Promise<boolean> {
    const delegate = this.delegate as unknown as Partial<SimplePeerManager>
    if (typeof delegate.manualReconnect === 'function') {
      return delegate.manualReconnect()
    }
    return Promise.resolve(false)
  }

  joinRoom(roomId: string, userName: string): Promise<void> {
    return this.delegate.joinRoom(roomId, userName)
  }

  leaveRoom(): void {
    this.delegate.leaveRoom()
  }
}

export const peerManager = new SimplePeerManagerFacade(legacyPeerManager)
