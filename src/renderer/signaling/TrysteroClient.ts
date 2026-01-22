/**
 * TrysteroClient
 * Wrapper for Trystero serverless signaling with additional utilities
 */

import { joinRoom, Room, selfId } from 'trystero/torrent'

// Application identifier for DHT namespacing
const APP_ID = 'p2p-conference-v1'

// Configuration for Trystero
const TRYSTERO_CONFIG = {
  appId: APP_ID,
  // Additional trackers can be added for redundancy
  // trackerUrls: [
  //   'wss://tracker.openwebtorrent.com',
  //   'wss://tracker.btorrent.xyz'
  // ]
}

export interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate'
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

export interface PeerInfo {
  id: string
  joinedAt: number
}

export interface TrysteroClientOptions {
  onPeerJoin: (peerId: string) => void
  onPeerLeave: (peerId: string) => void
  onSignal: (data: SignalMessage, peerId: string) => void
  onError?: (error: Error) => void
}

/**
 * TrysteroClient manages serverless peer discovery and signaling
 */
export class TrysteroClient {
  private room: Room | null = null
  private roomId: string | null = null
  private peers: Map<string, PeerInfo> = new Map()
  private options: TrysteroClientOptions
  
  private sendSignal: ((data: SignalMessage, peerId: string) => void) | null = null
  private receiveSignal: ((callback: (data: SignalMessage, peerId: string) => void) => void) | null = null

  constructor(options: TrysteroClientOptions) {
    this.options = options
  }

  /**
   * Get the local peer ID
   */
  getLocalPeerId(): string {
    return selfId
  }

  /**
   * Join a room by ID
   */
  joinRoom(roomId: string): void {
    if (this.room) {
      console.warn('[TrysteroClient] Already in a room, leaving first')
      this.leaveRoom()
    }

    this.roomId = roomId
    console.log(`[TrysteroClient] Joining room: ${roomId}`)

    try {
      this.room = joinRoom(TRYSTERO_CONFIG, roomId)

      // Set up signaling channel
      const [sendSignal, receiveSignal] = this.room.makeAction<SignalMessage>('signal')
      this.sendSignal = sendSignal
      this.receiveSignal = receiveSignal

      // Listen for signals from peers
      receiveSignal((data, peerId) => {
        console.log(`[TrysteroClient] Signal from ${peerId}:`, data.type)
        this.options.onSignal(data, peerId)
      })

      // Handle peer join events
      this.room.onPeerJoin((peerId) => {
        console.log(`[TrysteroClient] Peer joined: ${peerId}`)
        
        this.peers.set(peerId, {
          id: peerId,
          joinedAt: Date.now()
        })
        
        this.options.onPeerJoin(peerId)
      })

      // Handle peer leave events
      this.room.onPeerLeave((peerId) => {
        console.log(`[TrysteroClient] Peer left: ${peerId}`)
        
        this.peers.delete(peerId)
        this.options.onPeerLeave(peerId)
      })

    } catch (err) {
      console.error('[TrysteroClient] Failed to join room:', err)
      this.options.onError?.(err as Error)
    }
  }

  /**
   * Leave the current room
   */
  leaveRoom(): void {
    if (this.room) {
      console.log(`[TrysteroClient] Leaving room: ${this.roomId}`)
      this.room.leave()
      this.room = null
      this.roomId = null
      this.peers.clear()
      this.sendSignal = null
      this.receiveSignal = null
    }
  }

  /**
   * Send a signaling message to a specific peer
   */
  signal(peerId: string, data: SignalMessage): void {
    if (!this.sendSignal) {
      console.error('[TrysteroClient] Not connected to a room')
      return
    }

    console.log(`[TrysteroClient] Sending signal to ${peerId}:`, data.type)
    this.sendSignal(data, peerId)
  }

  /**
   * Broadcast a signaling message to all peers
   */
  broadcast(data: SignalMessage): void {
    if (!this.sendSignal) {
      console.error('[TrysteroClient] Not connected to a room')
      return
    }

    this.peers.forEach((peer) => {
      this.sendSignal!(data, peer.id)
    })
  }

  /**
   * Get list of connected peers
   */
  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values())
  }

  /**
   * Check if connected to a room
   */
  isConnected(): boolean {
    return this.room !== null
  }

  /**
   * Get current room ID
   */
  getRoomId(): string | null {
    return this.roomId
  }
}

/**
 * Generate a secure room ID
 */
export function generateSecureRoomId(length: number = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const array = new Uint32Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (x) => chars[x % chars.length]).join('')
}

/**
 * Validate room ID
 */
export function isValidRoomId(roomId: string): boolean {
  // Minimum 4 characters, alphanumeric with hyphens/underscores
  return roomId.length >= 4 && /^[A-Za-z0-9_-]+$/.test(roomId)
}
