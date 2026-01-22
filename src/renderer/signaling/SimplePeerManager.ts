/**
 * SimplePeerManager - Browser-compatible WebRTC P2P implementation
 * Uses MQTT over WebSocket with proper keepalive and trickle ICE
 */

import { SignalingLog, PeerLog } from '../utils/Logger'

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

// ICE servers for NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
]

// Timing constants
const ANNOUNCE_INTERVAL = 3000
const ANNOUNCE_DURATION = 60000
const MQTT_KEEPALIVE = 20000
const MAX_ICE_RESTART_ATTEMPTS = 2
const ICE_RESTART_DELAY = 2000

interface SignalMessage {
  v: number
  type: 'announce' | 'offer' | 'answer' | 'ice-candidate' | 'leave' | 'ping' | 'pong' | 'mute-status'
  from: string
  to?: string
  data?: any
  userName?: string
  ts?: number
}

interface MuteStatus {
  micMuted: boolean
  speakerMuted: boolean
}

interface PeerConnection {
  pc: RTCPeerConnection
  stream: MediaStream | null
  userName: string
  connectionStartTime: number
  isConnected: boolean
  muteStatus: MuteStatus
  iceRestartAttempts: number
}

type PeerEventCallback = (peerId: string, userName: string) => void
type StreamCallback = (peerId: string, stream: MediaStream) => void
type ErrorCallback = (error: Error, context: string) => void
type MuteStatusCallback = (peerId: string, muteStatus: MuteStatus) => void

// MQTT broker URLs - will try in order until one connects
const MQTT_BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081'
]

/**
 * Robust MQTT client with keepalive and proper buffer handling
 */
class MQTTClient {
  private ws: WebSocket | null = null
  private connected = false
  private subscribed = false
  private messageId = 1
  private clientId: string
  private topic: string = ''
  private onMessage: ((payload: string) => void) | null = null
  private buffer: Uint8Array = new Uint8Array(0)
  private keepaliveInterval: NodeJS.Timeout | null = null
  private pendingSubscribe: { resolve: () => void; reject: (err: Error) => void } | null = null
  private subscribeTimeout: NodeJS.Timeout | null = null
  private messageCount = 0
  private currentBrokerUrl: string = ''

  constructor() {
    this.clientId = 'p2p_' + selfId.substring(0, 8) + '_' + Math.random().toString(36).substring(2, 6)
  }

  /**
   * Try to connect to MQTT brokers in order until one succeeds
   */
  async connectWithFallback(): Promise<string> {
    for (const brokerUrl of MQTT_BROKERS) {
      try {
        SignalingLog.info('Trying MQTT broker', { url: brokerUrl })
        await this.connect(brokerUrl)
        this.currentBrokerUrl = brokerUrl
        SignalingLog.info('Connected to MQTT broker', { url: brokerUrl })
        return brokerUrl
      } catch (err) {
        SignalingLog.warn('MQTT broker failed, trying next', { url: brokerUrl, error: String(err) })
      }
    }
    throw new Error('All MQTT brokers failed to connect')
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, 'mqtt')
        this.ws.binaryType = 'arraybuffer'
        this.buffer = new Uint8Array(0)
        
        const timeout = setTimeout(() => {
          reject(new Error('MQTT connection timeout'))
        }, 10000)

        this.ws.onopen = () => {
          this.sendConnect()
        }

        this.ws.onmessage = (event) => {
          this.appendToBuffer(new Uint8Array(event.data))
          this.processBuffer()
          
          if (!this.connected) {
            this.connected = true
            clearTimeout(timeout)
            this.startKeepalive()
            resolve()
          }
        }

        this.ws.onerror = () => {
          clearTimeout(timeout)
          this.connected = false
          this.stopKeepalive()
          reject(new Error('MQTT WebSocket error'))
        }

        this.ws.onclose = () => {
          this.connected = false
          this.stopKeepalive()
          SignalingLog.warn('MQTT connection closed')
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  private startKeepalive() {
    this.stopKeepalive()
    this.keepaliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(new Uint8Array([0xC0, 0x00]))
      }
    }, MQTT_KEEPALIVE)
  }

  private stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
    }
  }

  private appendToBuffer(data: Uint8Array) {
    const newBuffer = new Uint8Array(this.buffer.length + data.length)
    newBuffer.set(this.buffer)
    newBuffer.set(data, this.buffer.length)
    this.buffer = newBuffer
  }

  private processBuffer() {
    while (this.buffer.length > 0) {
      const packet = this.tryReadPacket()
      if (!packet) break
      this.handlePacket(packet)
    }
  }

  private tryReadPacket(): Uint8Array | null {
    if (this.buffer.length < 2) return null
    
    let multiplier = 1
    let remainingLength = 0
    let idx = 1
    
    while (idx < this.buffer.length) {
      const byte = this.buffer[idx]
      remainingLength += (byte & 0x7F) * multiplier
      multiplier *= 128
      idx++
      
      if ((byte & 0x80) === 0) break
      if (idx > 4) {
        this.buffer = new Uint8Array(0)
        return null
      }
    }
    
    if (idx >= this.buffer.length) return null
    
    const totalLength = idx + remainingLength
    if (this.buffer.length < totalLength) return null
    
    const packet = this.buffer.slice(0, totalLength)
    this.buffer = this.buffer.slice(totalLength)
    return packet
  }

  private sendConnect() {
    const clientIdBytes = new TextEncoder().encode(this.clientId)
    const protocolName = new TextEncoder().encode('MQTT')
    
    const remainingLength = 10 + 2 + clientIdBytes.length
    const packet = new Uint8Array(2 + remainingLength)
    
    let i = 0
    packet[i++] = 0x10
    packet[i++] = remainingLength
    packet[i++] = 0
    packet[i++] = 4
    packet.set(protocolName, i)
    i += 4
    packet[i++] = 4
    packet[i++] = 2
    packet[i++] = 0
    packet[i++] = 30
    packet[i++] = (clientIdBytes.length >> 8) & 0xff
    packet[i++] = clientIdBytes.length & 0xff
    packet.set(clientIdBytes, i)
    
    this.ws?.send(packet)
  }

  async subscribe(topic: string, callback: (message: string) => void): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      SignalingLog.error('MQTT subscribe failed - WebSocket not ready', { 
        wsExists: !!this.ws, 
        readyState: this.ws?.readyState 
      })
      return false
    }
    
    this.topic = topic
    this.onMessage = callback
    this.subscribed = false
    
    const topicBytes = new TextEncoder().encode(topic)
    const remainingLength = 2 + 2 + topicBytes.length + 1
    const packet = new Uint8Array(2 + remainingLength)
    
    let i = 0
    packet[i++] = 0x82
    packet[i++] = remainingLength
    packet[i++] = (this.messageId >> 8) & 0xff
    packet[i++] = this.messageId++ & 0xff
    packet[i++] = (topicBytes.length >> 8) & 0xff
    packet[i++] = topicBytes.length & 0xff
    packet.set(topicBytes, i)
    i += topicBytes.length
    packet[i++] = 0
    
    SignalingLog.debug('Sending MQTT SUBSCRIBE', { topic, messageId: this.messageId - 1 })
    
    // Wait for SUBACK with timeout
    return new Promise((resolve) => {
      this.pendingSubscribe = { 
        resolve: () => resolve(true), 
        reject: () => resolve(false) 
      }
      
      // Set timeout for subscription confirmation
      this.subscribeTimeout = setTimeout(() => {
        if (!this.subscribed) {
          SignalingLog.warn('MQTT SUBACK timeout - subscription may have failed')
          this.pendingSubscribe?.reject(new Error('Subscription timeout'))
          this.pendingSubscribe = null
        }
      }, 5000)
      
      try {
        this.ws!.send(packet)
      } catch (err) {
        SignalingLog.error('MQTT subscribe send error', { error: String(err) })
        clearTimeout(this.subscribeTimeout)
        this.pendingSubscribe = null
        resolve(false)
      }
    })
  }

  publish(topic: string, message: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      SignalingLog.warn('MQTT publish failed - not connected')
      return false
    }
    
    const topicBytes = new TextEncoder().encode(topic)
    const messageBytes = new TextEncoder().encode(message)
    const remainingLength = 2 + topicBytes.length + messageBytes.length
    
    const lengthBytes: number[] = []
    let x = remainingLength
    do {
      let byte = x % 128
      x = Math.floor(x / 128)
      if (x > 0) byte |= 0x80
      lengthBytes.push(byte)
    } while (x > 0)
    
    const packet = new Uint8Array(1 + lengthBytes.length + remainingLength)
    
    let i = 0
    packet[i++] = 0x30
    for (const b of lengthBytes) {
      packet[i++] = b
    }
    packet[i++] = (topicBytes.length >> 8) & 0xff
    packet[i++] = topicBytes.length & 0xff
    packet.set(topicBytes, i)
    i += topicBytes.length
    packet.set(messageBytes, i)
    
    try {
      this.ws.send(packet)
      return true
    } catch (err) {
      SignalingLog.error('MQTT publish error', { error: String(err) })
      return false
    }
  }

  private handlePacket(data: Uint8Array) {
    const packetType = data[0] >> 4
    
    if (packetType === 2) {
      SignalingLog.debug('MQTT CONNACK received')
    } else if (packetType === 3) {
      // Check QoS from fixed header
      const qos = (data[0] & 0x06) >> 1
      
      let idx = 1
      let multiplier = 1
      let remainingLength = 0
      
      while (idx < data.length) {
        const byte = data[idx]
        remainingLength += (byte & 0x7F) * multiplier
        multiplier *= 128
        idx++
        if ((byte & 0x80) === 0) break
      }
      
      if (idx + 2 > data.length) {
        SignalingLog.warn('MQTT PUBLISH packet too short for topic length')
        return
      }
      
      const topicLen = (data[idx] << 8) | data[idx + 1]
      idx += 2
      
      if (idx + topicLen > data.length) {
        SignalingLog.warn('MQTT PUBLISH packet too short for topic')
        return
      }
      
      const receivedTopic = new TextDecoder().decode(data.slice(idx, idx + topicLen))
      idx += topicLen
      
      // Skip packet identifier for QoS > 0
      if (qos > 0) {
        idx += 2
      }
      
      const payloadBytes = data.slice(idx)
      const payload = new TextDecoder().decode(payloadBytes)
      
      this.messageCount++
      
      if (this.onMessage && payload.length > 0) {
        SignalingLog.debug('MQTT message received', { 
          topic: receivedTopic, 
          payloadLen: payload.length,
          totalReceived: this.messageCount
        })
        this.onMessage(payload)
      }
    } else if (packetType === 9) {
      this.subscribed = true
      SignalingLog.info('MQTT SUBACK received - subscription confirmed', { topic: this.topic })
      
      // Clear timeout and resolve pending subscribe
      if (this.subscribeTimeout) {
        clearTimeout(this.subscribeTimeout)
        this.subscribeTimeout = null
      }
      if (this.pendingSubscribe) {
        this.pendingSubscribe.resolve()
        this.pendingSubscribe = null
      }
    } else if (packetType === 13) {
      // PINGRESP - broker is alive
      SignalingLog.debug('MQTT PINGRESP received')
    }
  }

  disconnect() {
    this.stopKeepalive()
    if (this.subscribeTimeout) {
      clearTimeout(this.subscribeTimeout)
      this.subscribeTimeout = null
    }
    this.pendingSubscribe = null
    if (this.ws) {
      try {
        this.ws.send(new Uint8Array([0xe0, 0x00]))
      } catch {}
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.subscribed = false
    this.onMessage = null
    this.messageCount = 0
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  isSubscribed(): boolean {
    return this.subscribed
  }

  getMessageCount(): number {
    return this.messageCount
  }
}

export class SimplePeerManager {
  private roomId: string | null = null
  private userName: string = ''
  private mqtt: MQTTClient | null = null
  private topic: string = ''
  private peers: Map<string, PeerConnection> = new Map()
  private localStream: MediaStream | null = null
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map()
  private broadcastChannel: BroadcastChannel | null = null
  private announceInterval: NodeJS.Timeout | null = null
  private announceStartTime: number = 0
  private localMuteStatus: MuteStatus = { micMuted: false, speakerMuted: false }
  
  private onPeerJoin: PeerEventCallback = () => {}
  private onPeerLeave: PeerEventCallback = () => {}
  private onRemoteStream: StreamCallback = () => {}
  private onError: ErrorCallback = () => {}
  private onPeerMuteChange: MuteStatusCallback = () => {}
  
  constructor() {
    SignalingLog.info('SimplePeerManager initialized', { selfId })
  }

  setCallbacks(callbacks: {
    onPeerJoin?: PeerEventCallback
    onPeerLeave?: PeerEventCallback
    onRemoteStream?: StreamCallback
    onError?: ErrorCallback
    onPeerMuteChange?: MuteStatusCallback
  }) {
    if (callbacks.onPeerJoin) this.onPeerJoin = callbacks.onPeerJoin
    if (callbacks.onPeerLeave) this.onPeerLeave = callbacks.onPeerLeave
    if (callbacks.onRemoteStream) this.onRemoteStream = callbacks.onRemoteStream
    if (callbacks.onError) this.onError = callbacks.onError
    if (callbacks.onPeerMuteChange) this.onPeerMuteChange = callbacks.onPeerMuteChange
  }

  setLocalStream(stream: MediaStream) {
    SignalingLog.info('Setting local stream', { streamId: stream.id, trackCount: stream.getTracks().length })
    this.localStream = stream
    
    this.peers.forEach((peer, peerId) => {
      const senders = peer.pc.getSenders()
      if (senders.length === 0 && this.localStream) {
        this.localStream.getTracks().forEach(track => {
          peer.pc.addTrack(track, this.localStream!)
        })
      }
    })
  }

  /**
   * Broadcast local mute status to all peers
   */
  broadcastMuteStatus(micMuted: boolean, speakerMuted: boolean) {
    this.localMuteStatus = { micMuted, speakerMuted }
    
    if (this.peers.size === 0) return
    
    SignalingLog.debug('Broadcasting mute status', { micMuted, speakerMuted })
    this.broadcast({
      v: 1,
      type: 'mute-status',
      from: selfId,
      data: { micMuted, speakerMuted }
    })
  }

  /**
   * Get mute status of a specific peer
   */
  getPeerMuteStatus(peerId: string): MuteStatus {
    return this.peers.get(peerId)?.muteStatus ?? { micMuted: false, speakerMuted: false }
  }

  /**
   * Get all peer mute statuses
   */
  getAllPeerMuteStatuses(): Map<string, MuteStatus> {
    const result = new Map<string, MuteStatus>()
    this.peers.forEach((peer, id) => {
      result.set(id, peer.muteStatus)
    })
    return result
  }

  async joinRoom(roomId: string, userName: string): Promise<void> {
    this.roomId = roomId
    this.userName = userName
    this.announceStartTime = Date.now()
    this.topic = `p2p-conf/${roomId}`
    
    SignalingLog.info('Joining room', { roomId, userName, selfId, topic: this.topic })
    
    try {
      this.broadcastChannel = new BroadcastChannel(`p2p-${roomId}`)
      this.broadcastChannel.onmessage = (event) => {
        this.handleSignalingMessage(event.data)
      }
      SignalingLog.debug('BroadcastChannel connected')
    } catch (err) {
      SignalingLog.warn('BroadcastChannel not available')
    }
    
    // Try MQTT connection with fallback brokers
    let mqttConnected = false
    
    try {
      SignalingLog.info('Starting MQTT connection with fallback brokers')
      
      this.mqtt = new MQTTClient()
      const connectedBroker = await this.mqtt.connectWithFallback()
      
      SignalingLog.info('MQTT connected', { broker: connectedBroker })
      
      // Wait for subscription confirmation
      const subscribed = await this.mqtt.subscribe(this.topic, (message) => {
        try {
          const data = JSON.parse(message)
          this.handleSignalingMessage(data)
        } catch (e) {
          SignalingLog.debug('Invalid MQTT message', { 
            error: String(e),
            length: message.length,
            preview: message.substring(0, 50)
          })
        }
      })
      
      if (subscribed) {
        SignalingLog.info('Subscribed to topic', { topic: this.topic })
        mqttConnected = true
      } else {
        SignalingLog.warn('MQTT subscription failed after connection')
        this.mqtt.disconnect()
        this.mqtt = null
      }
      
    } catch (err) {
      SignalingLog.error('MQTT connection failed on all brokers', { error: String(err) })
      if (this.mqtt) {
        this.mqtt.disconnect()
        this.mqtt = null
      }
    }
    
    if (!mqttConnected) {
      SignalingLog.warn('MQTT connection failed, using BroadcastChannel only (same-device connections only)')
    }
    
    setTimeout(() => this.broadcastAnnounce(), 300)
    this.startAnnounceInterval()
    
    SignalingLog.info('Successfully joined room', { roomId, mqttConnected })
  }

  private broadcastAnnounce() {
    const msg: SignalMessage = {
      v: 1,
      type: 'announce',
      from: selfId,
      userName: this.userName,
      ts: Date.now()
    }
    
    SignalingLog.debug('Broadcasting announce', { selfId, peerCount: this.peers.size })
    this.broadcast(msg)
  }

  private startAnnounceInterval() {
    this.stopAnnounceInterval()
    
    this.announceInterval = setInterval(() => {
      const elapsed = Date.now() - this.announceStartTime
      
      if (elapsed > ANNOUNCE_DURATION && this.peers.size > 0) {
        this.stopAnnounceInterval()
        return
      }
      
      if (this.peers.size === 0) {
        SignalingLog.debug('Re-announcing', { elapsed: Math.round(elapsed / 1000) + 's' })
        this.broadcastAnnounce()
      }
    }, ANNOUNCE_INTERVAL)
  }

  private stopAnnounceInterval() {
    if (this.announceInterval) {
      clearInterval(this.announceInterval)
      this.announceInterval = null
    }
  }

  private broadcast(message: SignalMessage) {
    const jsonStr = JSON.stringify(message)
    let sentVia: string[] = []
    
    if (this.mqtt?.isConnected()) {
      if (this.mqtt.publish(this.topic, jsonStr)) {
        sentVia.push('MQTT')
      }
    }
    
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(message)
        sentVia.push('BroadcastChannel')
      } catch {}
    }
    
    if (message.type !== 'ping' && message.type !== 'pong' && message.type !== 'mute-status') {
      SignalingLog.debug('Message broadcast', { type: message.type, to: message.to || 'all', sentVia, size: jsonStr.length })
    }
  }

  private sendToPeer(peerId: string, message: SignalMessage) {
    message.to = peerId
    this.broadcast(message)
  }

  private handleSignalingMessage(message: SignalMessage) {
    // Filter out own messages
    if (message.from === selfId) {
      SignalingLog.debug('Ignoring own message', { type: message.type })
      return
    }
    
    // Filter out messages for other peers
    if (message.to && message.to !== selfId) {
      SignalingLog.debug('Ignoring message for other peer', { type: message.type, to: message.to })
      return
    }
    
    if (message.type !== 'ping' && message.type !== 'pong' && message.type !== 'mute-status') {
      SignalingLog.info('Received signaling message', { type: message.type, from: message.from, userName: message.userName })
    }
    
    switch (message.type) {
      case 'announce':
        this.handleAnnounce(message.from, message.userName || 'Unknown')
        break
      case 'offer':
        this.handleOffer(message.from, message.data, message.userName || 'Unknown')
        break
      case 'answer':
        this.handleAnswer(message.from, message.data)
        break
      case 'ice-candidate':
        this.handleIceCandidate(message.from, message.data)
        break
      case 'leave':
        this.handlePeerLeave(message.from)
        break
      case 'ping':
        this.sendToPeer(message.from, { v: 1, type: 'pong', from: selfId })
        break
      case 'mute-status':
        this.handleMuteStatus(message.from, message.data)
        break
    }
  }

  private handleMuteStatus(peerId: string, data: { micMuted?: boolean; speakerMuted?: boolean }) {
    const peer = this.peers.get(peerId)
    if (peer) {
      peer.muteStatus = {
        micMuted: data.micMuted ?? peer.muteStatus.micMuted,
        speakerMuted: data.speakerMuted ?? peer.muteStatus.speakerMuted
      }
      SignalingLog.debug('Peer mute status changed', { peerId, ...peer.muteStatus })
      this.onPeerMuteChange(peerId, peer.muteStatus)
    }
  }

  private async handleAnnounce(peerId: string, userName: string) {
    PeerLog.info('Received announce', { peerId, userName })
    
    const existingPeer = this.peers.get(peerId)
    if (existingPeer) {
      if (existingPeer.isConnected || existingPeer.pc.connectionState === 'connecting') {
        return
      }
      existingPeer.pc.close()
      this.peers.delete(peerId)
    }
    
    if (selfId > peerId) {
      PeerLog.info('Initiating connection', { selfId, peerId })
      await this.createOffer(peerId, userName)
    } else {
      PeerLog.info('Waiting for peer to initiate', { selfId, peerId })
      this.sendToPeer(peerId, { v: 1, type: 'announce', from: selfId, userName: this.userName, ts: Date.now() })
    }
  }

  /**
   * Configure Opus codec for optimal audio quality
   * - maxaveragebitrate: 40kbps (good balance of quality and bandwidth)
   * - stereo: disabled (conference audio is mono)
   * - useinbandfec: enabled (forward error correction for packet loss)
   */
  private configureOpusCodec(sdp: string): string {
    return sdp.replace(
      /(a=fmtp:\d+ .*)/g,
      '$1;maxaveragebitrate=40000;stereo=0;useinbandfec=1'
    )
  }

  private async createOffer(peerId: string, userName: string) {
    PeerLog.info('Creating offer', { peerId })
    
    try {
      const pc = this.createPeerConnection(peerId, userName)
      const offer = await pc.createOffer()
      
      // Apply Opus codec configuration
      const configuredSdp = this.configureOpusCodec(offer.sdp || '')
      const configuredOffer = { ...offer, sdp: configuredSdp }
      
      await pc.setLocalDescription(configuredOffer)
      
      this.sendToPeer(peerId, {
        v: 1,
        type: 'offer',
        from: selfId,
        data: { type: configuredOffer.type, sdp: configuredOffer.sdp },
        userName: this.userName
      })
      
      PeerLog.info('Offer sent (trickle ICE, Opus configured)', { peerId })
    } catch (err) {
      PeerLog.error('Failed to create offer', { peerId, error: String(err) })
      this.peers.delete(peerId)
    }
  }

  private async handleOffer(peerId: string, offer: RTCSessionDescriptionInit, userName: string) {
    PeerLog.info('Received offer', { peerId })
    
    const existing = this.peers.get(peerId)
    if (existing) {
      existing.pc.close()
      this.peers.delete(peerId)
    }
    
    try {
      const pc = this.createPeerConnection(peerId, userName)
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      
      const pending = this.pendingCandidates.get(peerId) || []
      for (const c of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c))
        } catch (e) {
          PeerLog.warn('Failed to add pending ICE candidate', { peerId })
        }
      }
      this.pendingCandidates.delete(peerId)
      
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      
      this.sendToPeer(peerId, { 
        v: 1, 
        type: 'answer', 
        from: selfId, 
        data: { type: answer.type, sdp: answer.sdp }
      })
      PeerLog.info('Answer sent (trickle ICE)', { peerId })
    } catch (err) {
      PeerLog.error('Failed to handle offer', { peerId, error: String(err) })
      this.peers.delete(peerId)
    }
  }

  private async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit) {
    PeerLog.info('Received answer', { peerId })
    
    const peer = this.peers.get(peerId)
    if (!peer) return
    
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer))
      
      const pending = this.pendingCandidates.get(peerId) || []
      for (const c of pending) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(c))
        } catch (e) {
          PeerLog.warn('Failed to add pending ICE candidate', { peerId })
        }
      }
      this.pendingCandidates.delete(peerId)
    } catch (err) {
      PeerLog.error('Failed to handle answer', { peerId, error: String(err) })
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(peerId)
    
    if (!peer || !peer.pc.remoteDescription) {
      if (!this.pendingCandidates.has(peerId)) {
        this.pendingCandidates.set(peerId, [])
      }
      this.pendingCandidates.get(peerId)!.push(candidate)
      PeerLog.debug('Queued ICE candidate', { peerId, queueSize: this.pendingCandidates.get(peerId)!.length })
      return
    }
    
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate))
      PeerLog.debug('Added ICE candidate', { peerId })
    } catch (err) {
      PeerLog.error('Failed to add ICE candidate', { peerId, error: String(err) })
    }
  }

  private handlePeerLeave(peerId: string) {
    const peer = this.peers.get(peerId)
    if (peer) {
      PeerLog.info('Peer leaving', { peerId })
      peer.pc.close()
      this.peers.delete(peerId)
      this.pendingCandidates.delete(peerId)
      this.onPeerLeave(peerId, peer.userName)
    }
  }

  private createPeerConnection(peerId: string, userName: string): RTCPeerConnection {
    PeerLog.info('Creating RTCPeerConnection', { peerId, userName })
    
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    
    const peerConn: PeerConnection = {
      pc, stream: null, userName,
      connectionStartTime: Date.now(),
      isConnected: false,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0
    }
    
    this.peers.set(peerId, peerConn)
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!)
      })
    }
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        PeerLog.debug('Sending ICE candidate', { peerId, type: event.candidate.type })
        this.sendToPeer(peerId, { 
          v: 1, 
          type: 'ice-candidate', 
          from: selfId, 
          data: event.candidate.toJSON() 
        })
      }
    }
    
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState
      PeerLog.info('ICE state', { peerId, state: iceState })
      
      // Attempt ICE restart on failed or disconnected states
      if (iceState === 'failed') {
        PeerLog.warn('ICE connection failed, attempting restart', { peerId })
        setTimeout(() => this.attemptIceRestart(peerId), ICE_RESTART_DELAY)
      } else if (iceState === 'disconnected') {
        // Wait a bit before attempting restart as 'disconnected' may be temporary
        PeerLog.warn('ICE connection disconnected, waiting before restart', { peerId })
        setTimeout(() => {
          const currentPeer = this.peers.get(peerId)
          if (currentPeer && currentPeer.pc.iceConnectionState === 'disconnected') {
            this.attemptIceRestart(peerId)
          }
        }, ICE_RESTART_DELAY * 2)
      }
    }
    
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      PeerLog.info('Connection state', { peerId, state })
      
      if (state === 'connected') {
        peerConn.isConnected = true
        this.stopAnnounceInterval()
        this.onPeerJoin(peerId, userName)
        
        // Send our current mute status to the newly connected peer
        setTimeout(() => {
          this.sendToPeer(peerId, {
            v: 1,
            type: 'mute-status',
            from: selfId,
            data: this.localMuteStatus
          })
        }, 500)
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        if (peerConn.isConnected) {
          peerConn.isConnected = false
          this.handlePeerLeave(peerId)
        } else {
          this.peers.delete(peerId)
        }
      }
    }
    
    pc.ontrack = (event) => {
      PeerLog.info('Received remote track', { peerId, kind: event.track.kind })
      if (event.streams?.[0]) {
        peerConn.stream = event.streams[0]
        this.onRemoteStream(peerId, event.streams[0])
      }
    }
    
    return pc
  }

  /**
   * Attempt ICE restart for a peer connection
   * This is useful when the connection fails but both peers are still available
   */
  private async attemptIceRestart(peerId: string) {
    const peer = this.peers.get(peerId)
    if (!peer) return
    
    if (peer.iceRestartAttempts >= MAX_ICE_RESTART_ATTEMPTS) {
      PeerLog.warn('Max ICE restart attempts reached', { peerId, attempts: peer.iceRestartAttempts })
      this.handlePeerLeave(peerId)
      return
    }
    
    peer.iceRestartAttempts++
    PeerLog.info('Attempting ICE restart', { peerId, attempt: peer.iceRestartAttempts })
    
    try {
      // Create new offer with ICE restart flag
      const offer = await peer.pc.createOffer({ iceRestart: true })
      const configuredSdp = this.configureOpusCodec(offer.sdp || '')
      const configuredOffer = { ...offer, sdp: configuredSdp }
      
      await peer.pc.setLocalDescription(configuredOffer)
      
      this.sendToPeer(peerId, {
        v: 1,
        type: 'offer',
        from: selfId,
        data: { type: configuredOffer.type, sdp: configuredOffer.sdp },
        userName: this.userName
      })
      
      PeerLog.info('ICE restart offer sent', { peerId })
    } catch (err) {
      PeerLog.error('ICE restart failed', { peerId, error: String(err) })
      this.handlePeerLeave(peerId)
    }
  }

  leaveRoom() {
    SignalingLog.info('Leaving room', { roomId: this.roomId })
    
    this.stopAnnounceInterval()
    
    this.broadcast({ v: 1, type: 'leave', from: selfId })
    
    this.peers.forEach(peer => peer.pc.close())
    this.peers.clear()
    this.pendingCandidates.clear()
    
    this.mqtt?.disconnect()
    this.mqtt = null
    
    this.broadcastChannel?.close()
    this.broadcastChannel = null
    
    this.roomId = null
    this.localStream = null
    this.localMuteStatus = { micMuted: false, speakerMuted: false }
  }

  getPeers(): Map<string, { userName: string; stream: MediaStream | null; muteStatus: MuteStatus }> {
    const result = new Map()
    this.peers.forEach((peer, id) => result.set(id, { 
      userName: peer.userName, 
      stream: peer.stream,
      muteStatus: peer.muteStatus
    }))
    return result
  }

  replaceTrack(newTrack: MediaStreamTrack) {
    this.peers.forEach((peer, peerId) => {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio')
      if (sender) {
        sender.replaceTrack(newTrack).catch(err => PeerLog.error('Replace track failed', { peerId }))
      }
    })
  }

  getDebugInfo(): object {
    return {
      selfId, 
      roomId: this.roomId, 
      userName: this.userName,
      topic: this.topic,
      mqttConnected: this.mqtt?.isConnected() || false,
      mqttSubscribed: this.mqtt?.isSubscribed() || false,
      mqttMessagesReceived: this.mqtt?.getMessageCount() || 0,
      peerCount: this.peers.size,
      peers: Array.from(this.peers.keys()),
      localMuteStatus: this.localMuteStatus
    }
  }
}

export const peerManager = new SimplePeerManager()
