import { fireEvent, screen } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type {
  AppSettings,
  AudioDevice,
  ChatMessage,
  ConnectionState,
  Peer,
  RemoteMicSession,
  VirtualAudioInstallerState,
  VirtualMicDeviceStatus,
} from '../../types'

export interface RoomViewTestProps {
  userName: string
  roomId: string
  localPeerId: string
  localPlatform: 'win' | 'mac' | 'linux'
  peers: Map<string, Peer>
  remoteStreams: Map<string, MediaStream>
  localStream: MediaStream | null
  connectionState: ConnectionState
  isMuted: boolean
  isVideoEnabled: boolean
  isSpeakerMuted: boolean
  audioLevel: number
  selectedOutputDevice: string | null
  inputDevices: AudioDevice[]
  videoInputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  selectedInputDevice: string | null
  selectedVideoDevice: string | null
  soundEnabled: boolean
  onToggleMute: () => void
  onToggleVideo: () => void
  onToggleSpeakerMute: () => void
  onLeaveRoom: () => void
  onInputDeviceChange: (deviceId: string) => void
  onVideoDeviceChange: (deviceId: string) => void
  onOutputDeviceChange: (deviceId: string) => void
  onCopyRoomId: () => void
  onToggleSound: () => void
  chatMessages: ChatMessage[]
  onSendChatMessage: (content: string) => void
  chatUnreadCount: number
  isChatOpen: boolean
  onToggleChat: () => void
  onMarkChatRead: () => void
  isScreenSharing: boolean
  onToggleScreenShare: () => void
  settings: AppSettings
  onSettingsChange: (settings: Partial<AppSettings>) => void
  p2pManager?: any
}

const defaultSettings: AppSettings = {
  noiseSuppressionEnabled: true,
  echoCancellationEnabled: true,
  autoGainControlEnabled: true,
  selectedInputDevice: null,
  selectedVideoDevice: null,
  selectedOutputDevice: null,
}

export function createAudioDevice(
  kind: AudioDevice['kind'],
  deviceId = 'default',
  label = 'Default Device',
  groupId = 'group-default',
): AudioDevice {
  return { kind, deviceId, label, groupId }
}

export function createPeer(overrides: Partial<Peer> = {}): Peer {
  const id = overrides.id ?? 'peer-1'
  return {
    id,
    name: overrides.name ?? 'Peer',
    isMuted: overrides.isMuted ?? false,
    isVideoMuted: overrides.isVideoMuted ?? false,
    isSpeakerMuted: overrides.isSpeakerMuted ?? false,
    isScreenSharing: overrides.isScreenSharing ?? false,
    audioLevel: overrides.audioLevel ?? 0,
    connectionState: overrides.connectionState ?? 'connected',
    platform: overrides.platform ?? 'win',
    virtualMicReady: overrides.virtualMicReady,
    virtualMicDeviceLabel: overrides.virtualMicDeviceLabel,
  }
}

export function createPeerMap(count: number, platform: Peer['platform'] = 'win'): Map<string, Peer> {
  const peers = new Map<string, Peer>()
  for (let i = 0; i < count; i += 1) {
    const id = `peer-${i}`
    peers.set(
      id,
      createPeer({
        id,
        name: `User ${i}`,
        platform,
      }),
    )
  }
  return peers
}

export function createRemoteMicSession(overrides: Partial<RemoteMicSession> = {}): RemoteMicSession {
  return {
    state: 'idle',
    ...overrides,
  }
}

export function createVirtualMicDeviceStatus(
  overrides: Partial<VirtualMicDeviceStatus> = {},
): VirtualMicDeviceStatus {
  return {
    platform: 'win',
    supported: true,
    detected: true,
    ready: true,
    outputDeviceId: 'virtual',
    outputDeviceLabel: 'CABLE Input',
    expectedDeviceHint: 'CABLE Input (VB-CABLE)',
    ...overrides,
  }
}

export function createVirtualAudioInstallerState(
  overrides: Partial<VirtualAudioInstallerState> = {},
): VirtualAudioInstallerState {
  return {
    inProgress: false,
    platformSupported: true,
    ...overrides,
  }
}

export function createP2PManagerMock(
  overrides: Record<string, unknown> = {},
): any {
  const manager = {
    getConnectionStats: vi.fn().mockResolvedValue(new Map()),
    setOnNetworkStatusChange: vi.fn(),
    getNetworkStatus: vi.fn().mockReturnValue({
      isOnline: true,
      wasInRoomWhenOffline: false,
      reconnectAttempts: 0,
    }),
    manualReconnect: vi.fn(),
  }

  return { ...manager, ...overrides }
}

type RoomViewTestOverrides = Omit<Partial<RoomViewTestProps>, 'settings'> & {
  settings?: Partial<AppSettings>
}

export function createRoomViewProps(overrides: RoomViewTestOverrides = {}): RoomViewTestProps {
  const baseProps: RoomViewTestProps = {
    userName: 'Alice',
    roomId: 'test-room-123',
    localPeerId: 'local-123',
    localPlatform: 'win',
    peers: new Map(),
    remoteStreams: new Map(),
    localStream: null,
    connectionState: 'connected',
    isMuted: false,
    isVideoEnabled: true,
    isSpeakerMuted: false,
    audioLevel: 0.5,
    selectedOutputDevice: 'default',
    inputDevices: [],
    videoInputDevices: [],
    outputDevices: [],
    selectedInputDevice: 'default',
    selectedVideoDevice: 'default',
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
    settings: defaultSettings,
    onSettingsChange: vi.fn(),
  }

  return {
    ...baseProps,
    ...overrides,
    settings: {
      ...baseProps.settings,
      ...(overrides.settings || {}),
    },
  }
}

type TextMatcher = string | RegExp

export function expectRemoteMicIncomingModal(options: {
  title: TextMatcher
  installPrompt?: TextMatcher
  installActionLabel?: string
}): void {
  expect(screen.getByText(options.title)).toBeInTheDocument()

  if (options.installPrompt) {
    expect(screen.getByText(options.installPrompt)).toBeInTheDocument()
  }

  if (options.installActionLabel) {
    expect(screen.getByText(options.installActionLabel)).toBeInTheDocument()
  }
}

export function clickRemoteMicIncomingAction(options: {
  actionLabel: string
  onRespondRemoteMicRequest: (...args: any[]) => void
  expectedAccepted: boolean
}): void {
  fireEvent.click(screen.getByText(options.actionLabel))
  expect(options.onRespondRemoteMicRequest).toHaveBeenCalledWith(options.expectedAccepted)
}

export function expectRemoteMicIncomingControlsDisabled(options: {
  rejectLabel: string
  actionLabel: string
}): void {
  const rejectButton = screen.getByText(options.rejectLabel).closest('button') as HTMLButtonElement | null
  const actionButton = screen
    .getAllByText(options.actionLabel)
    .find((node) => node.closest('button'))
    ?.closest('button') as HTMLButtonElement | null

  expect(rejectButton).toBeTruthy()
  expect(actionButton).toBeTruthy()
  expect(rejectButton?.disabled).toBe(true)
  expect(actionButton?.disabled).toBe(true)
}
