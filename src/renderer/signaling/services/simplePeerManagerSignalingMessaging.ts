import type { SignalMessage } from '../simplePeerManagerTypes'
import {
  broadcastSignalMessage,
  sendSignalMessageToPeer
} from './signalingSend'

interface SimplePeerManagerBroadcastRuntime {
  topic: string
  mqtt: {
    isConnected(): boolean
    publish(topic: string, message: string): number
  } | null
  broadcastChannel: BroadcastChannel | null
  createMessageId: () => string
}

interface BroadcastSimplePeerManagerMessageOptions extends SimplePeerManagerBroadcastRuntime {
  message: SignalMessage
}

interface SendSimplePeerManagerMessageToPeerOptions {
  peerId: string
  message: SignalMessage
  sessionId: number
  createMessageId: () => string
  broadcastMessage: (message: SignalMessage) => void
}

interface SendSimplePeerManagerPongOptions {
  peerId: string
  selfId: string
  sendToPeer: (peerId: string, message: SignalMessage) => void
}

export function broadcastSimplePeerManagerMessage(
  options: BroadcastSimplePeerManagerMessageOptions
): void {
  const {
    message,
    topic,
    mqtt,
    broadcastChannel,
    createMessageId
  } = options

  broadcastSignalMessage({
    message,
    topic,
    mqtt,
    broadcastChannel,
    createMessageId
  })
}

export function sendSimplePeerManagerMessageToPeer(
  options: SendSimplePeerManagerMessageToPeerOptions
): void {
  const {
    peerId,
    message,
    sessionId,
    createMessageId,
    broadcastMessage
  } = options

  sendSignalMessageToPeer({
    peerId,
    message,
    sessionId,
    createMessageId,
    broadcastMessage
  })
}

export function sendSimplePeerManagerPong(
  options: SendSimplePeerManagerPongOptions
): void {
  const {
    peerId,
    selfId,
    sendToPeer
  } = options

  sendToPeer(peerId, { v: 1, type: 'pong', from: selfId })
}
