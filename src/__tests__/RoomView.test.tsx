/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock dependencies before importing component
vi.mock('../renderer/components/ParticipantCard', () => ({
  ParticipantCard: ({ name, volume, onVolumeChange, isLocal, peerId }: any) => (
    <div data-testid={`participant-${peerId}`}>
      <span>{name}</span>
      {!isLocal && onVolumeChange && (
        <button data-testid={`vol-change-${peerId}`} onClick={() => onVolumeChange(42)}>
          set volume
        </button>
      )}
      {!isLocal && <span data-testid={`volume-${peerId}`}>{volume}</span>}
    </div>
  ),
}))

vi.mock('../renderer/components/AudioMeter', () => ({
  AudioMeter: () => <div data-testid="audio-meter" />,
}))

vi.mock('../renderer/components/DeviceSelector', () => ({
  DeviceSelector: ({ label, onSelect }: any) => (
    <div data-testid="device-selector">
      <span>{label}</span>
      <select onChange={(e: any) => onSelect(e.target.value)}>
        <option value="dev1">Device 1</option>
        <option value="dev2">Device 2</option>
      </select>
    </div>
  ),
}))

vi.mock('../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'room.you': 'You',
        'room.connected': 'Connected',
        'room.notConnected': 'Not connected',
        'room.connecting': 'Connecting...',
        'room.inCall': 'in call',
        'room.participantsConnected': `${params?.count || 0} participants`,
        'room.muteHint': 'Mute (M)',
        'room.unmuteHint': 'Unmute (M)',
        'room.audioSettings': 'Audio Settings',
        'room.on': 'On',
        'room.off': 'Off',
        'room.noiseSuppressionBrowser': 'AI Noise Suppression',
        'room.roomIdCopyHint': 'Copy Room ID',
        'common.microphone': 'Microphone',
        'common.camera': 'Camera',
        'common.speaker': 'Speaker',
      }
      return translations[key] || key
    },
  }),
}))

vi.mock('../renderer/utils/Logger', () => ({
  UILog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AudioLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { downloadLogs: vi.fn() },
}))

import { RoomView } from '../renderer/components/RoomView'
import { createP2PManagerMock, createPeer, createPeerMap, createRoomViewProps } from './helpers/roomViewTestUtils'

describe('RoomView - focused matrix tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { peerCount: 0, gridClass: 'grid-cols-1' },
    { peerCount: 1, gridClass: 'grid-cols-2' },
    { peerCount: 3, gridClass: 'grid-cols-2' },
    { peerCount: 4, gridClass: 'grid-cols-3' },
    { peerCount: 6, gridClass: 'grid-cols-4' },
  ])('uses $gridClass layout for $peerCount peer(s)', ({ peerCount, gridClass }) => {
    const { container } = render(
      <RoomView {...(createRoomViewProps({ peers: createPeerMap(peerCount) }) as any)} />,
    )
    const grid = container.querySelector('.grid')
    expect(grid?.className).toContain(gridClass)
  })

  it('wires connection stats + network callback when p2pManager is provided', async () => {
    const p2pManager = createP2PManagerMock()

    render(<RoomView {...(createRoomViewProps({ p2pManager }) as any)} />)

    await waitFor(() => {
      expect(p2pManager.getConnectionStats).toHaveBeenCalled()
    })
    expect(p2pManager.setOnNetworkStatusChange).toHaveBeenCalled()
  })

  it('supports runtime without p2pManager', () => {
    render(<RoomView {...(createRoomViewProps({ p2pManager: undefined }) as any)} />)
    expect(screen.getByText('test-room-123')).toBeInTheDocument()
  })

  it('updates per-peer volume through participant callback', () => {
    const peers = new Map([['peer-1', createPeer({ id: 'peer-1', name: 'Bob', platform: 'mac' })]])
    render(<RoomView {...(createRoomViewProps({ peers }) as any)} />)

    fireEvent.click(screen.getByTestId('vol-change-peer-1'))
    expect(screen.getByTestId('volume-peer-1')).toBeInTheDocument()
  })

  it('renders noise suppression state from settings panel for disabled mode', () => {
    render(
      <RoomView
        {...(createRoomViewProps({
          settings: { noiseSuppressionEnabled: false },
        }) as any)}
      />,
    )

    fireEvent.click(screen.getByTitle('Audio Settings'))
    expect(screen.getByText('Off')).toBeInTheDocument()
  })
})
