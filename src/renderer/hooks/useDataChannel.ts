/**
 * useDataChannel Hook
 * Manages chat message state over WebRTC DataChannels.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { selfId } from '../signaling'
import type { PeerManager } from '../signaling'
import type { ChatMessage } from '@/types'

export const MAX_CHAT_MESSAGE_LENGTH = 5000

type ChatManager = Pick<PeerManager, 'setOnChatMessage' | 'sendChatMessage'>

interface UseDataChannelOptions {
  p2pManager: ChatManager
  userName: string
  isChatOpen: boolean
  onMessageTooLong?: () => void
}

interface UseDataChannelResult {
  messages: ChatMessage[]
  unreadCount: number
  sendMessage: (content: string) => boolean
  addSystemMessage: (content: string) => void
  markAsRead: () => void
  reset: () => void
}

export function useDataChannel({
  p2pManager,
  userName,
  isChatOpen,
  onMessageTooLong
}: UseDataChannelOptions): UseDataChannelResult {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const isChatOpenRef = useRef(isChatOpen)

  useEffect(() => {
    isChatOpenRef.current = isChatOpen
  }, [isChatOpen])

  useEffect(() => {
    p2pManager.setOnChatMessage((message: ChatMessage) => {
      setMessages(prev => [...prev, message])
      if (!isChatOpenRef.current) {
        setUnreadCount(prev => prev + 1)
      }
    })

    return () => {
      p2pManager.setOnChatMessage(null)
    }
  }, [p2pManager])

  const sendMessage = useCallback((content: string): boolean => {
    const text = content.trim()
    if (!text) return false

    if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
      onMessageTooLong?.()
      return false
    }

    p2pManager.sendChatMessage(text, userName)

    const now = Date.now()
    setMessages(prev => [
      ...prev,
      {
        id: `local-${now}-${Math.random().toString(36).slice(2)}`,
        senderId: selfId,
        senderName: userName,
        content: text,
        timestamp: now,
        type: 'text'
      }
    ])
    return true
  }, [onMessageTooLong, p2pManager, userName])

  const addSystemMessage = useCallback((content: string) => {
    const now = Date.now()
    setMessages(prev => [
      ...prev,
      {
        id: `system-${now}-${Math.random().toString(36).slice(2)}`,
        senderId: 'system',
        senderName: 'System',
        content,
        timestamp: now,
        type: 'system'
      }
    ])
    if (!isChatOpenRef.current) {
      setUnreadCount(prev => prev + 1)
    }
  }, [])

  const markAsRead = useCallback(() => {
    setUnreadCount(0)
  }, [])

  const reset = useCallback(() => {
    setMessages([])
    setUnreadCount(0)
  }, [])

  return {
    messages,
    unreadCount,
    sendMessage,
    addSystemMessage,
    markAsRead,
    reset
  }
}
