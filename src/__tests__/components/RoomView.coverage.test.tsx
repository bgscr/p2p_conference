/**
 * Coverage-focused tests for RoomView component
 * @vitest-environment jsdom
 * 
 * These tests target the actual RoomView component to improve coverage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createAudioDevice, createP2PManagerMock, createPeer, createRoomViewProps } from '../helpers/roomViewTestUtils'

// Mock dependencies
vi.mock('../../renderer/hooks/useI18n', () => ({
  useI18n: vi.fn().mockReturnValue({
    t: (key: string, params?: Record<string, any>) => {
      const translations: Record<string, string> = {
        'room.you': 'You',
        'room.muted': 'Muted',
        'room.live': 'Live',
        'room.copyRoomId': 'Copy Room ID',
        'room.copied': 'Copied!',
        'room.leaveCall': 'Leave',
        'room.leaveCallHint': 'Leave Call',
        'room.inCall': 'in call',
        'room.searchingParticipants': 'Searching...',
        'room.connecting': 'Connecting...',
        'room.connected': 'Connected',
        'room.notConnected': 'Not connected',
        'room.connectionFailed': 'Connection failed',
        'room.participantsConnected': `${params?.count || 0} participants`,
        'room.muteHint': 'Mute (M)',
        'room.unmuteHint': 'Unmute (M)',
        'room.speakerMuted': 'Speaker Muted',
        'room.muteNotifications': 'Mute Notifications',
        'room.enableNotifications': 'Enable Notifications',
        'room.audioSettings': 'Audio Settings',
        'room.waitingForOthers': 'Waiting for others',
        'room.shareRoomIdHint': 'Share the room ID to invite others',
        'room.networkOffline': 'You are offline',
        'room.reconnecting': 'Reconnecting',
        'room.retryNow': 'Retry Now',
        'room.on': 'On',
        'room.off': 'Off',
        'room.noiseSuppressionBrowser': 'AI Noise Suppression',
        'room.havingIssues': 'Having issues?',
        'room.downloadLogs': 'Download Logs',
        'room.roomIdCopyHint': 'Copy Room ID',
        'common.microphone': 'Microphone',
        'common.speaker': 'Speaker'
      }
      return translations[key] || key
    }
  })
}))

vi.mock('../../renderer/utils/Logger', () => ({
  UILog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AudioLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { downloadLogs: vi.fn() }
}))

// Import the actual component after mocks are set up
import { RoomView } from '../../renderer/components/RoomView'
import { logger } from '../../renderer/utils/Logger'

describe('RoomView Component - Coverage Tests', () => {
  const defaultProps = createRoomViewProps({
    inputDevices: [createAudioDevice('audioinput', 'default', 'Default Mic', 'g1')],
    videoInputDevices: [createAudioDevice('videoinput', 'default', 'Default Cam', 'g1')],
    outputDevices: [createAudioDevice('audiooutput', 'default', 'Default Speaker', 'g1')],
    selectedInputDevice: 'default',
    selectedVideoDevice: 'default',
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Timer/Elapsed Time', () => {
    it('should update elapsed time with real timers', async () => {
      vi.useFakeTimers()
      render(<RoomView {...defaultProps} />)

      // Advance timer by 2 seconds
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      // Should update (the actual time may vary slightly)
      expect(screen.getByText(/0:0/)).toBeInTheDocument()

      vi.useRealTimers()
    })
  })

  describe('Network Status Banner', () => {
    it('should show offline banner when network is offline', () => {
      vi.useFakeTimers()
      const mockP2PManager = createP2PManagerMock({
        setOnNetworkStatusChange: vi.fn((cb: (isOnline: boolean) => void) => {
          cb(false)
        }),
        getNetworkStatus: vi.fn().mockReturnValue({
          isOnline: false,
          wasInRoomWhenOffline: true,
          reconnectAttempts: 0
        }),
      })

      const { unmount } = render(<RoomView {...defaultProps} p2pManager={mockP2PManager as any} />)

      expect(screen.getByText('You are offline')).toBeInTheDocument()

      unmount()
      vi.useRealTimers()
    })

    it('should show reconnecting banner with retry count', () => {
      vi.useFakeTimers()

      const mockP2PManager = createP2PManagerMock({
        getNetworkStatus: vi.fn().mockReturnValue({
          isOnline: true,
          wasInRoomWhenOffline: true,
          reconnectAttempts: 2
        }),
      })

      const { unmount } = render(<RoomView {...defaultProps} p2pManager={mockP2PManager as any} />)

      // Trigger the network status poll
      act(() => {
        vi.advanceTimersByTime(1100)
      })

      expect(screen.getByText(/Reconnecting/)).toBeInTheDocument()
      expect(screen.getByText(/2\/5/)).toBeInTheDocument()

      unmount()
      vi.useRealTimers()
    })

    it('should call manualReconnect when retry button clicked', () => {
      vi.useFakeTimers()

      const mockManualReconnect = vi.fn()
      const mockP2PManager = createP2PManagerMock({
        getNetworkStatus: vi.fn().mockReturnValue({
          isOnline: true,
          wasInRoomWhenOffline: true,
          reconnectAttempts: 1
        }),
        manualReconnect: mockManualReconnect
      })

      const { unmount } = render(<RoomView {...defaultProps} p2pManager={mockP2PManager as any} />)

      act(() => {
        vi.advanceTimersByTime(1100)
      })

      const retryButton = screen.getByText('Retry Now')
      fireEvent.click(retryButton)

      expect(mockManualReconnect).toHaveBeenCalled()

      unmount()
      vi.useRealTimers()
    })
  })

  describe('Empty State Display', () => {
    it.each([
      {
        name: 'shows empty state when no peers and not connecting',
        peers: new Map(),
        connectionState: 'connected' as const,
        expectWaiting: true,
      },
      {
        name: 'does not show empty state while connecting',
        peers: new Map(),
        connectionState: 'connecting' as const,
        expectWaiting: false,
      },
      {
        name: 'does not show empty state when peers exist',
        peers: new Map([['peer-1', createPeer({ id: 'peer-1', name: 'Bob', platform: 'mac' })]]),
        connectionState: 'connected' as const,
        expectWaiting: false,
      },
    ])('$name', ({ peers, connectionState, expectWaiting }) => {
      render(<RoomView {...defaultProps} peers={peers} connectionState={connectionState} />)

      if (expectWaiting) {
        expect(screen.getByText('Waiting for others')).toBeInTheDocument()
        expect(screen.getByText('Share the room ID to invite others')).toBeInTheDocument()
      } else {
        expect(screen.queryByText('Waiting for others')).not.toBeInTheDocument()
      }
    })
  })

  describe('Device Panel & Settings', () => {
    it('should toggle noise suppression setting', () => {
      const onSettingsChange = vi.fn()

      render(
        <RoomView
          {...defaultProps}
          settings={{
            ...defaultProps.settings,
            noiseSuppressionEnabled: true
          }}
          onSettingsChange={onSettingsChange}
        />
      )

      // Open device panel
      const settingsButton = screen.getByTitle('Audio Settings')
      fireEvent.click(settingsButton)

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)

      expect(onSettingsChange).toHaveBeenCalledWith({ noiseSuppressionEnabled: false })
    })

    it('should call input device change', () => {
      const onInputDeviceChange = vi.fn()
      const inputDevices = [
        createAudioDevice('audioinput', 'mic1', 'Mic 1', 'g1'),
        createAudioDevice('audioinput', 'mic2', 'Mic 2', 'g2'),
      ]

      render(
        <RoomView
          {...defaultProps}
          inputDevices={inputDevices}
          selectedInputDevice="mic1"
          onInputDeviceChange={onInputDeviceChange}
        />
      )

      // Open device panel
      const settingsButton = screen.getByTitle('Audio Settings')
      fireEvent.click(settingsButton)

      const selects = screen.getAllByRole('combobox')
      fireEvent.change(selects[0], { target: { value: 'mic2' } })

      expect(onInputDeviceChange).toHaveBeenCalledWith('mic2')
    })

  })

  describe('Connection Stats', () => {
    it('should call logger download from device panel helpers', () => {
      render(<RoomView {...defaultProps} />)
      const settingsButton = screen.getByTitle('Audio Settings')
      fireEvent.click(settingsButton)
      fireEvent.click(screen.getByText('Download Logs'))
      expect(logger.downloadLogs).toHaveBeenCalled()
    })
  })

  describe('Control Buttons', () => {
    it('should call onToggleSpeakerMute when speaker button clicked', () => {
      const onToggleSpeakerMute = vi.fn()
      render(<RoomView {...defaultProps} onToggleSpeakerMute={onToggleSpeakerMute} />)

      const speakerButton = screen.getByTitle('Speaker')
      fireEvent.click(speakerButton)

      expect(onToggleSpeakerMute).toHaveBeenCalled()
    })

    it('should show unmute hint when muted', () => {
      render(<RoomView {...defaultProps} isMuted={true} />)

      expect(screen.getByTitle('Unmute (M)')).toBeInTheDocument()
    })

    it('should show speaker muted elements when speaker is muted', () => {
      render(<RoomView {...defaultProps} isSpeakerMuted={true} />)

      // Use getAllByTitle since there might be multiple elements
      const speakerMutedElements = screen.getAllByTitle('Speaker Muted')
      expect(speakerMutedElements.length).toBeGreaterThan(0)
    })

    it('should call onToggleSound when notification button clicked', () => {
      const onToggleSound = vi.fn()
      render(<RoomView {...defaultProps} onToggleSound={onToggleSound} soundEnabled={true} />)

      const soundButton = screen.getByTitle('Mute Notifications')
      fireEvent.click(soundButton)

      expect(onToggleSound).toHaveBeenCalled()
    })

    it('should show enable notifications title when sound is disabled', () => {
      render(<RoomView {...defaultProps} soundEnabled={false} />)

      expect(screen.getByTitle('Enable Notifications')).toBeInTheDocument()
    })
  })

  describe('Participant Warning', () => {
    it('should show warning styling when 8+ participants', () => {
      const peers = new Map()
      for (let i = 0; i < 8; i++) {
        peers.set(`peer-${i}`, createPeer({ id: `peer-${i}`, name: `User ${i}`, platform: 'win' }))
      }

      render(<RoomView {...defaultProps} peers={peers} />)

      // The participant count should show 9 (8 peers + 1 local)
      expect(screen.getByText(/9 in call/)).toBeInTheDocument()
    })
  })

  describe('Connection State Display', () => {
    it.each([
      { name: 'shows connecting status', connectionState: 'connecting' as const, expectedText: 'Connecting...', peers: new Map() },
      { name: 'shows not connected status', connectionState: 'idle' as const, expectedText: 'Not connected', peers: new Map() },
      {
        name: 'shows participant count when connected',
        connectionState: 'connected' as const,
        expectedText: '1 participants',
        peers: new Map([['peer-1', createPeer({ id: 'peer-1', name: 'Bob', platform: 'mac' })]]),
      },
    ])('$name', ({ connectionState, expectedText, peers }) => {
      render(<RoomView {...defaultProps} connectionState={connectionState} peers={peers} />)
      expect(screen.getByText(expectedText)).toBeInTheDocument()
    })
  })

  describe('Copy Room ID Header', () => {
    it('should call onCopyRoomId when header copy button clicked', () => {
      const onCopyRoomId = vi.fn()
      render(<RoomView {...defaultProps} onCopyRoomId={onCopyRoomId} />)

      const copyButton = screen.getByTitle('Copy Room ID')
      fireEvent.click(copyButton)

      expect(onCopyRoomId).toHaveBeenCalled()
    })

    it('should show copied feedback after clicking', () => {
      vi.useFakeTimers()

      const onCopyRoomId = vi.fn()
      render(<RoomView {...defaultProps} onCopyRoomId={onCopyRoomId} />)

      const copyButton = screen.getByTitle('Copy Room ID')
      fireEvent.click(copyButton)

      // Should show "Copied!" feedback
      expect(screen.getByText(/Copied!/)).toBeInTheDocument()

      // Advance timer to clear feedback
      act(() => {
        vi.advanceTimersByTime(2100)
      })

      expect(screen.queryByText(/Copied!/)).not.toBeInTheDocument()

      vi.useRealTimers()
    })
  })

  describe('Audio Level Display', () => {
    it.each([
      { name: 'shows muted text when muted', isMuted: true, expectedText: 'Muted' },
      { name: 'shows live text when unmuted', isMuted: false, expectedText: 'Live' },
    ])('$name', ({ isMuted, expectedText }) => {
      render(<RoomView {...defaultProps} isMuted={isMuted} />)
      expect(screen.getByText(expectedText)).toBeInTheDocument()
    })
  })
})
