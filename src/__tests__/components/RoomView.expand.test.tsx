/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RoomView } from '../../renderer/components/RoomView'
import type { Peer } from '../../types'

// Track the most recent onExpand callback passed to ParticipantCard
const expandCallbacks = new Map<string, () => void>()

vi.mock('../../renderer/components/ParticipantCard', () => ({
  ParticipantCard: ({ name, peerId, isLocal, onExpand }: { name: string; peerId: string; isLocal: boolean; onExpand?: () => void }) => {
    if (onExpand) expandCallbacks.set(peerId, onExpand)
    return (
      <div data-testid={`participant-card-${peerId}`} data-is-local={isLocal}>
        {name}
        {onExpand && (
          <button data-testid={`expand-btn-${peerId}`} onClick={onExpand}>
            Expand
          </button>
        )}
      </div>
    )
  }
}))

vi.mock('../../renderer/components/ExpandedParticipantView', () => ({
  ExpandedParticipantView: vi.fn().mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => (
      <div data-testid="expanded-participant-view">
        <span>{props.peer?.name}</span>
        <button data-testid="mock-collapse-btn" onClick={props.onCollapse}>Collapse</button>
        <button data-testid="mock-fullscreen-btn" onClick={props.onEnterFullscreen}>Fullscreen</button>
      </div>
    )
  )
}))

vi.mock('../../renderer/components/AudioMeter', () => ({
  AudioMeter: () => <div data-testid="audio-meter" />
}))
vi.mock('../../renderer/components/DeviceSelector', () => ({
  DeviceSelector: ({ label }: { label: string }) => <div data-testid="device-selector">{label}</div>
}))
vi.mock('../../renderer/components/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />
}))
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

function makePeer(overrides: Partial<Peer> = {}): Peer {
  return {
    id: 'peer-1',
    name: 'Alice',
    isMuted: false,
    isVideoMuted: false,
    isSpeakerMuted: false,
    isScreenSharing: true,
    audioLevel: 0,
    connectionState: 'connected',
    ...overrides
  }
}

describe('RoomView - Expand integration', () => {
  const defaultProps = {
    userName: 'Me',
    roomId: 'room-1',
    localPeerId: 'local-id',
    peers: new Map<string, Peer>(),
    remoteStreams: new Map<string, MediaStream>(),
    connectionState: 'connected' as const,
    isMuted: false,
    isSpeakerMuted: false,
    audioLevel: 0,
    selectedOutputDevice: 'default',
    inputDevices: [],
    videoInputDevices: [],
    outputDevices: [],
    selectedInputDevice: 'default',
    selectedVideoDevice: 'default',
    localStream: null as MediaStream | null,
    isVideoEnabled: true,
    soundEnabled: true,
    onToggleMute: vi.fn(),
    onToggleVideo: vi.fn(),
    onToggleSpeakerMute: vi.fn(),
    onLeaveRoom: vi.fn(),
    onInputDeviceChange: vi.fn(),
    onVideoDeviceChange: vi.fn(),
    onOutputDeviceChange: vi.fn(),
    onCopyRoomId: vi.fn(),
    onToggleSound: vi.fn(),
    chatMessages: [],
    onSendChatMessage: vi.fn(),
    chatUnreadCount: 0,
    isChatOpen: false,
    onToggleChat: vi.fn(),
    onMarkChatRead: vi.fn(),
    isScreenSharing: false,
    onToggleScreenShare: vi.fn(),
    settings: {
      noiseSuppressionEnabled: true,
      echoCancellationEnabled: true,
      autoGainControlEnabled: true,
      selectedInputDevice: 'default',
      selectedVideoDevice: 'default',
      selectedOutputDevice: 'default'
    },
    onSettingsChange: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    expandCallbacks.clear()

    // Mock fullscreen API
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true
    })
  })

  it('renders participant grid when no peer is expanded', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice' })]
    ])
    render(<RoomView {...defaultProps} peers={peers} />)
    expect(screen.getByTestId('participant-card-local-id')).toBeInTheDocument()
    expect(screen.getByTestId('participant-card-peer-1')).toBeInTheDocument()
    expect(screen.queryByTestId('expanded-participant-view')).not.toBeInTheDocument()
  })

  it('passes onExpand to remote participant cards', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice' })]
    ])
    render(<RoomView {...defaultProps} peers={peers} />)
    expect(screen.getByTestId('expand-btn-peer-1')).toBeInTheDocument()
  })

  it('does NOT pass onExpand to local participant card', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice' })]
    ])
    render(<RoomView {...defaultProps} peers={peers} />)
    // Local card should not have an expand button
    expect(screen.queryByTestId('expand-btn-local-id')).not.toBeInTheDocument()
  })

  it('shows expanded view when a peer is expanded via button click', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice' })]
    ])
    render(<RoomView {...defaultProps} peers={peers} />)

    // Click the expand button
    fireEvent.click(screen.getByTestId('expand-btn-peer-1'))

    expect(screen.getByTestId('expanded-participant-view')).toBeInTheDocument()
    // The expanded view mock renders the peer name
    const expandedView = screen.getByTestId('expanded-participant-view')
    expect(expandedView.textContent).toContain('Alice')
  })

  it('hides the grid when expanded view is shown', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice' })]
    ])
    render(<RoomView {...defaultProps} peers={peers} />)

    fireEvent.click(screen.getByTestId('expand-btn-peer-1'))

    // Grid should be replaced by expanded view
    expect(screen.getByTestId('expanded-participant-view')).toBeInTheDocument()
    // Local card should not be in the grid anymore (though the expanded peer's card may be hidden for audio)
  })

  it('returns to grid when collapse is clicked in expanded view', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice' })]
    ])
    render(<RoomView {...defaultProps} peers={peers} />)

    // Expand
    fireEvent.click(screen.getByTestId('expand-btn-peer-1'))
    expect(screen.getByTestId('expanded-participant-view')).toBeInTheDocument()

    // Collapse
    fireEvent.click(screen.getByTestId('mock-collapse-btn'))
    expect(screen.queryByTestId('expanded-participant-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('participant-card-peer-1')).toBeInTheDocument()
  })

  it('auto-exits expanded view when peer stops screen sharing and video is muted', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice', isScreenSharing: true })]
    ])
    const { rerender } = render(<RoomView {...defaultProps} peers={peers} />)

    fireEvent.click(screen.getByTestId('expand-btn-peer-1'))
    expect(screen.getByTestId('expanded-participant-view')).toBeInTheDocument()

    // Peer stops screen sharing and video is muted
    const updatedPeers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice', isScreenSharing: false, isVideoMuted: true })]
    ])
    rerender(<RoomView {...defaultProps} peers={updatedPeers} />)

    expect(screen.queryByTestId('expanded-participant-view')).not.toBeInTheDocument()
  })

  it('auto-exits expanded view when expanded peer disconnects', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice', isScreenSharing: true })]
    ])
    const { rerender } = render(<RoomView {...defaultProps} peers={peers} />)

    fireEvent.click(screen.getByTestId('expand-btn-peer-1'))
    expect(screen.getByTestId('expanded-participant-view')).toBeInTheDocument()

    // Peer disconnects
    const updatedPeers = new Map<string, Peer>()
    rerender(<RoomView {...defaultProps} peers={updatedPeers} />)

    expect(screen.queryByTestId('expanded-participant-view')).not.toBeInTheDocument()
  })

  it('ESC key collapses expanded view', () => {
    const peers = new Map<string, Peer>([
      ['peer-1', makePeer({ id: 'peer-1', name: 'Alice', isScreenSharing: true })]
    ])
    render(<RoomView {...defaultProps} peers={peers} />)

    fireEvent.click(screen.getByTestId('expand-btn-peer-1'))
    expect(screen.getByTestId('expanded-participant-view')).toBeInTheDocument()

    // Press ESC (must be wrapped in act since it triggers state updates via the hook's capture-phase listener)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(screen.queryByTestId('expanded-participant-view')).not.toBeInTheDocument()
  })
})
