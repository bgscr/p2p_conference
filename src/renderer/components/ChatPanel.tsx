/**
 * ChatPanel Component
 * Slide-in panel for real-time text chat via WebRTC DataChannels
 */

import React, { useState, useRef, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import type { ChatMessage } from '@/types'

interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage: (content: string) => void
  onClose: () => void
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onClose
}) => {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Focus input when panel opens
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    onSendMessage(trimmed)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col h-full" data-testid="chat-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="font-medium text-gray-900">{t('chat.title')}</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          data-testid="chat-close-btn"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8" data-testid="chat-empty">
            {t('chat.noMessages')}
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} data-testid="chat-message">
            {msg.type === 'system' ? (
              <div className="text-center text-xs text-gray-400 py-1" data-testid="chat-system-message">
                {msg.content}
              </div>
            ) : (
              <div className="text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-gray-900 text-xs">{msg.senderName}</span>
                  <span className="text-xs text-gray-400">{formatTime(msg.timestamp)}</span>
                </div>
                <p className="text-gray-700 mt-0.5 break-words whitespace-pre-wrap">{msg.content}</p>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={1}
            maxLength={5000}
            data-testid="chat-input"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
            data-testid="chat-send-btn"
          >
            {t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  )
}
