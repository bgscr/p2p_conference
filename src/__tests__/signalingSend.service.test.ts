import { beforeEach, describe, expect, it, vi } from 'vitest'

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: loggerMocks
}))

import {
  broadcastSignalMessage,
  sendSignalMessageToPeer
} from '../renderer/signaling/services/signalingSend'

type SignalMessageLike = {
  type: string
  msgId?: string
  to?: string
  sessionId?: number
}

describe('signalingSend service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('broadcasts via mqtt + broadcast channel and assigns msgId when missing', () => {
    const mqtt = {
      isConnected: vi.fn().mockReturnValue(true),
      publish: vi.fn().mockReturnValue(2)
    }
    const broadcastChannel = { postMessage: vi.fn() } as unknown as BroadcastChannel
    const message: SignalMessageLike = { type: 'announce' }

    broadcastSignalMessage({
      message,
      topic: 'p2p-conf/test-room',
      mqtt,
      broadcastChannel,
      createMessageId: () => 'msg-1'
    })

    expect(message.msgId).toBe('msg-1')
    expect(mqtt.publish).toHaveBeenCalledWith(
      'p2p-conf/test-room',
      expect.stringContaining('"msgId":"msg-1"')
    )
    expect((broadcastChannel as any).postMessage).toHaveBeenCalledWith(message)
    expect(loggerMocks.debug).toHaveBeenCalledWith(
      'Message broadcast',
      expect.objectContaining({ type: 'announce' })
    )
  })

  it('suppresses debug logging for ping/pong/mute-status messages', () => {
    const broadcastChannel = { postMessage: vi.fn() } as unknown as BroadcastChannel
    const createMessageId = () => 'msg-suppressed'

    for (const type of ['ping', 'pong', 'mute-status'] as const) {
      broadcastSignalMessage({
        message: { type },
        topic: 'p2p-conf/test-room',
        mqtt: null,
        broadcastChannel,
        createMessageId
      })
    }

    expect(loggerMocks.debug).not.toHaveBeenCalled()
  })

  it('tolerates broadcast channel postMessage errors', () => {
    const broadcastChannel = {
      postMessage: vi.fn(() => {
        throw new Error('channel closed')
      })
    } as unknown as BroadcastChannel

    expect(() => {
      broadcastSignalMessage({
        message: { type: 'announce' },
        topic: 'p2p-conf/test-room',
        mqtt: null,
        broadcastChannel,
        createMessageId: () => 'msg-err'
      })
    }).not.toThrow()
  })

  it('routes message to target peer with session metadata', () => {
    const broadcastMessage = vi.fn()
    const message: SignalMessageLike = { type: 'ping' }

    sendSignalMessageToPeer({
      peerId: 'peer-a',
      message,
      sessionId: 42,
      createMessageId: () => 'msg-peer',
      broadcastMessage
    })

    expect(message.to).toBe('peer-a')
    expect(message.sessionId).toBe(42)
    expect(message.msgId).toBe('msg-peer')
    expect(broadcastMessage).toHaveBeenCalledWith(message)
  })

  it('preserves explicit msgId for targeted send', () => {
    const broadcastMessage = vi.fn()
    const message: SignalMessageLike = { type: 'announce', msgId: 'existing-id' }

    sendSignalMessageToPeer({
      peerId: 'peer-b',
      message,
      sessionId: 77,
      createMessageId: () => 'new-id',
      broadcastMessage
    })

    expect(message.msgId).toBe('existing-id')
    expect(message.to).toBe('peer-b')
    expect(message.sessionId).toBe(77)
  })
})
