import { SignalingLog } from '../../utils/Logger'
import { getMqttBrokers } from './credentials'

// Local ID for MQTT client-id suffixing in this transport module.
const createTransportId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

const selfId = createTransportId()

const MQTT_KEEPALIVE = 20000
const MQTT_CONNECT_TIMEOUT = 8000

const MESSAGE_DEDUP_WINDOW_SIZE = 500
const MESSAGE_DEDUP_TTL_MS = 30000
const DUPLICATE_LOG_FLUSH_INTERVAL_MS = 15000
const DUPLICATE_LOG_EARLY_FLUSH_THRESHOLD = 200
const DUPLICATE_LOG_TOP_IDS_LIMIT = 5

const RECONNECT_BASE_DELAY = 2000
const RECONNECT_MAX_DELAY = 30000
const RECONNECT_MAX_ATTEMPTS = 5

/**
 * Message deduplication cache using a sliding window with TTL
 * Prevents processing the same message received from multiple brokers
 */
export class MessageDeduplicator {
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
  public cleanup() {
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
export class MQTTClient {
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
      let _remainingLength = 0

      while (idx < data.length) {
        const byte = data[idx]
        _remainingLength += (byte & 0x7F) * multiplier
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
      } catch { /* ignore send errors on disconnect */ }
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
export class MultiBrokerMQTT {
  private clients: Map<string, MQTTClient> = new Map()  // brokerUrl -> client
  private topic: string = ''
  private onMessage: ((payload: string) => void) | null = null
  private deduplicator: MessageDeduplicator = new MessageDeduplicator()
  private reconnectAttempts: Map<string, number> = new Map()
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map()
  private isShuttingDown = false
  private onReconnect: ((brokerUrl: string) => void) | null = null
  private duplicateLogCounts: Map<string, number> = new Map()
  private duplicateLogTotal = 0
  private duplicateLogWindowStart: number | null = null
  private duplicateLogFlushTimer: NodeJS.Timeout | null = null

  /**
   * Set callback for broker reconnection events
   * This is called when a broker successfully reconnects and resubscribes
   */
  setOnReconnect(callback: (brokerUrl: string) => void) {
    this.onReconnect = callback
  }

  /**
   * Connect to all configured MQTT brokers in parallel
   * @returns Array of successfully connected broker URLs
   */
  async connectAll(): Promise<string[]> {
    this.isShuttingDown = false
    const connectedBrokers: string[] = []
    const brokerConfigs = getMqttBrokers()

    SignalingLog.info('Connecting to all MQTT brokers', { count: brokerConfigs.length })

    // Connect to all brokers in parallel
    const results = await Promise.allSettled(
      brokerConfigs.map(async (brokerConfig) => {
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
      total: brokerConfigs.length,
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

            // Trigger a re-announce event so SimplePeerManager can re-broadcast presence
            // This helps with network recovery scenarios
            if (this.onReconnect) {
              SignalingLog.info('Triggering reconnection callback for re-announcement')
              this.onReconnect(brokerUrl)
            }
          } else {
            SignalingLog.warn('MQTT broker reconnected but subscribe failed', { broker: brokerUrl })
          }
        }
      } catch (err) {
        SignalingLog.warn('MQTT reconnection failed', { broker: brokerUrl, attempt: attempts, error: String(err) })
        // Schedule another retry since this attempt failed
        if (!this.isShuttingDown) {
          this.handleBrokerDisconnect(brokerUrl, username, password)
        }
      }
    }, delay)

    this.reconnectTimers.set(brokerUrl, timer)
  }

  private clearDuplicateLogTimer() {
    if (this.duplicateLogFlushTimer) {
      clearTimeout(this.duplicateLogFlushTimer)
      this.duplicateLogFlushTimer = null
    }
  }

  private resetDuplicateLogState() {
    this.clearDuplicateLogTimer()
    this.duplicateLogCounts.clear()
    this.duplicateLogTotal = 0
    this.duplicateLogWindowStart = null
  }

  private flushDuplicateLogSummary(reason: 'interval' | 'threshold' | 'shutdown' | 'resubscribe') {
    if (this.duplicateLogTotal === 0) {
      this.clearDuplicateLogTimer()
      return
    }

    const now = Date.now()
    const windowMs = this.duplicateLogWindowStart ? now - this.duplicateLogWindowStart : 0
    const topMsgIds = Array
      .from(this.duplicateLogCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, DUPLICATE_LOG_TOP_IDS_LIMIT)
      .map(([msgId, count]) => ({ msgId, count }))

    SignalingLog.debug('Duplicate messages filtered (throttled)', {
      reason,
      filteredCount: this.duplicateLogTotal,
      uniqueMsgIds: this.duplicateLogCounts.size,
      windowMs,
      topMsgIds
    })

    this.resetDuplicateLogState()
  }

  private recordDuplicateMessage(msgId: string) {
    const shortMsgId = msgId.substring(0, 20)
    this.duplicateLogTotal++
    this.duplicateLogCounts.set(shortMsgId, (this.duplicateLogCounts.get(shortMsgId) || 0) + 1)

    // Keep one immediate breadcrumb so the log still shows that throttling kicked in.
    if (!this.duplicateLogWindowStart) {
      this.duplicateLogWindowStart = Date.now()
      SignalingLog.debug('Duplicate message detected (throttling enabled)', { msgId: shortMsgId })
    }

    if (this.duplicateLogTotal >= DUPLICATE_LOG_EARLY_FLUSH_THRESHOLD) {
      this.flushDuplicateLogSummary('threshold')
      return
    }

    if (!this.duplicateLogFlushTimer) {
      this.duplicateLogFlushTimer = setTimeout(() => {
        this.flushDuplicateLogSummary('interval')
      }, DUPLICATE_LOG_FLUSH_INTERVAL_MS)
    }
  }

  /**
   * Subscribe to a topic on all connected brokers
   * @returns Number of successful subscriptions
   */
  async subscribeAll(topic: string, callback: (message: string) => void): Promise<number> {
    this.topic = topic
    this.flushDuplicateLogSummary('resubscribe')

    // Wrap callback with deduplication
    this.onMessage = (payload: string) => {
      try {
        const data = JSON.parse(payload)
        const msgId = data.msgId

        // Check for duplicates
        if (msgId && this.deduplicator.isDuplicate(msgId)) {
          this.recordDuplicateMessage(msgId)
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
    this.flushDuplicateLogSummary('shutdown')

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
    this.resetDuplicateLogState()

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
