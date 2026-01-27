/**
 * SimplePeerManager - Browser-compatible WebRTC P2P implementation
 * Uses MQTT over WebSocket with proper keepalive and trickle ICE
 * 
 * MULTI-BROKER STRATEGY: To maximize connectivity, we connect to ALL available
 * MQTT brokers simultaneously and broadcast messages on all of them. This ensures
 * that even if a user can only reach some brokers (due to network issues), they
 * can still communicate with others who share at least one common broker.
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
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: [
      'turn:47.111.10.155:3478',
    ],
    username: 'turnuser',
    credential: 'huUKPizqnXPY5W94BXpPh3hZ4nZcdhA3'
  }
]

// Timing constants
const ANNOUNCE_INTERVAL = 3000
const ANNOUNCE_DURATION = 60000
const MQTT_KEEPALIVE = 20000
const MAX_ICE_RESTART_ATTEMPTS = 2
const ICE_RESTART_DELAY = 2000
const ANNOUNCE_DEBOUNCE = 100
const MQTT_CONNECT_TIMEOUT = 8000

// Message deduplication settings
const MESSAGE_DEDUP_WINDOW_SIZE = 500      // Max messages to track
const MESSAGE_DEDUP_TTL_MS = 30000         // 30 seconds TTL for dedup entries

// Reconnection settings
const RECONNECT_BASE_DELAY = 2000
const RECONNECT_MAX_DELAY = 30000
const RECONNECT_MAX_ATTEMPTS = 5

interface BrokerConfig {
  url: string
  username?: string
  password?: string
}

// Multiple MQTT brokers for redundancy - we connect to ALL of them
// and broadcast on all connected brokers to maximize connectivity
const MQTT_BROKERS: BrokerConfig[] = [
  { 
    url: 'ws://47.111.10.155:8083/mqtt',
    username: 'mqtt_admin',
    password: 'Q32yrcmtp53tpnEpSZj7nTZUmqKML6mF'
  },
  { url: 'wss://broker.emqx.io:8084/mqtt' }, // Global EMQX (most reliable)
  { url: 'wss://broker-cn.emqx.io:8084/mqtt' }, // China EMQX  
  { url: 'wss://test.mosquitto.org:8081/mqtt' } // Mosquitto public broker
]

interface SignalMessage {
  v: number
  type: 'announce' | 'offer' | 'answer' | 'ice-candidate' | 'leave' | 'ping' | 'pong' | 'mute-status'
  from: string
  to?: string
  data?: any
  userName?: string
  ts?: number
  sessionId?: number
  msgId?: string  // Unique message ID for deduplication
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

export type SignalingState = 'idle' | 'connecting' | 'connected' | 'failed'

/**
 * Generate a unique message ID for deduplication
 */
function generateMessageId(): string {
  return `${selfId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Message deduplication cache using a sliding window with TTL
 * Prevents processing the same message received from multiple brokers
 */
class MessageDeduplicator {
  private seen: Map<string, number> = new Map()  // msgId -> timestamp
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // Periodic cleanup of old entries
    this.cleanupInterval = setInterval(() => this.cleanup(), MESSAGE_DEDUP_TTL_MS / 2)
  }

  /**
   * Check if message was already seen. If not, mark it as seen.
   * @returns true if this is a duplicate, false if it's new
   */
  isDuplicate(msgId: string): boolean {
    if (!msgId) return false  // No ID = can't dedupe, treat as new
    
    if (this.seen.has(msgId)) {
      return true
    }

    // Add to seen set
    this.seen.set(msgId, Date.now())

    // If we exceed window size, remove oldest entries
    if (this.seen.size > MESSAGE_DEDUP_WINDOW_SIZE) {
      const entries = Array.from(this.seen.entries())
      entries.sort((a, b) => a[1] - b[1])  // Sort by timestamp ascending
      const toRemove = entries.slice(0, entries.length - MESSAGE_DEDUP_WINDOW_SIZE)
      toRemove.forEach(([key]) => this.seen.delete(key))
    }

    return false
  }

  /**
   * Remove entries older than TTL
   */
  private cleanup() {
    const cutoff = Date.now() - MESSAGE_DEDUP_TTL_MS
    const toDelete: string[] = []
    
    this.seen.forEach((timestamp, msgId) => {
      if (timestamp < cutoff) {
        toDelete.push(msgId)
      }
    })
    
    toDelete.forEach(msgId => this.seen.delete(msgId))
    
    if (toDelete.length > 0) {
      SignalingLog.debug('Dedup cache cleanup', { removed: toDelete.length, remaining: this.seen.size })
    }
  }

  /**
   * Clear all entries and stop cleanup timer
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.seen.clear()
  }

  /**
   * Get current cache size (for debugging)
   */
  size(): number {
    return this.seen.size
  }
}

/**
 * Single MQTT broker connection with keepalive and proper buffer handling
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
  private brokerUrl: string = ''
  private onDisconnectCallback: ((brokerUrl: string) => void) | null = null
  private isIntentionallyClosed = false
  private username?: string
  private password?: string

  constructor(brokerUrl: string, username?: string, password?: string) {
    this.brokerUrl = brokerUrl
    this.username = username
    this.password = password
    // Include broker identifier in client ID to avoid conflicts
    const brokerHash = brokerUrl.split('//')[1]?.split('.')[0] || 'unknown'
    this.clientId = `p2p_${selfId.substring(0, 6)}_${brokerHash}_${Math.random().toString(36).substring(2, 4)}`
  }

  getBrokerUrl(): string {
    return this.brokerUrl
  }

  /**
   * Set callback for disconnect events
   */
  setOnDisconnect(callback: (brokerUrl: string) => void) {
    this.onDisconnectCallback = callback
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve()
        return
      }

      this.isIntentionallyClosed = false

      try {
        this.ws = new WebSocket(this.brokerUrl, 'mqtt')
        this.ws.binaryType = 'arraybuffer'
        this.buffer = new Uint8Array(0)
        
        const timeout = setTimeout(() => {
          if (!this.connected) {
            this.disconnect()
            reject(new Error(`MQTT connection timeout: ${this.brokerUrl}`))
          }
        }, MQTT_CONNECT_TIMEOUT)

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
          if (!this.connected) {
            reject(new Error(`MQTT WebSocket error: ${this.brokerUrl}`))
          }
        }

        this.ws.onclose = () => {
          const wasConnected = this.connected
          this.connected = false
          this.subscribed = false
          this.stopKeepalive()
          
          // Only trigger disconnect callback if this wasn't intentional
          if (wasConnected && !this.isIntentionallyClosed && this.onDisconnectCallback) {
            SignalingLog.warn('MQTT broker disconnected unexpectedly', { broker: this.brokerUrl })
            this.onDisconnectCallback(this.brokerUrl)
          }
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
        this.ws.send(new Uint8Array([0xC0, 0x00]))  // PINGREQ
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
        // Invalid remaining length encoding, clear buffer
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
    
    let usernameBytes = new Uint8Array(0)
    let passwordBytes = new Uint8Array(0)
    
    if (this.username) {
      usernameBytes = new TextEncoder().encode(this.username)
    }
    if (this.password) {
      passwordBytes = new TextEncoder().encode(this.password)
    }

    // Variable Header (10 bytes) + Client ID (2 len + bytes)
    let payloadLength = 10 + (2 + clientIdBytes.length)

    if (this.username) {
      payloadLength += (2 + usernameBytes.length)
    }
    if (this.password) {
      payloadLength += (2 + passwordBytes.length)
    }

    const lengthBytes: number[] = []
    let x = payloadLength
    do {
      let byte = x % 128
      x = Math.floor(x / 128)
      if (x > 0) byte |= 0x80
      lengthBytes.push(byte)
    } while (x > 0)

    const packet = new Uint8Array(1 + lengthBytes.length + payloadLength)
    let i = 0

    // --- Fixed Header ---
    packet[i++] = 0x10  // CONNECT Packet Type
    
    for (const b of lengthBytes) {
      packet[i++] = b
    }

    // --- Variable Header ---
    packet[i++] = 0     // Protocol Name Length MSB
    packet[i++] = 4     // Protocol Name Length LSB
    packet.set(protocolName, i)
    i += 4
    
    packet[i++] = 4     // Protocol Level (MQTT 3.1.1)
    
    // Connect Flags
    // Clean Session (bit 1) = 2
    // Username Flag (bit 7) = 0x80
    // Password Flag (bit 6) = 0x40
    let connectFlags = 2
    if (this.username) connectFlags |= 0x80
    if (this.password) connectFlags |= 0x40
    packet[i++] = connectFlags
    
    packet[i++] = 0     // Keep Alive MSB
    packet[i++] = 30    // Keep Alive LSB (30 seconds)

    // --- Payload ---
    // Client ID
    packet[i++] = (clientIdBytes.length >> 8) & 0xff
    packet[i++] = clientIdBytes.length & 0xff
    packet.set(clientIdBytes, i)
    i += clientIdBytes.length

    // User Name
    if (this.username) {
      packet[i++] = (usernameBytes.length >> 8) & 0xff
      packet[i++] = usernameBytes.length & 0xff
      packet.set(usernameBytes, i)
      i += usernameBytes.length
    }

    // Password
    if (this.password) {
      packet[i++] = (passwordBytes.length >> 8) & 0xff
      packet[i++] = passwordBytes.length & 0xff
      packet.set(passwordBytes, i)
      i += passwordBytes.length
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(packet)
    }
  }

  async subscribe(topic: string, callback: (message: string) => void): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      SignalingLog.error('MQTT subscribe failed - not connected', { broker: this.brokerUrl })
      return false
    }
    
    this.topic = topic
    this.onMessage = callback
    this.subscribed = false
    
    const topicBytes = new TextEncoder().encode(topic)
    const remainingLength = 2 + 2 + topicBytes.length + 1
    const packet = new Uint8Array(2 + remainingLength)
    
    let i = 0
    packet[i++] = 0x82  // SUBSCRIBE packet type
    packet[i++] = remainingLength
    packet[i++] = (this.messageId >> 8) & 0xff
    packet[i++] = this.messageId++ & 0xff
    packet[i++] = (topicBytes.length >> 8) & 0xff
    packet[i++] = topicBytes.length & 0xff
    packet.set(topicBytes, i)
    i += topicBytes.length
    packet[i++] = 0     // QoS 0
    
    return new Promise((resolve) => {
      this.pendingSubscribe = { 
        resolve: () => resolve(true), 
        reject: () => resolve(false) 
      }
      
      this.subscribeTimeout = setTimeout(() => {
        if (!this.subscribed) {
          SignalingLog.warn('MQTT SUBACK timeout', { broker: this.brokerUrl })
          this.pendingSubscribe?.reject(new Error('Subscription timeout'))
          this.pendingSubscribe = null
        }
      }, 5000)
      
      try {
        this.ws!.send(packet)
      } catch (err) {
        SignalingLog.error('MQTT subscribe send error', { broker: this.brokerUrl, error: String(err) })
        clearTimeout(this.subscribeTimeout)
        this.pendingSubscribe = null
        resolve(false)
      }
    })
  }

  publish(topic: string, message: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }
    
    const topicBytes = new TextEncoder().encode(topic)
    const messageBytes = new TextEncoder().encode(message)
    const remainingLength = 2 + topicBytes.length + messageBytes.length
    
    // Encode remaining length (variable length encoding)
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
    packet[i++] = 0x30  // PUBLISH packet type (QoS 0)
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
      SignalingLog.error('MQTT publish error', { broker: this.brokerUrl, error: String(err) })
      return false
    }
  }

  private handlePacket(data: Uint8Array) {
    const packetType = data[0] >> 4
    
    if (packetType === 2) {
      // CONNACK
      SignalingLog.debug('MQTT CONNACK received', { broker: this.brokerUrl })
    } else if (packetType === 3) {
      // PUBLISH
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
      
      if (idx + 2 > data.length) return
      
      const topicLen = (data[idx] << 8) | data[idx + 1]
      idx += 2
      
      if (idx + topicLen > data.length) return
      
      idx += topicLen  // Skip topic
      
      // Skip packet identifier for QoS > 0
      if (qos > 0) {
        idx += 2
      }
      
      const payloadBytes = data.slice(idx)
      const payload = new TextDecoder().decode(payloadBytes)
      
      this.messageCount++
      
      if (this.onMessage && payload.length > 0) {
        this.onMessage(payload)
      }
    } else if (packetType === 9) {
      // SUBACK
      this.subscribed = true
      SignalingLog.info('MQTT SUBACK received', { broker: this.brokerUrl, topic: this.topic })
      
      if (this.subscribeTimeout) {
        clearTimeout(this.subscribeTimeout)
        this.subscribeTimeout = null
      }
      if (this.pendingSubscribe) {
        this.pendingSubscribe.resolve()
        this.pendingSubscribe = null
      }
    } else if (packetType === 13) {
      // PINGRESP
      SignalingLog.debug('MQTT PINGRESP', { broker: this.brokerUrl })
    }
  }

  disconnect() {
    this.isIntentionallyClosed = true
    this.stopKeepalive()
    
    if (this.subscribeTimeout) {
      clearTimeout(this.subscribeTimeout)
      this.subscribeTimeout = null
    }
    this.pendingSubscribe = null
    this.onDisconnectCallback = null
    
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(new Uint8Array([0xe0, 0x00]))  // DISCONNECT
        }
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

/**
 * Multi-broker MQTT manager that connects to ALL brokers simultaneously
 * and handles message deduplication across brokers
 */
class MultiBrokerMQTT {
  private clients: Map<string, MQTTClient> = new Map()  // brokerUrl -> client
  private topic: string = ''
  private onMessage: ((payload: string) => void) | null = null
  private deduplicator: MessageDeduplicator = new MessageDeduplicator()
  private reconnectAttempts: Map<string, number> = new Map()
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map()
  private isShuttingDown = false

  /**
   * Connect to all configured MQTT brokers in parallel
   * @returns Array of successfully connected broker URLs
   */
  async connectAll(): Promise<string[]> {
    this.isShuttingDown = false
    const connectedBrokers: string[] = []
    
    SignalingLog.info('Connecting to all MQTT brokers', { count: MQTT_BROKERS.length })
    
    // Connect to all brokers in parallel
    const results = await Promise.allSettled(
      MQTT_BROKERS.map(async (brokerConfig) => {
        const brokerUrl = brokerConfig.url
        const client = new MQTTClient(brokerUrl, brokerConfig.username, brokerConfig.password)
        
        // Set up disconnect handler for reconnection
        client.setOnDisconnect((url) => {
          if (!this.isShuttingDown) {
            this.handleBrokerDisconnect(url, brokerConfig.username, brokerConfig.password)
          }
        })
        
        try {
          await client.connect()
          this.clients.set(brokerUrl, client)
          this.reconnectAttempts.set(brokerUrl, 0)  // Reset attempts on success
          SignalingLog.info('MQTT broker connected', { broker: brokerUrl })
          return brokerUrl
        } catch (err) {
          SignalingLog.warn('MQTT broker failed to connect', { broker: brokerUrl, error: String(err) })
          throw err
        }
      })
    )
    
    // Collect successful connections
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        connectedBrokers.push(result.value)
      }
    })
    
    SignalingLog.info('MQTT connection results', { 
      total: MQTT_BROKERS.length, 
      connected: connectedBrokers.length,
      brokers: connectedBrokers
    })
    
    return connectedBrokers
  }

  /**
   * Handle unexpected broker disconnect with exponential backoff reconnection
   */
  private async handleBrokerDisconnect(brokerUrl: string, username?: string, password?: string) {
    if (this.isShuttingDown) return
    
    // Clean up old client
    const oldClient = this.clients.get(brokerUrl)
    if (oldClient) {
      oldClient.disconnect()
      this.clients.delete(brokerUrl)
    }
    
    const attempts = (this.reconnectAttempts.get(brokerUrl) || 0) + 1
    this.reconnectAttempts.set(brokerUrl, attempts)
    
    if (attempts > RECONNECT_MAX_ATTEMPTS) {
      SignalingLog.warn('Max reconnect attempts reached for broker', { broker: brokerUrl, attempts })
      return
    }
    
    // Exponential backoff with jitter
    const baseDelay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, attempts - 1), RECONNECT_MAX_DELAY)
    const jitter = Math.random() * 1000
    const delay = baseDelay + jitter
    
    SignalingLog.info('Scheduling MQTT reconnection', { broker: brokerUrl, attempt: attempts, delayMs: Math.round(delay) })
    
    // Clear any existing reconnect timer
    const existingTimer = this.reconnectTimers.get(brokerUrl)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }
    
    // Schedule reconnection
    const timer = setTimeout(async () => {
      if (this.isShuttingDown) return
      
      try {
        const client = new MQTTClient(brokerUrl, username, password)
        client.setOnDisconnect((url) => {
          if (!this.isShuttingDown) {
            this.handleBrokerDisconnect(url, username, password)
          }
        })
        
        await client.connect()
        this.clients.set(brokerUrl, client)
        
        // Re-subscribe if we have a topic
        if (this.topic && this.onMessage) {
          const subscribed = await client.subscribe(this.topic, this.onMessage)
          if (subscribed) {
            SignalingLog.info('MQTT broker reconnected and resubscribed', { broker: brokerUrl })
            this.reconnectAttempts.set(brokerUrl, 0)  // Reset on success
          } else {
            SignalingLog.warn('MQTT broker reconnected but subscribe failed', { broker: brokerUrl })
          }
        }
      } catch (err) {
        SignalingLog.warn('MQTT reconnection failed', { broker: brokerUrl, attempt: attempts, error: String(err) })
        // Will retry via disconnect handler
      }
    }, delay)
    
    this.reconnectTimers.set(brokerUrl, timer)
  }

  /**
   * Subscribe to a topic on all connected brokers
   * @returns Number of successful subscriptions
   */
  async subscribeAll(topic: string, callback: (message: string) => void): Promise<number> {
    this.topic = topic
    
    // Wrap callback with deduplication
    this.onMessage = (payload: string) => {
      try {
        const data = JSON.parse(payload)
        const msgId = data.msgId
        
        // Check for duplicates
        if (msgId && this.deduplicator.isDuplicate(msgId)) {
          SignalingLog.debug('Duplicate message filtered', { msgId: msgId.substring(0, 20) })
          return
        }
        
        // Pass through to actual callback
        callback(payload)
      } catch {
        // If we can't parse, just pass through (shouldn't happen in normal operation)
        callback(payload)
      }
    }
    
    let successCount = 0
    
    // Subscribe on all clients in parallel
    const results = await Promise.allSettled(
      Array.from(this.clients.entries()).map(async ([brokerUrl, client]) => {
        const success = await client.subscribe(topic, this.onMessage!)
        if (success) {
          SignalingLog.info('Subscribed on broker', { broker: brokerUrl, topic })
          return brokerUrl
        } else {
          throw new Error(`Subscribe failed on ${brokerUrl}`)
        }
      })
    )
    
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        successCount++
      }
    })
    
    SignalingLog.info('Subscription results', { total: this.clients.size, subscribed: successCount })
    
    return successCount
  }

  /**
   * Publish a message to ALL connected brokers
   * @returns Number of successful publishes
   */
  publish(topic: string, message: string): number {
    let successCount = 0
    
    this.clients.forEach((client) => {
      if (client.isConnected() && client.isSubscribed()) {
        if (client.publish(topic, message)) {
          successCount++
        }
      }
    })
    
    return successCount
  }

  /**
   * Disconnect from all brokers and clean up
   */
  disconnect() {
    this.isShuttingDown = true
    
    // Clear all reconnect timers
    this.reconnectTimers.forEach((timer) => {
      clearTimeout(timer)
    })
    this.reconnectTimers.clear()
    this.reconnectAttempts.clear()
    
    // Disconnect all clients
    this.clients.forEach((client) => {
      client.disconnect()
    })
    this.clients.clear()
    
    // Clean up deduplicator
    this.deduplicator.destroy()
    this.deduplicator = new MessageDeduplicator()  // Create fresh instance for next use
    
    this.topic = ''
    this.onMessage = null
  }

  /**
   * Check if at least one broker is connected
   */
  isConnected(): boolean {
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        return true
      }
    }
    return false
  }

  /**
   * Check if at least one broker is subscribed
   */
  isSubscribed(): boolean {
    for (const client of this.clients.values()) {
      if (client.isSubscribed()) {
        return true
      }
    }
    return false
  }

  /**
   * Get total message count across all brokers
   */
  getTotalMessageCount(): number {
    let total = 0
    this.clients.forEach(client => {
      total += client.getMessageCount()
    })
    return total
  }

  /**
   * Get connection status for all brokers
   */
  getConnectionStatus(): { broker: string; connected: boolean; subscribed: boolean }[] {
    return Array.from(this.clients.entries()).map(([broker, client]) => ({
      broker,
      connected: client.isConnected(),
      subscribed: client.isSubscribed()
    }))
  }

  /**
   * Get number of connected brokers
   */
  getConnectedCount(): number {
    let count = 0
    this.clients.forEach(client => {
      if (client.isConnected()) count++
    })
    return count
  }

  /**
   * Get deduplication cache size (for debugging)
   */
  getDeduplicatorSize(): number {
    return this.deduplicator.size()
  }
}

export class SimplePeerManager {
  private roomId: string | null = null
  private userName: string = ''
  private mqtt: MultiBrokerMQTT | null = null
  private topic: string = ''
  private peers: Map<string, PeerConnection> = new Map()
  private localStream: MediaStream | null = null
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map()
  private broadcastChannel: BroadcastChannel | null = null
  private announceInterval: NodeJS.Timeout | null = null
  private announceStartTime: number = 0
  private localMuteStatus: MuteStatus = { micMuted: false, speakerMuted: false }
  
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
  
  private onPeerJoin: PeerEventCallback = () => {}
  private onPeerLeave: PeerEventCallback = () => {}
  private onRemoteStream: StreamCallback = () => {}
  private onError: ErrorCallback = () => {}
  private onPeerMuteChange: MuteStatusCallback = () => {}
  
  constructor() {
    SignalingLog.info('SimplePeerManager initialized', { selfId })
  }

  /**
   * Set callback for signaling state changes
   */
  setOnSignalingStateChange(callback: (state: SignalingState) => void) {
    this.onSignalingStateChange = callback
  }

  private updateSignalingState(state: SignalingState) {
    if (this.signalingState !== state) {
      this.signalingState = state
      SignalingLog.info('Signaling state changed', { state })
      this.onSignalingStateChange?.(state)
    }
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
    if (callbacks.onPeerJoin) this.onPeerJoin = callbacks.onPeerJoin
    if (callbacks.onPeerLeave) this.onPeerLeave = callbacks.onPeerLeave
    if (callbacks.onRemoteStream) this.onRemoteStream = callbacks.onRemoteStream
    if (callbacks.onError) this.onError = callbacks.onError
    if (callbacks.onPeerMuteChange) this.onPeerMuteChange = callbacks.onPeerMuteChange
  }

  setLocalStream(stream: MediaStream) {
    SignalingLog.info('Setting local stream', { streamId: stream.id, trackCount: stream.getTracks().length })
    this.localStream = stream
    
    // Add tracks to all existing peer connections
    this.peers.forEach((peer, peerId) => {
      const senders = peer.pc.getSenders()
      const audioSender = senders.find(s => s.track?.kind === 'audio')
      
      // Check if we already have an audio track added
      if (audioSender && audioSender.track) {
        SignalingLog.debug('Audio track already added for peer', { peerId })
        return
      }
      
      // Add all tracks from the local stream
      const tracks = stream.getTracks()
      tracks.forEach(track => {
        // Check if this track is already added
        const existingSender = senders.find(s => s.track === track)
        if (existingSender) {
          SignalingLog.debug('Track already added, skipping', { peerId, trackKind: track.kind })
          return
        }
        
        // Check if there's a sender without a track that we can use
        const emptySender = senders.find(s => s.track === null)
        if (emptySender) {
          SignalingLog.info('Replacing empty sender track', { peerId, trackKind: track.kind })
          emptySender.replaceTrack(track)
            .then(() => SignalingLog.info('Track replaced successfully', { peerId, trackKind: track.kind }))
            .catch(err => SignalingLog.error('Failed to replace track', { peerId, error: String(err) }))
        } else {
          SignalingLog.info('Adding new track to peer', { peerId, trackKind: track.kind })
          try {
            peer.pc.addTrack(track, stream)
          } catch (err) {
            SignalingLog.error('Failed to add track', { peerId, error: String(err) })
          }
        }
      })
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
      data: { micMuted, speakerMuted },
      sessionId: this.sessionId,
      msgId: generateMessageId()
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
    // Prevent concurrent join operations
    if (this.isJoining) {
      SignalingLog.warn('Join already in progress, ignoring')
      return
    }
    
    // Clean up any existing connection first
    if (this.roomId) {
      SignalingLog.info('Cleaning up previous room before joining new one')
      this.leaveRoom()
      // Small delay to ensure cleanup completes
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    this.isJoining = true
    this.sessionId++  // Increment session ID to invalidate any stale messages
    const currentSession = this.sessionId
    
    try {
      this.updateSignalingState('connecting')
      
      this.roomId = roomId
      this.userName = userName
      this.announceStartTime = Date.now()
      this.topic = `p2p-conf/${roomId}`
      
      SignalingLog.info('Joining room', { 
        roomId, userName, selfId, 
        topic: this.topic, 
        sessionId: currentSession 
      })
      
      // Close any existing BroadcastChannel first
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.close()
        } catch {}
        this.broadcastChannel = null
      }
      
      // Set up BroadcastChannel for same-device connections
      try {
        this.broadcastChannel = new BroadcastChannel(`p2p-${roomId}`)
        this.broadcastChannel.onmessage = (event) => {
          // Verify session is still current
          if (this.sessionId !== currentSession) {
            SignalingLog.debug('Ignoring BroadcastChannel message from previous session')
            return
          }
          this.handleSignalingMessage(event.data)
        }
        SignalingLog.debug('BroadcastChannel connected')
      } catch (err) {
        SignalingLog.warn('BroadcastChannel not available')
      }
      
      // Connect to ALL MQTT brokers
      let connectedBrokers: string[] = []
      
      try {
        SignalingLog.info('Starting multi-broker MQTT connection')
        
        this.mqtt = new MultiBrokerMQTT()
        connectedBrokers = await this.mqtt.connectAll()
        
        if (connectedBrokers.length === 0) {
          throw new Error('No MQTT brokers could be connected')
        }
        
        SignalingLog.info('MQTT brokers connected', { 
          count: connectedBrokers.length, 
          brokers: connectedBrokers 
        })
        
        // Subscribe on all connected brokers
        const subscribeCount = await this.mqtt.subscribeAll(this.topic, (message) => {
          // Verify session is still current
          if (this.sessionId !== currentSession) {
            SignalingLog.debug('Ignoring MQTT message from previous session')
            return
          }
          
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
        
        if (subscribeCount > 0) {
          SignalingLog.info('Subscribed to topic', { 
            topic: this.topic, 
            brokerCount: subscribeCount 
          })
          this.updateSignalingState('connected')
        } else {
          SignalingLog.warn('MQTT subscription failed on all brokers')
          this.mqtt.disconnect()
          this.mqtt = null
        }
        
      } catch (err) {
        SignalingLog.error('MQTT connection failed', { error: String(err) })
        this.onError(err as Error, 'mqtt-connection')
        if (this.mqtt) {
          this.mqtt.disconnect()
          this.mqtt = null
        }
      }
      
      if (!this.mqtt?.isConnected()) {
        SignalingLog.warn('MQTT unavailable, using BroadcastChannel only (same-device connections only)')
        this.updateSignalingState('connected')  // Still "connected" for local mode
      }
      
      // Start announcing presence
      setTimeout(() => {
        if (this.sessionId === currentSession) {
          this.broadcastAnnounce()
        }
      }, 300)
      this.startAnnounceInterval()
      
      SignalingLog.info('Successfully joined room', { 
        roomId, 
        mqttConnected: this.mqtt?.isConnected() || false,
        mqttBrokerCount: this.mqtt?.getConnectedCount() || 0,
        sessionId: currentSession 
      })
    } finally {
      this.isJoining = false
    }
  }

  private broadcastAnnounce() {
    // Debounce announce messages to prevent flooding
    if (this.announceDebounceTimer) {
      clearTimeout(this.announceDebounceTimer)
    }
    
    this.announceDebounceTimer = setTimeout(() => {
      const msg: SignalMessage = {
        v: 1,
        type: 'announce',
        from: selfId,
        userName: this.userName,
        ts: Date.now(),
        sessionId: this.sessionId,
        msgId: generateMessageId()
      }
      
      SignalingLog.debug('Broadcasting announce', { selfId, peerCount: this.peers.size })
      this.broadcast(msg)
      this.announceDebounceTimer = null
    }, ANNOUNCE_DEBOUNCE)
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
    if (this.announceDebounceTimer) {
      clearTimeout(this.announceDebounceTimer)
      this.announceDebounceTimer = null
    }
  }

  private broadcast(message: SignalMessage) {
    // Ensure message has an ID for deduplication
    if (!message.msgId) {
      message.msgId = generateMessageId()
    }
    
    const jsonStr = JSON.stringify(message)
    let sentVia: string[] = []
    
    // Publish to ALL connected MQTT brokers
    if (this.mqtt?.isConnected()) {
      const publishCount = this.mqtt.publish(this.topic, jsonStr)
      if (publishCount > 0) {
        sentVia.push(`MQTT(${publishCount} brokers)`)
      }
    }
    
    // Also send via BroadcastChannel for same-device
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
    message.sessionId = this.sessionId
    if (!message.msgId) {
      message.msgId = generateMessageId()
    }
    this.broadcast(message)
  }

  private handleSignalingMessage(message: SignalMessage) {
    // Filter out own messages
    if (message.from === selfId) {
      return
    }
    
    // Filter out messages for other peers
    if (message.to && message.to !== selfId) {
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
      const state = existingPeer.pc.connectionState
      
      PeerLog.info('Check existing peer', { peerId, state, isConnected: existingPeer.isConnected })
      
      if (state !== 'closed' && state !== 'failed') {
        PeerLog.info('Ignoring duplicate announce - connection is alive', { peerId, state })
        return
      }
      
      PeerLog.info('Cleaning up dead peer', { peerId, state })
      try {
        existingPeer.pc.close()
      } catch {}
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
   */
  private configureOpusCodec(sdp: string): string {
    return sdp.replace(
      /(a=fmtp:\d+ .*)/g,
      '$1;maxaveragebitrate=60000;stereo=0;useinbandfec=1'
    )
  }

  private async createOffer(peerId: string, userName: string) {
    PeerLog.info('Creating offer', { peerId })
    
    try {
      const pc = this.createPeerConnection(peerId, userName)
      const offer = await pc.createOffer()
      
      const configuredSdp = this.configureOpusCodec(offer.sdp || '')
      const configuredOffer: RTCSessionDescriptionInit = { 
        type: offer.type, 
        sdp: configuredSdp 
      }
      
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
      try {
        existing.pc.close()
      } catch {}
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
      try {
        peer.pc.close()
      } catch {}
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
      
      if (iceState === 'failed') {
        PeerLog.warn('ICE connection failed, attempting restart', { peerId })
        setTimeout(() => this.attemptIceRestart(peerId), ICE_RESTART_DELAY)
      } else if (iceState === 'disconnected') {
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
      PeerLog.info('Received remote track', { 
        peerId, 
        kind: event.track.kind,
        trackId: event.track.id,
        streamCount: event.streams?.length || 0
      })
      
      let remoteStream: MediaStream
      if (event.streams && event.streams[0]) {
        remoteStream = event.streams[0]
      } else {
        PeerLog.info('Creating MediaStream from track (no stream in event)', { peerId })
        remoteStream = new MediaStream([event.track])
      }
      
      peerConn.stream = remoteStream
      
      PeerLog.info('Calling onRemoteStream callback', { 
        peerId, 
        streamId: remoteStream.id,
        trackCount: remoteStream.getTracks().length,
        audioTracks: remoteStream.getAudioTracks().length
      })
      this.onRemoteStream(peerId, remoteStream)
    }
    
    return pc
  }

  /**
   * Attempt ICE restart for a peer connection
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
      const offer = await peer.pc.createOffer({ iceRestart: true })
      const configuredSdp = this.configureOpusCodec(offer.sdp || '')
      
      const configuredOffer: RTCSessionDescriptionInit = { 
        type: offer.type, 
        sdp: configuredSdp 
      }
      
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
    // Prevent leaving if not in a room
    if (!this.roomId) {
      SignalingLog.debug('Already left room, skipping')
      return
    }
    
    // Prevent concurrent leave operations
    if (this.isLeaving) {
      SignalingLog.warn('Leave already in progress, ignoring')
      return
    }
    
    this.isLeaving = true
    
    try {
      SignalingLog.info('Leaving room', { roomId: this.roomId, sessionId: this.sessionId })
      
      this.stopAnnounceInterval()
      
      // Send leave message only if connected
      if (this.mqtt?.isConnected()) {
        this.broadcast({ v: 1, type: 'leave', from: selfId, sessionId: this.sessionId })
      }
      
      // Close all peer connections with error handling
      this.peers.forEach((peer, peerId) => {
        try {
          peer.pc.close()
        } catch (err) {
          PeerLog.warn('Error closing peer connection', { peerId, error: String(err) })
        }
      })
      this.peers.clear()
      this.pendingCandidates.clear()
      
      // Disconnect all MQTT brokers
      if (this.mqtt) {
        this.mqtt.disconnect()
        this.mqtt = null
      }
      
      // Close BroadcastChannel
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.close()
        } catch {}
        this.broadcastChannel = null
      }
      
      this.roomId = null
      this.topic = ''
      this.localStream = null
      this.localMuteStatus = { micMuted: false, speakerMuted: false }
      this.updateSignalingState('idle')
      
      SignalingLog.info('Left room successfully')
    } finally {
      this.isLeaving = false
    }
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
        sender.replaceTrack(newTrack).catch(() => PeerLog.error('Replace track failed', { peerId }))
      }
    })
  }

  getDebugInfo(): object {
    return {
      selfId, 
      roomId: this.roomId, 
      userName: this.userName,
      topic: this.topic,
      sessionId: this.sessionId,
      signalingState: this.signalingState,
      mqttConnected: this.mqtt?.isConnected() || false,
      mqttSubscribed: this.mqtt?.isSubscribed() || false,
      mqttBrokerCount: this.mqtt?.getConnectedCount() || 0,
      mqttBrokerStatus: this.mqtt?.getConnectionStatus() || [],
      mqttMessagesReceived: this.mqtt?.getTotalMessageCount() || 0,
      mqttDedupCacheSize: this.mqtt?.getDeduplicatorSize() || 0,
      peerCount: this.peers.size,
      peers: Array.from(this.peers.keys()),
      localMuteStatus: this.localMuteStatus,
      isJoining: this.isJoining,
      isLeaving: this.isLeaving
    }
  }
}

export const peerManager = new SimplePeerManager()
