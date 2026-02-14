
import { SignalingLog, PeerLog } from '../utils/Logger'
import type {
  ConnectionQuality,
  RemoteMicControlMessage,
  ModerationControlMessage,
  ModerationState,
  AudioRoutingMode,
  RemoteMicStopReason
} from '@/types'
import type { PreviousStats } from './connectionStats'
import { configureOpusSdp } from './opus'
import {
  loadCredentials,
  resetCredentialsCacheForTesting,
  getIceServers
} from './services/credentials'
import { MessageDeduplicator, MQTTClient, MultiBrokerMQTT } from './services/mqttTransport'
import {
  applyModerationControlMessage,
  applyRemoteMicControlMessage,
  buildModerationState,
  createControlState,
  getControlDebugInfo,
  handleModerationPeerDisconnect,
  handleRemoteMicPeerDisconnect,
  isModerationControlMessage,
  isRemoteMicControlMessage,
  parseRoomLockSignalPayload,
  parseRoomLockedSignalPayload,
  resetControlState,
  type ControlState
} from './services/controlState'
import {
  createNetworkReconnectState,
  getNetworkStatusSnapshot,
  resetNetworkReconnectState,
  setNetworkOffline,
  setNetworkOnline,
  triggerManualReconnect,
  type NetworkReconnectState
} from './services/networkReconnect'
import {
  attemptSimplePeerManagerReconnect,
  performSimplePeerManagerReconnectAttempt,
  restartPeerDiscoveryWithAdapter
} from './services/simplePeerManagerNetworkReconnect'
import {
  registerBeforeUnloadHandler,
  registerNetworkMonitoring
} from './services/browserLifecycle'
import {
  executeJoinRoomWorkflowWithAdapter,
  type JoinRoomWorkflowAdapter,
  prepareJoinRoomAttempt,
} from './services/joinRoom'
import {
  handleSignalingDispatchWithAdapter,
  type SignalingDispatchAdapter
} from './services/signalingDispatchHandlers'
import {
  broadcastSimplePeerManagerMessage,
  sendSimplePeerManagerMessageToPeer,
  sendSimplePeerManagerPong
} from './services/simplePeerManagerSignalingMessaging'
import {
  createOfferOperationWithAdapter,
  handleAnnounceOperationWithAdapter,
  handleAnswerOperationWithAdapter,
  handleIceCandidateOperationWithAdapter,
  handleOfferOperationWithAdapter,
  type SignalingOperationsAdapter
} from './services/signalingOperations'
import {
  handleModerationSignalWithAdapter,
  handlePeerMuteStatusWithAdapter,
  recordPeerActivityWithAdapter,
  updateSignalingStateWithAdapter
} from './services/signalingStateAdapter'
import {
  attemptIceRestartWithAdapter,
  type IceRestartAdapter
} from './services/iceRestart'
import { type PeerConnectionState } from './services/peerLifecycle'
import {
  runPeerCleanupFlowWithAdapter,
  type PeerCleanupRuntimeAdapter
} from './services/peerCleanupOrchestration'
import {
  createPeerConnectionWithAdapter,
  type PeerConnectionRuntimeAdapter
} from './services/peerConnectionOrchestration'
import {
  buildPeerManagerDebugInfo,
  buildPeerSnapshot,
  collectConnectionStatsForPeers
} from './services/peerIntrospection'
import {
  clearAnnounceTimers,
  clearManagedHeartbeatLoop,
  countHealthyPeerConnections,
  scheduleBroadcastAnnounceWithAdapter,
  startManagedAnnounceLoopWithAdapter,
  startManagedHeartbeatLoopWithAdapter
} from './services/roomRuntime'
import {
  type LeaveRoomWorkflowAdapter,
  executeLeaveRoomWorkflowWithAdapter,
  sendBestEffortLeaveSignal
} from './services/leaveRoom'
import {
  applyAudioRoutingToPeer,
  replaceTrackAcrossPeers,
  resolveRoutedAudioTrackForPeer,
  syncLocalStreamToPeers,
  updateAudioRoutingMode
} from './services/mediaRouting'
import {
  broadcastControlMessageToPeers,
  sendControlMessageToPeer,
  setupDataChannelHandlers
} from './services/dataChannelControl'
import {
  broadcastChatMessageToPeers,
  broadcastMuteStatusToPeers,
  getAllPeerMuteStatusSnapshots,
  getPeerMuteStatusSnapshot
} from './services/peerMessaging'
import {
  requestMuteAllWithAdapter,
  respondMuteAllRequestWithAdapter,
  respondRemoteMicRequestWithAdapter,
  sendRemoteMicHeartbeatWithAdapter,
  sendRemoteMicRequestWithAdapter,
  sendRemoteMicStartWithAdapter,
  sendRemoteMicStopWithAdapter,
  setHandRaisedWithAdapter,
  setRoomLockedWithAdapter,
  stopRemoteMicSessionCommand,
  type ModerationRemoteMicAdapter
} from './services/moderationRemoteMicCommands'
import { installLegacyStateAccessors } from './services/simplePeerManagerLegacyState'
import type {
  ChatMessageCallback,
  ErrorCallback,
  ModerationControlCallback,
  MuteStatus,
  MuteStatusCallback,
  PeerEventCallback,
  RemoteMicControlCallback,
  SignalMessage,
  SignalingState,
  StreamCallback
} from './simplePeerManagerTypes'

export { loadCredentials, resetCredentialsCacheForTesting }
export { MessageDeduplicator, MQTTClient, MultiBrokerMQTT }
export type { SignalingState } from './simplePeerManagerTypes'

// Generate a random peer ID
export const generatePeerId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Self ID for this client
export const selfId = generatePeerId()

// Timing constants
const ANNOUNCE_INTERVAL = 3000
const ANNOUNCE_DURATION = 60000
const MAX_ICE_RESTART_ATTEMPTS = 3
const ICE_RESTART_DELAY = 2000
const ICE_DISCONNECT_GRACE_PERIOD = 5000  // Wait this long before triggering ICE restart
const ICE_FAILED_TIMEOUT = 15000  // How long to wait for ICE restart before giving up
const ANNOUNCE_DEBOUNCE = 100
const HEARTBEAT_INTERVAL = 5000
const HEARTBEAT_TIMEOUT = 15000

type PeerConnection = PeerConnectionState

function generateMessageId(): string {
  return `${selfId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

export class SimplePeerManager {
  private roomId: string | null = null
  private userName: string = ''
  private localPlatform: 'win' | 'mac' | 'linux' = 'win'  // Default to win, set properly on init
  private mqtt: MultiBrokerMQTT | null = null
  private topic: string = ''
  private peers: Map<string, PeerConnection> = new Map()
  private localStream: MediaStream | null = null
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map()
  private broadcastChannel: BroadcastChannel | null = null
  private announceInterval: NodeJS.Timeout | null = null
  private announceStartTime: number = 0
  private localMuteStatus: MuteStatus = { micMuted: false, speakerMuted: false, videoMuted: false, videoEnabled: true }
  private heartbeatInterval: NodeJS.Timeout | null = null
  private peerLastSeen: Map<string, number> = new Map()
  private peerLastPing: Map<string, number> = new Map()

  // Session tracking to prevent stale messages after rejoin
  private sessionId: number = 0

  // Guards against concurrent join/leave operations
  private isJoining: boolean = false
  private isLeaving: boolean = false

  // Debounce timer for announce messages
  private announceDebounceTimer: NodeJS.Timeout | null = null

  // Signaling state tracking
  private signalingState: SignalingState = 'idle'
  private onSignalingStateChange: ((state: SignalingState) => void) | null = null

  private onPeerJoin: PeerEventCallback = () => { }
  private onPeerLeave: PeerEventCallback = () => { }
  private onRemoteStream: StreamCallback = () => { }
  private onError: ErrorCallback = () => { }
  private onPeerMuteChange: MuteStatusCallback = () => { }
  private onChatMessage: ChatMessageCallback = null
  private onRemoteMicControl: RemoteMicControlCallback | null = null
  private onModerationControl: ModerationControlCallback | null = null

  // Remote microphone + moderation state (kept behind accessors for compatibility).
  private controlState: ControlState = createControlState()

  private audioRoutingMode: AudioRoutingMode = 'broadcast'
  private audioRoutingTargetPeerId: string | null = null

  // Network status monitoring for auto-reconnect
  private networkState: NetworkReconnectState = createNetworkReconnectState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  private onNetworkStatusChange: ((isOnline: boolean) => void) | null = null
  private readonly NETWORK_RECONNECT_MAX_ATTEMPTS = 5
  private readonly NETWORK_RECONNECT_BASE_DELAY = 2000

  constructor() {
    SignalingLog.info('SimplePeerManager initialized', { selfId })
    installLegacyStateAccessors({
      target: this,
      getControlState: () => this.controlState,
      getNetworkState: () => this.networkState
    })
    this.touchLegacyControlAccessors()
    this.setupNetworkMonitoring()
    this.setupUnloadHandler()
  }

  // Preserve legacy private accessors used by compatibility tests during refactor migration.
  private touchLegacyControlAccessors() {
    const refs = [
      this.pendingCandidates, this.onPeerJoin, this.onPeerLeave, this.onRemoteStream, this.setupDataChannel, this.broadcastControlMessage,
      this.recordPeerActivity, this.handleMuteStatus, this.handleRoomLockMessage, this.handleRoomLockedMessage, this.handleAnnounce,
      this.configureOpusCodec, this.createOffer, this.handleOffer, this.handleAnswer, this.handleIceCandidate, this.handlePeerLeave,
      this.createPeerConnection, this.startHeartbeat, this.stopHeartbeat, this.sendPong, this.onRemoteMicPeerDisconnect,
      this.onModerationPeerDisconnect, this.onRestartPeerDiscovery, this.performControlStateReset, this.performNetworkReconnectReset
    ]
    void refs
  }

  private setupNetworkMonitoring() {
    registerNetworkMonitoring({
      target: typeof window === 'undefined' ? null : window,
      onOnline: this.handleOnline,
      onOffline: this.handleOffline,
      getIsOnline: () => typeof navigator !== 'undefined' ? navigator.onLine : true
    })
  }

  private setupUnloadHandler() {
    registerBeforeUnloadHandler({
      target: typeof window === 'undefined' ? null : window,
      onBeforeUnload: this.handleBeforeUnload
    })
  }

  private handleBeforeUnload = () => {
    this.sendLeaveSignal()
  }

  private handleOnline = () => {
    setNetworkOnline({
      state: this.networkState,
      roomId: this.roomId,
      userName: this.userName,
      onNetworkStatusChange: this.onNetworkStatusChange || undefined,
      requestReconnect: () => {
        void this.attemptNetworkReconnect()
      }
    })
  }

  private handleOffline = () => {
    setNetworkOffline({
      state: this.networkState,
      roomId: this.roomId,
      onNetworkStatusChange: this.onNetworkStatusChange || undefined
    })
  }

  private async attemptNetworkReconnect() {
    await attemptSimplePeerManagerReconnect({
      state: this.networkState,
      getRoomId: () => this.roomId,
      maxAttempts: this.NETWORK_RECONNECT_MAX_ATTEMPTS,
      baseDelay: this.NETWORK_RECONNECT_BASE_DELAY,
      performReconnectAttempt: async () => this.performNetworkReconnectAttempt(),
      onReconnectSuccess: () => {
        this.updateSignalingState('connected')
      },
      onReconnectFailure: (error) => {
        this.onError(error, 'network-reconnect')
      }
    })
  }

  private async performNetworkReconnectAttempt(): Promise<boolean> {
    return performSimplePeerManagerReconnectAttempt({
      mqtt: this.mqtt,
      topic: this.topic,
      peers: this.peers,
      onSignalMessage: (data) => this.handleSignalingMessage(data as SignalMessage),
      onRestartPeerDiscovery: () => {
        restartPeerDiscoveryWithAdapter({
          setAnnounceStartTime: (value) => {
            this.announceStartTime = value
          },
          broadcastAnnounce: () => this.broadcastAnnounce(),
          startAnnounceInterval: () => this.startAnnounceInterval()
        })
      },
      onAttemptIceRestart: (peerId) => {
        void this.attemptIceRestart(peerId)
      }
    })
  }

  setOnNetworkStatusChange(callback: (isOnline: boolean) => void) {
    this.onNetworkStatusChange = callback
  }

  getNetworkStatus(): { isOnline: boolean; wasInRoomWhenOffline: boolean; reconnectAttempts: number } {
    return getNetworkStatusSnapshot(this.networkState)
  }

  async manualReconnect(): Promise<boolean> {
    return triggerManualReconnect({
      roomId: this.roomId,
      setAttempts: (attempts) => {
        this.networkState.networkReconnectAttempts = attempts
      },
      setWasInRoomWhenOffline: (value) => {
        this.networkState.wasInRoomWhenOffline = value
      },
      attemptReconnect: async () => this.attemptNetworkReconnect()
    })
  }

  setOnSignalingStateChange(callback: (state: SignalingState) => void) {
    this.onSignalingStateChange = callback
  }

  private updateSignalingState(state: SignalingState) {
    updateSignalingStateWithAdapter({
      currentState: this.signalingState,
      nextState: state,
      setState: (nextState) => {
        this.signalingState = nextState
      },
      onStateChange: this.onSignalingStateChange || undefined
    })
  }

  getSignalingState(): SignalingState {
    return this.signalingState
  }

  setCallbacks(callbacks: {
    onPeerJoin?: PeerEventCallback
    onPeerLeave?: PeerEventCallback
    onRemoteStream?: StreamCallback
    onError?: ErrorCallback
    onPeerMuteChange?: MuteStatusCallback
  }) {
    if (callbacks.onPeerJoin) this.onPeerJoin = callbacks.onPeerJoin; if (callbacks.onPeerLeave) this.onPeerLeave = callbacks.onPeerLeave
    if (callbacks.onRemoteStream) this.onRemoteStream = callbacks.onRemoteStream; if (callbacks.onError) this.onError = callbacks.onError
    if (callbacks.onPeerMuteChange) this.onPeerMuteChange = callbacks.onPeerMuteChange
  }

  setLocalStream(stream: MediaStream) {
    SignalingLog.info('Setting local stream', { streamId: stream.id, trackCount: stream.getTracks().length })
    this.localStream = stream

    syncLocalStreamToPeers({
      stream,
      peers: this.peers,
      getRoutedAudioTrackForPeer: (peerId, fallbackTrack) => this.getRoutedAudioTrackForPeer(peerId, fallbackTrack),
      audioRoutingMode: this.audioRoutingMode
    })
  }

  private getRoutedAudioTrackForPeer(peerId: string, fallbackTrack?: MediaStreamTrack): MediaStreamTrack | null {
    return resolveRoutedAudioTrackForPeer({
      peerId,
      fallbackTrack,
      localStream: this.localStream,
      audioRoutingMode: this.audioRoutingMode,
      audioRoutingTargetPeerId: this.audioRoutingTargetPeerId
    })
  }

  private applyAudioRoutingToPeer(peerId: string) {
    applyAudioRoutingToPeer({
      peerId,
      peers: this.peers,
      localStream: this.localStream,
      getRoutedAudioTrackForPeer: (id, fallbackTrack) => this.getRoutedAudioTrackForPeer(id, fallbackTrack),
      audioRoutingMode: this.audioRoutingMode
    })
  }

  private applyAudioRouting() {
    this.peers.forEach((_peer, peerId) => this.applyAudioRoutingToPeer(peerId))
  }

  setAudioRoutingMode(mode: AudioRoutingMode, targetPeerId?: string): boolean {
    return updateAudioRoutingMode({
      mode,
      targetPeerId,
      peers: this.peers as unknown as Map<string, unknown>,
      setAudioRoutingState: (nextMode, nextTargetPeerId) => {
        this.audioRoutingMode = nextMode
        this.audioRoutingTargetPeerId = nextTargetPeerId
      },
      applyAudioRouting: () => {
        this.applyAudioRouting()
      }
    })
  }

  broadcastMuteStatus(micMuted: boolean, speakerMuted: boolean, videoEnabled: boolean = true, isScreenSharing: boolean = false) {
    broadcastMuteStatusToPeers<MuteStatus>({
      micMuted,
      speakerMuted,
      videoEnabled,
      isScreenSharing,
      peers: this.peers,
      setLocalMuteStatus: (status) => {
        this.localMuteStatus = status
      },
      broadcastSignal: (data) => {
        this.broadcast({
          v: 1,
          type: 'mute-status',
          from: selfId,
          data,
          sessionId: this.sessionId,
          msgId: generateMessageId()
        })
      }
    })
  }

  getPeerMuteStatus(peerId: string): MuteStatus {
    return getPeerMuteStatusSnapshot<MuteStatus>({
      peerId,
      peers: this.peers,
      fallbackMuteStatus: { micMuted: false, speakerMuted: false, videoMuted: false, videoEnabled: true }
    })
  }

  getAllPeerMuteStatuses(): Map<string, MuteStatus> {
    return getAllPeerMuteStatusSnapshots(this.peers)
  }

  private setupDataChannel(
    dc: RTCDataChannel,
    peerId: string,
    peerConn: PeerConnection,
    channelType: 'chat' | 'control'
  ) {
    setupDataChannelHandlers({
      dc, peerId, peerConn, channelType,
      onChatMessage: this.onChatMessage || undefined,
      isRemoteMicControlMessage, isModerationControlMessage,
      onRemoteMicControl: (id, message) => this.handleRemoteMicControlMessage(id, message),
      onModerationControl: (id, message) => this.handleModerationControlMessage(id, message)
    })
  }

  private handleRemoteMicControlMessage(peerId: string, message: RemoteMicControlMessage) {
    applyRemoteMicControlMessage(this.controlState, peerId, message, { onRemoteMicControl: this.onRemoteMicControl || undefined, resetAudioRoutingToBroadcast: () => { this.setAudioRoutingMode('broadcast') } })
  }

  private sendControlMessage(peerId: string, message: RemoteMicControlMessage | ModerationControlMessage): boolean {
    return sendControlMessageToPeer({
      peerId,
      message,
      peer: this.peers.get(peerId)
    })
  }

  setOnChatMessage(callback: ChatMessageCallback) {
    this.onChatMessage = callback
  }

  setOnRemoteMicControl(callback: RemoteMicControlCallback | null) {
    this.onRemoteMicControl = callback
  }

  setOnModerationControl(callback: ModerationControlCallback | null) {
    this.onModerationControl = callback
  }

  private broadcastControlMessage(message: ModerationControlMessage): number {
    return broadcastControlMessageToPeers({
      peerIds: this.peers.keys(),
      sendToPeer: (peerId) => this.sendControlMessage(peerId, message)
    })
  }

  private handleModerationControlMessage(peerId: string, message: ModerationControlMessage) {
    applyModerationControlMessage(this.controlState, peerId, message, {
      onModerationControl: this.onModerationControl || undefined
    })
  }

  setRoomLocked(locked: boolean): boolean {
    return setRoomLockedWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, locked, createMessageId: generateMessageId })
  }

  requestMuteAll(reason: string = 'host-request'): string | null {
    return requestMuteAllWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, reason, createMessageId: generateMessageId })
  }

  respondMuteAllRequest(peerId: string, requestId: string, accepted: boolean): boolean {
    return respondMuteAllRequestWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, peerId, requestId, accepted, createMessageId: generateMessageId })
  }

  setHandRaised(raised: boolean): boolean {
    return setHandRaisedWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, raised, createMessageId: generateMessageId })
  }

  sendRemoteMicRequest(targetPeerId: string): string | null {
    return sendRemoteMicRequestWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, targetPeerId, createMessageId: generateMessageId })
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
    return respondRemoteMicRequestWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, requestId, accepted, reason, createMessageId: generateMessageId })
  }

  sendRemoteMicStart(peerId: string, requestId: string): boolean {
    return sendRemoteMicStartWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, peerId, requestId, createMessageId: generateMessageId })
  }

  sendRemoteMicHeartbeat(peerId: string, requestId: string): boolean {
    return sendRemoteMicHeartbeatWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, peerId, requestId, createMessageId: generateMessageId })
  }

  sendRemoteMicStop(peerId: string, requestId: string, reason: RemoteMicStopReason = 'unknown'): boolean {
    return sendRemoteMicStopWithAdapter({ adapter: this as unknown as ModerationRemoteMicAdapter, selfId, peerId, requestId, reason, createMessageId: generateMessageId })
  }

  stopRemoteMicSession(reason: RemoteMicStopReason = 'unknown') {
    stopRemoteMicSessionCommand({ reason, controlState: this.controlState, sendRemoteMicStop: (peerId, requestId, stopReason) => this.sendRemoteMicStop(peerId, requestId, stopReason), resetAudioRoutingToBroadcast: () => this.setAudioRoutingMode('broadcast') })
  }

  sendChatMessage(content: string, senderName: string) {
    broadcastChatMessageToPeers({
      content,
      senderName,
      senderId: selfId,
      peers: this.peers,
      createMessageId: generateMessageId
    })
  }

  async joinRoom(roomId: string, userName: string): Promise<void> {
    if (this.isJoining) { SignalingLog.warn('Join already in progress, ignoring'); return }
    this.isJoining = true
    await prepareJoinRoomAttempt({ hasActiveRoom: Boolean(this.roomId), leaveRoom: () => this.leaveRoom() })
    this.sessionId++
    const currentSession = this.sessionId
    try {
      await executeJoinRoomWorkflowWithAdapter({ roomId, userName, selfId, currentSession, userAgent: navigator.userAgent, loadCredentials, resetControlState: () => this.performControlStateReset(), adapter: this as unknown as JoinRoomWorkflowAdapter })
    } finally {
      this.isJoining = false
    }
  }

  private broadcastAnnounce() {
    this.announceDebounceTimer = scheduleBroadcastAnnounceWithAdapter<SignalMessage>({ announceDebounceTimer: this.announceDebounceTimer, announceDebounceMs: ANNOUNCE_DEBOUNCE, createAnnounceMessage: (ts) => ({ v: 1, type: 'announce', from: selfId, userName: this.userName, platform: this.localPlatform, ts, sessionId: this.sessionId, msgId: generateMessageId() }), getPeerCount: () => this.peers.size, broadcast: (message) => this.broadcast(message), onTimerCleared: () => { this.announceDebounceTimer = null } })
  }

  // Only count peers that have a healthy connection
  private getHealthyPeerCount(): number {
    return countHealthyPeerConnections(this.peers)
  }

  private startAnnounceInterval() {
    const next = startManagedAnnounceLoopWithAdapter({ announceStartTime: this.announceStartTime, announceInterval: this.announceInterval, announceDebounceTimer: this.announceDebounceTimer, announceIntervalMs: ANNOUNCE_INTERVAL, announceDurationMs: ANNOUNCE_DURATION, getHealthyPeerCount: () => this.getHealthyPeerCount(), onStop: () => this.stopAnnounceInterval(), onReannounce: () => this.broadcastAnnounce(), now: () => Date.now() })
    this.announceInterval = next.announceInterval
    this.announceDebounceTimer = next.announceDebounceTimer
  }

  private stopAnnounceInterval() {
    const next = clearAnnounceTimers({ announceInterval: this.announceInterval, announceDebounceTimer: this.announceDebounceTimer })
    this.announceInterval = next.announceInterval
    this.announceDebounceTimer = next.announceDebounceTimer
  }

  private startHeartbeat() {
    this.heartbeatInterval = startManagedHeartbeatLoopWithAdapter({ heartbeatInterval: this.heartbeatInterval, heartbeatIntervalMs: HEARTBEAT_INTERVAL, heartbeatTimeoutMs: HEARTBEAT_TIMEOUT, hasSignalingChannel: () => Boolean(this.mqtt?.isConnected() || this.broadcastChannel), getPeerIds: () => Array.from(this.peers.keys()), peerLastSeen: this.peerLastSeen, peerLastPing: this.peerLastPing, onPeerTimeout: (peerId, seenAt) => { PeerLog.warn('Peer heartbeat timeout, removing', { peerId, lastSeen: seenAt }); this.cleanupPeer(peerId) }, onPingPeer: (peerId) => { this.sendToPeer(peerId, { v: 1, type: 'ping', from: selfId }) }, now: () => Date.now() })
  }

  private stopHeartbeat() {
    this.heartbeatInterval = clearManagedHeartbeatLoop(this.heartbeatInterval)
  }

  private broadcast(message: SignalMessage) {
    broadcastSimplePeerManagerMessage({
      message,
      topic: this.topic,
      mqtt: this.mqtt,
      broadcastChannel: this.broadcastChannel,
      createMessageId: generateMessageId
    })
  }

  private sendToPeer(peerId: string, message: SignalMessage) {
    sendSimplePeerManagerMessageToPeer({
      peerId,
      message,
      sessionId: this.sessionId,
      createMessageId: generateMessageId,
      broadcastMessage: (nextMessage) => this.broadcast(nextMessage)
    })
  }

  private sendPong(peerId: string) {
    sendSimplePeerManagerPong({
      peerId,
      selfId,
      sendToPeer: (id, message) => {
        this.sendToPeer(id, message)
      }
    })
  }

  private handleSignalingMessage(message: SignalMessage) {
    handleSignalingDispatchWithAdapter({ selfId, message, adapter: this as unknown as SignalingDispatchAdapter })
  }

  private recordPeerActivity(peerId: string) {
    recordPeerActivityWithAdapter({
      peerId,
      peerLastSeen: this.peerLastSeen,
      peerLastPing: this.peerLastPing
    })
  }

  private handleMuteStatus(peerId: string, data: unknown) {
    handlePeerMuteStatusWithAdapter({
      peerId,
      data,
      peers: this.peers,
      onPeerMuteChange: (id, muteStatus) => {
        this.onPeerMuteChange(id, muteStatus)
      }
    })
  }

  private handleRoomLockMessage(peerId: string, data: any) {
    handleModerationSignalWithAdapter({
      peerId,
      data,
      parsePayload: parseRoomLockSignalPayload,
      invalidPayloadLog: 'Invalid room-lock signaling payload',
      onModerationMessage: (id, message) => {
        this.handleModerationControlMessage(id, message)
      }
    })
  }

  private handleRoomLockedMessage(peerId: string, data: any) {
    handleModerationSignalWithAdapter({
      peerId,
      data,
      parsePayload: parseRoomLockedSignalPayload,
      invalidPayloadLog: 'Invalid room-locked signaling payload',
      onModerationMessage: (id, message) => {
        this.handleModerationControlMessage(id, message)
      }
    })
  }

  private async handleAnnounce(peerId: string, userName: string, platform: 'win' | 'mac' | 'linux') {
    await handleAnnounceOperationWithAdapter({ adapter: this as unknown as SignalingOperationsAdapter, peerId, userName, platform, selfId, now: () => Date.now() })
  }

  private configureOpusCodec(sdp: string): string {
    return configureOpusSdp(sdp)
  }

  private async createOffer(peerId: string, userName: string, platform: 'win' | 'mac' | 'linux') {
    await createOfferOperationWithAdapter({ adapter: this as unknown as SignalingOperationsAdapter, peerId, userName, platform, selfId })
  }

  private async handleOffer(peerId: string, offer: RTCSessionDescriptionInit, userName: string, platform: 'win' | 'mac' | 'linux') {
    await handleOfferOperationWithAdapter({ adapter: this as unknown as SignalingOperationsAdapter, peerId, offer, userName, platform, selfId })
  }

  private async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit) {
    await handleAnswerOperationWithAdapter({ adapter: this as unknown as SignalingOperationsAdapter, peerId, answer })
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    await handleIceCandidateOperationWithAdapter({ adapter: this as unknown as SignalingOperationsAdapter, peerId, candidate })
  }

  private handlePeerLeave(peerId: string) {
    const peer = this.peers.get(peerId)
    if (peer) {
      PeerLog.info('Peer leaving (via leave message)', { peerId })
      this.cleanupPeer(peerId)
    }
  }

  private createPeerConnection(peerId: string, userName: string, platform: 'win' | 'mac' | 'linux', isInitiator: boolean = false): RTCPeerConnection {
    return createPeerConnectionWithAdapter({ adapter: this as unknown as PeerConnectionRuntimeAdapter, peerId, userName, platform, isInitiator, selfId, iceServers: getIceServers(), disconnectGracePeriodMs: ICE_DISCONNECT_GRACE_PERIOD, now: () => Date.now() })
  }

  private cleanupPeer(peerId: string) {
    runPeerCleanupFlowWithAdapter({ peerId, adapter: this as unknown as PeerCleanupRuntimeAdapter<PreviousStats> })
  }

  private onRemoteMicPeerDisconnect(peerId: string) {
    this.handleRemoteMicPeerDisconnect(peerId)
  }

  private onModerationPeerDisconnect(peerId: string) {
    handleModerationPeerDisconnect(this.controlState, peerId, { onModerationControl: this.onModerationControl || undefined })
  }

  private onRestartPeerDiscovery() {
    this.announceStartTime = Date.now()
    this.broadcastAnnounce()
    this.startAnnounceInterval()
  }

  private handleRemoteMicPeerDisconnect(peerId: string) {
    handleRemoteMicPeerDisconnect(this.controlState, peerId, { onRemoteMicControl: this.onRemoteMicControl || undefined, resetAudioRoutingToBroadcast: () => { this.setAudioRoutingMode('broadcast') }, createRequestId: generateMessageId, now: () => Date.now() })
  }

  private async attemptIceRestart(peerId: string) {
    await attemptIceRestartWithAdapter({ peerId, selfId, adapter: this as unknown as IceRestartAdapter, maxAttempts: MAX_ICE_RESTART_ATTEMPTS, restartDelay: ICE_RESTART_DELAY, failedTimeout: ICE_FAILED_TIMEOUT })
  }

  private performControlStateReset() {
    resetControlState(this.controlState)
  }

  private performNetworkReconnectReset() {
    resetNetworkReconnectState(this.networkState)
  }

  leaveRoom() {
    executeLeaveRoomWorkflowWithAdapter(this as unknown as LeaveRoomWorkflowAdapter<PreviousStats>)
  }

  private sendLeaveSignal() {
    sendBestEffortLeaveSignal({
      roomId: this.roomId,
      sessionId: this.sessionId,
      selfId,
      broadcast: (message) => this.broadcast(message)
    })
  }

  getPeers(): Map<string, { userName: string; stream: MediaStream | null; muteStatus: MuteStatus }> {
    return buildPeerSnapshot(this.peers)
  }

  replaceTrack(newTrack: MediaStreamTrack) {
    replaceTrackAcrossPeers({
      newTrack,
      peers: this.peers,
      getRoutedAudioTrackForPeer: (peerId, fallbackTrack) => this.getRoutedAudioTrackForPeer(peerId, fallbackTrack),
      localStream: this.localStream,
      audioRoutingMode: this.audioRoutingMode
    })
  }

  // Track previous stats for calculating deltas (packet loss rate)
  private previousStats: Map<string, PreviousStats> = new Map()

  async getConnectionStats(): Promise<Map<string, ConnectionQuality>> {
    return collectConnectionStatsForPeers({
      peers: this.peers,
      previousStats: this.previousStats,
      onStatsError: (peerId, error) => {
        PeerLog.warn('Failed to get stats for peer', { peerId, error: String(error) })
      },
      now: () => Date.now()
    })
  }

  getModerationState(): ModerationState {
    return buildModerationState(this.controlState)
  }

  getDebugInfo(): object {
    return buildPeerManagerDebugInfo({
      selfId,
      roomId: this.roomId,
      userName: this.userName,
      topic: this.topic,
      sessionId: this.sessionId,
      signalingState: this.signalingState,
      mqtt: this.mqtt,
      peers: this.peers,
      localMuteStatus: this.localMuteStatus,
      audioRoutingMode: this.audioRoutingMode,
      audioRoutingTargetPeerId: this.audioRoutingTargetPeerId,
      controlDebugInfo: getControlDebugInfo(this.controlState),
      isJoining: this.isJoining,
      isLeaving: this.isLeaving,
      networkOnline: this.networkState.isOnline,
      networkWasInRoomWhenOffline: this.networkState.wasInRoomWhenOffline,
      networkReconnectAttempts: this.networkState.networkReconnectAttempts
    })
  }
}

export const peerManager = new SimplePeerManager()
