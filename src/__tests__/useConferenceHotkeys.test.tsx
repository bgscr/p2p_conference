/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useConferenceHotkeys } from '../renderer/hooks/useConferenceHotkeys'

function createCallbacks() {
  return {
    showToast: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleSpeakerMute: vi.fn(),
    onToggleVideo: vi.fn(),
    onToggleChat: vi.fn(),
    onToggleScreenShare: vi.fn(),
    onCancelSearch: vi.fn(),
    onRequestLeaveConfirm: vi.fn(),
    onDownloadLogs: vi.fn(),
    onPushToTalkStateChange: vi.fn()
  }
}

function HotkeyHarness(props: any) {
  useConferenceHotkeys(props)
  return (
    <div>
      <input data-testid="hotkey-input" />
      <textarea data-testid="hotkey-textarea" />
      <div data-testid="hotkey-editable" contentEditable />
    </div>
  )
}

describe('useConferenceHotkeys', () => {
  const translate = (key: string) => key

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles Ctrl+Shift+L shortcut and ignores editable targets', () => {
    const callbacks = createCallbacks()
    const { getByTestId } = render(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={false}
        pushToTalkKey="space"
        isMuted={false}
        {...callbacks}
      />
    )

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, shiftKey: true })
    expect(callbacks.onDownloadLogs).toHaveBeenCalledTimes(1)
    expect(callbacks.showToast).toHaveBeenCalledWith('settings.downloadLogs', 'success')

    fireEvent.keyDown(getByTestId('hotkey-input'), { key: 'm' })
    fireEvent.keyDown(getByTestId('hotkey-textarea'), { key: 'm' })
    const editable = getByTestId('hotkey-editable')
    Object.defineProperty(editable, 'isContentEditable', {
      value: true,
      configurable: true
    })
    fireEvent.keyDown(editable, { key: 'm' })
    expect(callbacks.onToggleMute).not.toHaveBeenCalled()
  })

  it('handles room keyboard shortcuts and escape branch variants', () => {
    const callbacks = createCallbacks()
    const { rerender } = render(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={false}
        pushToTalkKey="space"
        isMuted={false}
        {...callbacks}
      />
    )

    fireEvent.keyDown(window, { key: 'm' })
    fireEvent.keyDown(window, { key: 'l' })
    fireEvent.keyDown(window, { key: 'v' })
    fireEvent.keyDown(window, { key: 't' })
    fireEvent.keyDown(window, { key: 's' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(1)
    expect(callbacks.onToggleSpeakerMute).toHaveBeenCalledTimes(1)
    expect(callbacks.onToggleVideo).toHaveBeenCalledTimes(1)
    expect(callbacks.onToggleChat).toHaveBeenCalledTimes(1)
    expect(callbacks.onToggleScreenShare).toHaveBeenCalledTimes(1)
    expect(callbacks.onRequestLeaveConfirm).toHaveBeenCalledTimes(1)

    rerender(
      <HotkeyHarness
        appView="room"
        connectionState="signaling"
        translate={translate}
        pushToTalkEnabled={false}
        pushToTalkKey="space"
        isMuted={false}
        {...callbacks}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(callbacks.onCancelSearch).toHaveBeenCalledTimes(1)
  })

  it('activates push-to-talk when muted and remutes on key up', () => {
    const callbacks = createCallbacks()
    render(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={true}
        pushToTalkKey="space"
        isMuted={true}
        {...callbacks}
      />
    )

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })

    expect(callbacks.onPushToTalkStateChange).toHaveBeenCalledWith(true)
    expect(callbacks.onPushToTalkStateChange).toHaveBeenCalledWith(false)
    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(2)
  })

  it('handles push-to-talk when already unmuted and releases on app view change', () => {
    const callbacks = createCallbacks()
    const { rerender } = render(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={true}
        pushToTalkKey="space"
        isMuted={false}
        {...callbacks}
      />
    )

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(callbacks.onToggleMute).not.toHaveBeenCalled()

    rerender(
      <HotkeyHarness
        appView="lobby"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={true}
        pushToTalkKey="space"
        isMuted={false}
        {...callbacks}
      />
    )

    expect(callbacks.onPushToTalkStateChange).toHaveBeenCalledWith(false)
    expect(callbacks.onToggleMute).not.toHaveBeenCalled()
  })

  it('remutes when push-to-talk session is active and feature gets disabled', () => {
    const callbacks = createCallbacks()
    const { rerender } = render(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={true}
        pushToTalkKey="space"
        isMuted={true}
        {...callbacks}
      />
    )

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(1)

    rerender(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={false}
        pushToTalkKey="space"
        isMuted={true}
        {...callbacks}
      />
    )

    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(2)
    expect(callbacks.onPushToTalkStateChange).toHaveBeenCalledWith(false)
  })

  it('supports shift and capslock push-to-talk keys and repeat-guard path', () => {
    const callbacks = createCallbacks()
    const { rerender } = render(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={true}
        pushToTalkKey="shift"
        isMuted={true}
        {...callbacks}
      />
    )

    fireEvent.keyDown(window, { key: 'Shift', code: 'ShiftLeft' })
    fireEvent.keyDown(window, { key: 'Shift', code: 'ShiftLeft', repeat: true })
    fireEvent.keyUp(window, { key: 'Shift', code: 'ShiftLeft' })

    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(2)

    rerender(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={true}
        pushToTalkKey="capslock"
        isMuted={true}
        {...callbacks}
      />
    )

    fireEvent.keyDown(window, { key: 'CapsLock', code: 'CapsLock' })
    fireEvent.keyUp(window, { key: 'x', code: 'KeyX' })
    fireEvent.keyUp(window, { key: 'CapsLock', code: 'CapsLock' })

    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(4)
  })

  it('handles space-key fallback branch and keyup when push-to-talk is not active', () => {
    const callbacks = createCallbacks()
    render(
      <HotkeyHarness
        appView="room"
        connectionState="connected"
        translate={translate}
        pushToTalkEnabled={true}
        pushToTalkKey="space"
        isMuted={false}
        {...callbacks}
      />
    )

    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    fireEvent.keyDown(window, { key: ' ', code: 'KeyA' })
    fireEvent.keyUp(window, { key: ' ', code: 'KeyA' })

    expect(callbacks.onPushToTalkStateChange).toHaveBeenCalledWith(true)
    expect(callbacks.onPushToTalkStateChange).toHaveBeenCalledWith(false)
    expect(callbacks.onToggleMute).not.toHaveBeenCalled()
  })
})
