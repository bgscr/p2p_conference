import { createServer, type Server as HttpServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'

interface LocalMqttBrokerOptions {
  host: string
  port: number
  path: string
}

interface MqttPacketReadResult {
  packet: Uint8Array
  nextOffset: number
}

interface MqttClientState {
  socket: WebSocket
  buffer: Uint8Array
  subscriptions: Set<string>
}

export interface LocalMqttBrokerHandle {
  url: string
  stop: () => Promise<void>
}

const DEFAULT_BROKER_OPTIONS: LocalMqttBrokerOptions = {
  host: '127.0.0.1',
  port: 18884,
  path: '/mqtt'
}

function encodeRemainingLength(length: number): Uint8Array {
  const encoded: number[] = []
  let value = length
  do {
    let byte = value % 128
    value = Math.floor(value / 128)
    if (value > 0) {
      byte |= 0x80
    }
    encoded.push(byte)
  } while (value > 0)
  return new Uint8Array(encoded)
}

function decodeRemainingLength(buffer: Uint8Array, startIndex: number): { value: number; bytesRead: number } | null {
  let multiplier = 1
  let value = 0
  let bytesRead = 0
  let index = startIndex

  while (index < buffer.length) {
    const byte = buffer[index]
    value += (byte & 0x7f) * multiplier
    bytesRead++
    index++

    if ((byte & 0x80) === 0) {
      return { value, bytesRead }
    }

    multiplier *= 128
    if (bytesRead >= 4) {
      return null
    }
  }

  return null
}

function tryReadPacket(buffer: Uint8Array): MqttPacketReadResult | null {
  if (buffer.length < 2) {
    return null
  }

  const remaining = decodeRemainingLength(buffer, 1)
  if (!remaining) {
    return null
  }

  const headerLength = 1 + remaining.bytesRead
  const packetLength = headerLength + remaining.value
  if (buffer.length < packetLength) {
    return null
  }

  return {
    packet: buffer.slice(0, packetLength),
    nextOffset: packetLength
  }
}

function appendBuffer(existing: Uint8Array, incoming: Uint8Array): Uint8Array {
  const merged = new Uint8Array(existing.length + incoming.length)
  merged.set(existing)
  merged.set(incoming, existing.length)
  return merged
}

function buildConnAckPacket(): Uint8Array {
  return new Uint8Array([0x20, 0x02, 0x00, 0x00])
}

function buildSubAckPacket(packetId: number): Uint8Array {
  return new Uint8Array([
    0x90,
    0x03,
    (packetId >> 8) & 0xff,
    packetId & 0xff,
    0x00
  ])
}

function buildPingRespPacket(): Uint8Array {
  return new Uint8Array([0xd0, 0x00])
}

function buildPublishPacket(topic: string, payload: Uint8Array): Uint8Array {
  const topicBytes = new TextEncoder().encode(topic)
  const variableHeaderLength = 2 + topicBytes.length
  const remainingLength = variableHeaderLength + payload.length
  const remainingLengthBytes = encodeRemainingLength(remainingLength)

  const packet = new Uint8Array(1 + remainingLengthBytes.length + remainingLength)
  let offset = 0
  packet[offset++] = 0x30
  packet.set(remainingLengthBytes, offset)
  offset += remainingLengthBytes.length
  packet[offset++] = (topicBytes.length >> 8) & 0xff
  packet[offset++] = topicBytes.length & 0xff
  packet.set(topicBytes, offset)
  offset += topicBytes.length
  packet.set(payload, offset)
  return packet
}

function readUint16(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] << 8) | buffer[offset + 1]
}

export async function startLocalMqttBroker(
  options: Partial<LocalMqttBrokerOptions> = {}
): Promise<LocalMqttBrokerHandle> {
  const config: LocalMqttBrokerOptions = {
    ...DEFAULT_BROKER_OPTIONS,
    ...options
  }

  const clients = new Set<MqttClientState>()
  const subscribersByTopic = new Map<string, Set<MqttClientState>>()
  const httpServer: HttpServer = createServer()
  const wsServer = new WebSocketServer({ server: httpServer, path: config.path })

  const removeClient = (client: MqttClientState) => {
    clients.delete(client)
    client.subscriptions.forEach((topic) => {
      const subscribers = subscribersByTopic.get(topic)
      if (!subscribers) {
        return
      }
      subscribers.delete(client)
      if (subscribers.size === 0) {
        subscribersByTopic.delete(topic)
      }
    })
    client.subscriptions.clear()
    client.buffer = new Uint8Array(0)
  }

  const onPublishPacket = (publisher: MqttClientState, packet: Uint8Array, fixedHeaderLength: number) => {
    let offset = fixedHeaderLength
    if (packet.length < offset + 2) {
      return
    }

    const topicLength = readUint16(packet, offset)
    offset += 2
    if (packet.length < offset + topicLength) {
      return
    }

    const topic = new TextDecoder().decode(packet.slice(offset, offset + topicLength))
    offset += topicLength
    const payload = packet.slice(offset)

    const subscribers = subscribersByTopic.get(topic)
    if (!subscribers || subscribers.size === 0) {
      return
    }

    const publishPacket = buildPublishPacket(topic, payload)
    subscribers.forEach((client) => {
      if (client.socket.readyState === client.socket.OPEN) {
        client.socket.send(publishPacket)
      }
    })

    // Keep publisher subscribed behavior explicit for readability.
    void publisher
  }

  const onSubscribePacket = (client: MqttClientState, packet: Uint8Array, fixedHeaderLength: number) => {
    let offset = fixedHeaderLength
    if (packet.length < offset + 2) {
      return
    }

    const packetId = readUint16(packet, offset)
    offset += 2

    while (offset + 2 <= packet.length) {
      const topicLength = readUint16(packet, offset)
      offset += 2
      if (offset + topicLength > packet.length) {
        break
      }

      const topic = new TextDecoder().decode(packet.slice(offset, offset + topicLength))
      offset += topicLength

      // Skip requested QoS byte.
      if (offset >= packet.length) {
        break
      }
      offset += 1

      client.subscriptions.add(topic)
      const subscribers = subscribersByTopic.get(topic) ?? new Set<MqttClientState>()
      subscribers.add(client)
      subscribersByTopic.set(topic, subscribers)
    }

    client.socket.send(buildSubAckPacket(packetId))
  }

  const processPacket = (client: MqttClientState, packet: Uint8Array) => {
    const packetType = packet[0] >> 4
    const remaining = decodeRemainingLength(packet, 1)
    if (!remaining) {
      return
    }
    const fixedHeaderLength = 1 + remaining.bytesRead

    switch (packetType) {
      case 1: // CONNECT
        client.socket.send(buildConnAckPacket())
        break
      case 3: // PUBLISH
        onPublishPacket(client, packet, fixedHeaderLength)
        break
      case 8: // SUBSCRIBE
        onSubscribePacket(client, packet, fixedHeaderLength)
        break
      case 12: // PINGREQ
        client.socket.send(buildPingRespPacket())
        break
      case 14: // DISCONNECT
        client.socket.close()
        break
      default:
        break
    }
  }

  wsServer.on('connection', (socket) => {
    const client: MqttClientState = {
      socket,
      buffer: new Uint8Array(0),
      subscriptions: new Set<string>()
    }
    clients.add(client)

    socket.on('message', (data) => {
      const chunk = data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer)
      client.buffer = appendBuffer(client.buffer, chunk)

      while (true) {
        const readResult = tryReadPacket(client.buffer)
        if (!readResult) {
          break
        }

        processPacket(client, readResult.packet)
        client.buffer = client.buffer.slice(readResult.nextOffset)
      }
    })

    socket.on('close', () => {
      removeClient(client)
    })

    socket.on('error', () => {
      removeClient(client)
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  const stop = async () => {
    await new Promise<void>((resolve) => {
      wsServer.clients.forEach((client) => {
        try {
          client.close()
        } catch {
          // Ignore close errors during shutdown.
        }
      })

      wsServer.close(() => {
        httpServer.close(() => resolve())
      })
    })
  }

  return {
    url: `ws://${config.host}:${config.port}${config.path}`,
    stop
  }
}
