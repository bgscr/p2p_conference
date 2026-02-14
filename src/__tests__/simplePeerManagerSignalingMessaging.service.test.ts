import { describe, expect, it, vi } from 'vitest'

import type { SignalMessage } from '../renderer/signaling/simplePeerManagerTypes'
import {
  broadcastSimplePeerManagerMessage,
  sendSimplePeerManagerMessageToPeer,
  sendSimplePeerManagerPong
} from '../renderer/signaling/services/simplePeerManagerSignalingMessaging'

describe('simplePeerManagerSignalingMessaging service', () => {
  it('broadcasts message and assigns msgId when missing', () => {
    const publish = vi.fn().mockReturnValue(1)
    const mqtt = {
      isConnected: vi.fn().mockReturnValue(true),
      publish
    }
    const postMessage = vi.fn()
    const broadcastChannel = { postMessage } as unknown as BroadcastChannel
    const message: SignalMessage = {
      v: 1,
      type: 'announce',
      from: 'self-a'
    }

    broadcastSimplePeerManagerMessage({
      message,
      topic: 'p2p-conf/room-a',
      mqtt,
      broadcastChannel,
      createMessageId: () => 'msg-a'
    })

    expect(message.msgId).toBe('msg-a')
    expect(mqtt.isConnected).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith('p2p-conf/room-a', expect.stringContaining('"msgId":"msg-a"'))
    expect(postMessage).toHaveBeenCalledWith(message)
  })

  it('routes targeted peer message with session and msgId metadata', () => {
    const broadcastMessage = vi.fn()
    const message: SignalMessage = {
      v: 1,
      type: 'ping',
      from: 'self-a'
    }

    sendSimplePeerManagerMessageToPeer({
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

  it('preserves explicit msgId when routing targeted message', () => {
    const broadcastMessage = vi.fn()
    const message: SignalMessage = {
      v: 1,
      type: 'announce',
      from: 'self-a',
      msgId: 'existing-id'
    }

    sendSimplePeerManagerMessageToPeer({
      peerId: 'peer-b',
      message,
      sessionId: 77,
      createMessageId: () => 'new-id',
      broadcastMessage
    })

    expect(message.msgId).toBe('existing-id')
    expect(message.to).toBe('peer-b')
    expect(message.sessionId).toBe(77)
    expect(broadcastMessage).toHaveBeenCalledWith(message)
  })

  it('sends pong through peer-targeted sender', () => {
    const sendToPeer = vi.fn()

    sendSimplePeerManagerPong({
      peerId: 'peer-z',
      selfId: 'self-z',
      sendToPeer
    })

    expect(sendToPeer).toHaveBeenCalledWith('peer-z', {
      v: 1,
      type: 'pong',
      from: 'self-z'
    })
  })
})
