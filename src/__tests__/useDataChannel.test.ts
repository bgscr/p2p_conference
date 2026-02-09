/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDataChannel, MAX_CHAT_MESSAGE_LENGTH } from '../renderer/hooks/useDataChannel'
import { SimplePeerManager } from '../renderer/signaling/SimplePeerManager'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  PeerLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

class MockRTCDataChannel {
  public label: string
  public readyState: 'open' | 'closed' = 'open'
  public onopen: (() => void) | null = null
  public onclose: (() => void) | null = null
  public onerror: ((event: any) => void) | null = null
  public onmessage: ((event: any) => void) | null = null
  public send = vi.fn()

  constructor(label: string) {
    this.label = label
  }

  close() {
    this.readyState = 'closed'
    this.onclose?.()
  }
}

class MockRTCPeerConnection {
  public onicecandidate: ((event: any) => void) | null = null
  public oniceconnectionstatechange: (() => void) | null = null
  public onconnectionstatechange: (() => void) | null = null
  public ontrack: ((event: any) => void) | null = null
  public ondatachannel: ((event: any) => void) | null = null
  public connectionState: RTCPeerConnectionState = 'new'
  public iceConnectionState: RTCIceConnectionState = 'new'
  public localDescription: RTCSessionDescription | null = null
  public remoteDescription: RTCSessionDescription | null = null
  private senders: any[] = []
  public createDataChannel = vi.fn((label: string) => new MockRTCDataChannel(label) as unknown as RTCDataChannel)
  public createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'v=0' }))
  public createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'v=0' }))
  public setLocalDescription = vi.fn(async (desc: any) => { this.localDescription = desc })
  public setRemoteDescription = vi.fn(async (desc: any) => { this.remoteDescription = desc })
  public addIceCandidate = vi.fn(async () => { })
  public addTrack = vi.fn((track: any) => {
    const sender = {
      track,
      replaceTrack: vi.fn().mockResolvedValue(undefined),
      getParameters: vi.fn().mockReturnValue({ codecs: [{ mimeType: `${track.kind}/opus` }] })
    }
    this.senders.push(sender)
    return sender
  })
  public getSenders = vi.fn(() => this.senders)
  public getStats = vi.fn(async () => new Map())
  public close = vi.fn()
}

describe('SimplePeerManager DataChannel', () => {
  const originalRTCPeerConnection = (globalThis as any).RTCPeerConnection

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).RTCPeerConnection = MockRTCPeerConnection as any
  })

  afterEach(() => {
    ;(globalThis as any).RTCPeerConnection = originalRTCPeerConnection
  })

  it('creates DataChannel only on initiator peer connections', () => {
    const manager = new SimplePeerManager()
    const managerAny = manager as any

    const initiatorPc = managerAny.createPeerConnection('peer-1', 'Alice', 'win', true) as any
    const responderPc = managerAny.createPeerConnection('peer-2', 'Bob', 'win', false) as any

    expect(initiatorPc.createDataChannel).toHaveBeenCalledWith('chat', { ordered: true })
    expect(responderPc.createDataChannel).not.toHaveBeenCalled()
    expect(managerAny.peers.get('peer-1').dataChannel).toBeTruthy()
    expect(managerAny.peers.get('peer-2').dataChannel).toBeNull()
  })

  it('handles ondatachannel on responder side', () => {
    const manager = new SimplePeerManager()
    const managerAny = manager as any

    const responderPc = managerAny.createPeerConnection('peer-r', 'Bob', 'win', false) as any
    const incomingChannel = new MockRTCDataChannel('chat') as unknown as RTCDataChannel

    responderPc.ondatachannel?.({ channel: incomingChannel })

    expect(managerAny.peers.get('peer-r').dataChannel).toBe(incomingChannel)
  })

  it('sendChatMessage broadcasts to all connected data channels', () => {
    const manager = new SimplePeerManager()
    const managerAny = manager as any

    managerAny.createPeerConnection('p1', 'P1', 'win', true)
    managerAny.createPeerConnection('p2', 'P2', 'win', true)

    const channel1 = managerAny.peers.get('p1').dataChannel as MockRTCDataChannel
    const channel2 = managerAny.peers.get('p2').dataChannel as MockRTCDataChannel

    manager.sendChatMessage('hello', 'Alice')

    expect(channel1.send).toHaveBeenCalledTimes(1)
    expect(channel2.send).toHaveBeenCalledTimes(1)
  })

  it('handles edge cases for chat payloads and channel lifecycle', () => {
    const manager = new SimplePeerManager()
    const managerAny = manager as any
    const onMessage = vi.fn()
    manager.setOnChatMessage(onMessage)

    managerAny.createPeerConnection('p1', 'P1', 'win', true)
    const peer = managerAny.peers.get('p1')
    const channel = peer.dataChannel as MockRTCDataChannel

    manager.sendChatMessage('x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 20), 'Alice')
    const sentPayload = JSON.parse(channel.send.mock.calls[0][0])
    expect(sentPayload.content.length).toBe(MAX_CHAT_MESSAGE_LENGTH)

    // Valid incoming message
    channel.onmessage?.({
      data: JSON.stringify({
        type: 'chat',
        id: 'm1',
        senderId: 'peer-x',
        senderName: 'Peer X',
        content: 'hello',
        timestamp: Date.now()
      })
    })

    // Malformed message should be ignored
    channel.onmessage?.({ data: '{not-json' })

    // Rapid successive messages
    for (let i = 0; i < 5; i++) {
      channel.onmessage?.({
        data: JSON.stringify({
          type: 'chat',
          id: `m-${i}`,
          senderId: 'peer-x',
          senderName: 'Peer X',
          content: `msg-${i}`,
          timestamp: Date.now()
        })
      })
    }

    // Channel closes mid-conversation
    channel.close()
    expect(peer.dataChannel).toBeNull()
    expect(onMessage).toHaveBeenCalledTimes(6)

    // No peers connected should not throw
    managerAny.peers.clear()
    expect(() => manager.sendChatMessage('still-safe', 'Alice')).not.toThrow()
  })
})

describe('useDataChannel hook', () => {
  let chatCallback: ((msg: any) => void) | null = null
  const managerMock = {
    setOnChatMessage: vi.fn((cb: ((msg: any) => void) | null) => {
      chatCallback = cb
    }),
    sendChatMessage: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    chatCallback = null
  })

  it('stores incoming messages, tracks unread count, and resets unread state', () => {
    const { result } = renderHook(() =>
      useDataChannel({
        p2pManager: managerMock as any,
        userName: 'Alice',
        isChatOpen: false
      })
    )

    act(() => {
      chatCallback?.({
        id: 'm1',
        senderId: 'peer-1',
        senderName: 'Bob',
        content: 'hello',
        timestamp: Date.now(),
        type: 'text'
      })
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.unreadCount).toBe(1)

    act(() => {
      result.current.markAsRead()
    })
    expect(result.current.unreadCount).toBe(0)
  })

  it('sends messages and supports rapid successive receives', () => {
    const { result } = renderHook(() =>
      useDataChannel({
        p2pManager: managerMock as any,
        userName: 'Alice',
        isChatOpen: false
      })
    )

    act(() => {
      const sent = result.current.sendMessage('Hi team')
      expect(sent).toBe(true)
    })

    expect(managerMock.sendChatMessage).toHaveBeenCalledWith('Hi team', 'Alice')
    expect(result.current.messages[0].content).toBe('Hi team')

    act(() => {
      for (let i = 0; i < 10; i++) {
        chatCallback?.({
          id: `rapid-${i}`,
          senderId: 'peer-1',
          senderName: 'Bob',
          content: `r-${i}`,
          timestamp: Date.now(),
          type: 'text'
        })
      }
    })

    expect(result.current.messages).toHaveLength(11)
    expect(result.current.unreadCount).toBe(10)
  })

  it('handles oversized messages, open-chat unread behavior, and reset', () => {
    const onMessageTooLong = vi.fn()
    const { result, rerender } = renderHook(
      ({ isChatOpen }) =>
        useDataChannel({
          p2pManager: managerMock as any,
          userName: 'Alice',
          isChatOpen,
          onMessageTooLong
        }),
      { initialProps: { isChatOpen: false } }
    )

    act(() => {
      const sent = result.current.sendMessage('x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1))
      expect(sent).toBe(false)
    })

    expect(onMessageTooLong).toHaveBeenCalledTimes(1)
    expect(managerMock.sendChatMessage).not.toHaveBeenCalled()

    rerender({ isChatOpen: true })
    act(() => {
      chatCallback?.({
        id: 'open-msg',
        senderId: 'peer-1',
        senderName: 'Bob',
        content: 'visible',
        timestamp: Date.now(),
        type: 'text'
      })
    })
    expect(result.current.unreadCount).toBe(0)

    act(() => {
      result.current.reset()
    })
    expect(result.current.messages).toHaveLength(0)
    expect(result.current.unreadCount).toBe(0)
  })

  it('rejects blank messages and clears callback on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useDataChannel({
        p2pManager: managerMock as any,
        userName: 'Alice',
        isChatOpen: false
      })
    )

    act(() => {
      const sent = result.current.sendMessage('   ')
      expect(sent).toBe(false)
    })
    expect(managerMock.sendChatMessage).not.toHaveBeenCalled()

    unmount()
    expect(managerMock.setOnChatMessage).toHaveBeenLastCalledWith(null)
  })

  it('adds system messages and updates unread only when chat is closed', () => {
    const { result, rerender } = renderHook(
      ({ isChatOpen }) =>
        useDataChannel({
          p2pManager: managerMock as any,
          userName: 'Alice',
          isChatOpen
        }),
      { initialProps: { isChatOpen: false } }
    )

    act(() => {
      result.current.addSystemMessage('Bob joined')
    })
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].type).toBe('system')
    expect(result.current.unreadCount).toBe(1)

    rerender({ isChatOpen: true })
    act(() => {
      result.current.addSystemMessage('Bob left')
    })
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1].type).toBe('system')
    expect(result.current.unreadCount).toBe(1)
  })
})
