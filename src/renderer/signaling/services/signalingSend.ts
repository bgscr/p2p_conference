import { SignalingLog } from '../../utils/Logger'

interface MqttPublisher {
  isConnected(): boolean
  publish(topic: string, message: string): number
}

type SignalLikeMessage = {
  type: string
  to?: string
  sessionId?: number
  msgId?: string
}

interface BroadcastSignalMessageOptions<TMessage extends SignalLikeMessage> {
  message: TMessage
  topic: string
  mqtt: MqttPublisher | null
  broadcastChannel: BroadcastChannel | null
  createMessageId: () => string
}

interface SendSignalMessageToPeerOptions<TMessage extends SignalLikeMessage> {
  peerId: string
  message: TMessage
  sessionId: number
  createMessageId: () => string
  broadcastMessage: (message: TMessage) => void
}

export function broadcastSignalMessage<TMessage extends SignalLikeMessage>(
  options: BroadcastSignalMessageOptions<TMessage>
): void {
  const {
    message,
    topic,
    mqtt,
    broadcastChannel,
    createMessageId
  } = options

  if (!message.msgId) {
    message.msgId = createMessageId()
  }

  const jsonStr = JSON.stringify(message)
  const sentVia: string[] = []

  if (mqtt?.isConnected()) {
    const publishCount = mqtt.publish(topic, jsonStr)
    if (publishCount > 0) {
      sentVia.push(`MQTT(${publishCount} brokers)`)
    }
  }

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(message)
      sentVia.push('BroadcastChannel')
    } catch {
      // BroadcastChannel may already be closed.
    }
  }

  if (message.type !== 'ping' && message.type !== 'pong' && message.type !== 'mute-status') {
    SignalingLog.debug('Message broadcast', {
      type: message.type,
      to: message.to || 'all',
      sentVia,
      size: jsonStr.length
    })
  }
}

export function sendSignalMessageToPeer<TMessage extends SignalLikeMessage>(
  options: SendSignalMessageToPeerOptions<TMessage>
): void {
  const {
    peerId,
    message,
    sessionId,
    createMessageId,
    broadcastMessage
  } = options

  message.to = peerId
  message.sessionId = sessionId
  if (!message.msgId) {
    message.msgId = createMessageId()
  }

  broadcastMessage(message)
}
