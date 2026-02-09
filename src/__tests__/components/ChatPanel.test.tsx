/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatPanel } from '../../renderer/components/ChatPanel'
import type { ChatMessage } from '@/types'

vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.title': 'Chat',
        'chat.placeholder': 'Type a message...',
        'chat.send': 'Send',
        'chat.noMessages': 'No messages yet'
      }
      return map[key] || key
    }
  })
}))

describe('ChatPanel', () => {
  const onSendMessage = vi.fn()
  const onClose = vi.fn()
  const timestampSpy = vi.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('10:00 AM')
  const scrollSpy = vi.fn()
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeEach(() => {
    vi.clearAllMocks()
    timestampSpy.mockClear()
    ;(Element.prototype as any).scrollIntoView = scrollSpy
  })

  afterEach(() => {
    ;(Element.prototype as any).scrollIntoView = originalScrollIntoView
  })

  afterAll(() => {
    timestampSpy.mockRestore()
  })

  const textMessage: ChatMessage = {
    id: 'm1',
    senderId: 'peer-1',
    senderName: 'Bob',
    content: 'Hello there',
    timestamp: Date.now(),
    type: 'text'
  }

  const systemMessage: ChatMessage = {
    id: 's1',
    senderId: 'system',
    senderName: 'System',
    content: 'Alice joined',
    timestamp: Date.now(),
    type: 'system'
  }

  it('renders message list with sender name and timestamp', () => {
    render(<ChatPanel messages={[textMessage]} onSendMessage={onSendMessage} onClose={onClose} />)

    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    expect(screen.getByText('10:00 AM')).toBeInTheDocument()
  })

  it('renders system messages differently from text messages', () => {
    render(<ChatPanel messages={[textMessage, systemMessage]} onSendMessage={onSendMessage} onClose={onClose} />)

    expect(screen.getAllByTestId('chat-message')).toHaveLength(2)
    expect(screen.getByTestId('chat-system-message')).toHaveTextContent('Alice joined')
  })

  it('supports input and send button', () => {
    render(<ChatPanel messages={[]} onSendMessage={onSendMessage} onClose={onClose} />)

    const input = screen.getByTestId('chat-input')
    const sendButton = screen.getByTestId('chat-send-btn')
    fireEvent.change(input, { target: { value: 'A quick note' } })
    fireEvent.click(sendButton)

    expect(onSendMessage).toHaveBeenCalledWith('A quick note')
  })

  it('does not send whitespace-only messages', () => {
    render(<ChatPanel messages={[]} onSendMessage={onSendMessage} onClose={onClose} />)

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSendMessage).not.toHaveBeenCalled()
    expect(input.value).toBe('   ')
  })

  it('Enter sends and Shift+Enter inserts newline', () => {
    render(<ChatPanel messages={[]} onSendMessage={onSendMessage} onClose={onClose} />)

    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'line 1' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSendMessage).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSendMessage).toHaveBeenCalledWith('line 1')
  })

  it('renders empty state', () => {
    render(<ChatPanel messages={[]} onSendMessage={onSendMessage} onClose={onClose} />)
    expect(screen.getByTestId('chat-empty')).toHaveTextContent('No messages yet')
  })

  it('auto-scrolls on new messages', () => {
    const { rerender } = render(<ChatPanel messages={[]} onSendMessage={onSendMessage} onClose={onClose} />)
    rerender(<ChatPanel messages={[textMessage]} onSendMessage={onSendMessage} onClose={onClose} />)

    expect(scrollSpy).toHaveBeenCalled()
  })

  it('calls onClose when header close button is clicked', () => {
    render(<ChatPanel messages={[]} onSendMessage={onSendMessage} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('chat-close-btn'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
