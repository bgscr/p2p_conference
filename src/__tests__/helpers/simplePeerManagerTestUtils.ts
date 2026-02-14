import { vi } from 'vitest'

export type ChannelState = 'open' | 'closing' | 'closed'

export function createControlChannel(state: ChannelState = 'open'): any {
  return {
    readyState: state,
    send: vi.fn(),
    close: vi.fn(),
  } as any
}

export function createTestPeer(overrides: Record<string, any> = {}): any {
  const pc = overrides.pc || {
    getSenders: vi.fn(() => []),
    addTrack: vi.fn(),
    close: vi.fn(),
    connectionState: 'connected',
    iceConnectionState: 'connected',
  }

  return {
    pc,
    stream: null,
    userName: 'Peer',
    platform: 'win',
    connectionStartTime: Date.now(),
    isConnected: true,
    muteStatus: { micMuted: false, speakerMuted: false, videoMuted: false, isScreenSharing: false },
    iceRestartAttempts: 0,
    iceRestartInProgress: false,
    disconnectTimer: null,
    reconnectTimer: null,
    chatDataChannel: null,
    controlDataChannel: null,
    ...overrides,
  }
}
