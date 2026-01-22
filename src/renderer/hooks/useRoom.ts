/**
 * useRoom Hook
 * Manages room connection and peer discovery via SimplePeerManager (browser-native WebRTC)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { peerManager, selfId } from '../signaling/SimplePeerManager'
import { RoomLog } from '../utils/Logger'
import type { Peer, ConnectionState } from '@/types'

// Re-export selfId for other components
export { selfId }

// ICE server configuration (public STUN servers only - no TURN)
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
]

interface UseRoomResult {
  room: any | null
  roomId: string | null
  peers: Map<string, Peer>
  localPeerId: string
  connectionState: ConnectionState
  joinRoom: (roomId: string, userName: string) => Promise<void>
  leaveRoom: () => void
  sendSignal: ((data: any, peerId: string) => void) | null
  onSignalReceived: (callback: (data: any, peerId: string) => void) => void
  broadcastUserInfo: () => void
  error: string | null
}

interface RoomCallbacks {
  onPeerJoin?: (peerId: string, peerName: string) => void
  onPeerLeave?: (peerId: string, peerName: string) => void
  onConnectionStateChange?: (state: ConnectionState) => void
}

/**
 * Validate room ID has sufficient entropy
 */
function isValidRoomId(roomId: string): boolean {
  return roomId.length >= 4 && /^[A-Za-z0-9_-]+$/.test(roomId)
}

export function useRoom(callbacks?: RoomCallbacks): UseRoomResult {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map())
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [error, setError] = useState<string | null>(null)
  
  const callbacksRef = useRef<RoomCallbacks>(callbacks || {})
  const localUserNameRef = useRef<string>('')
  const signalCallbackRef = useRef<((data: any, peerId: string) => void) | null>(null)
  
  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = callbacks || {}
  }, [callbacks])

  /**
   * Update connection state with callback
   */
  const updateConnectionState = useCallback((state: ConnectionState) => {
    RoomLog.info('Connection state changed', { from: connectionState, to: state })
    setConnectionState(state)
    callbacksRef.current.onConnectionStateChange?.(state)
  }, [connectionState])

  /**
   * Set callback for received signals (not used with SimplePeerManager, but kept for API compatibility)
   */
  const onSignalReceived = useCallback((callback: (data: any, peerId: string) => void) => {
    signalCallbackRef.current = callback
  }, [])

  /**
   * Broadcast user info (handled internally by SimplePeerManager)
   */
  const broadcastUserInfo = useCallback(() => {
    // User info is sent automatically on announce
  }, [])

  /**
   * Initialize peer manager callbacks
   * NOTE: onRemoteStream is handled by App.tsx to store streams for audio playback
   * We only handle onPeerJoin and onPeerLeave here for peer list management
   */
  useEffect(() => {
    peerManager.setCallbacks({
      onPeerJoin: (peerId: string, userName: string) => {
        RoomLog.info('Peer joined', { peerId, userName })
        
        const newPeer: Peer = {
          id: peerId,
          name: userName,
          isMuted: false,
          audioLevel: 0,
          connectionState: 'connected'
        }
        
        setPeers(prev => {
          const updated = new Map(prev)
          updated.set(peerId, newPeer)
          RoomLog.debug('Peers updated', { count: updated.size })
          return updated
        })
        
        updateConnectionState('connected')
        callbacksRef.current.onPeerJoin?.(peerId, userName)
      },
      
      onPeerLeave: (peerId: string, userName: string) => {
        RoomLog.info('Peer left', { peerId, userName })
        
        setPeers(prev => {
          const updated = new Map(prev)
          updated.delete(peerId)
          
          RoomLog.debug('Peers updated after leave', { count: updated.size })
          
          if (updated.size === 0) {
            updateConnectionState('signaling')
          }
          
          return updated
        })
        
        callbacksRef.current.onPeerLeave?.(peerId, userName)
      }
      // NOTE: onRemoteStream is NOT set here - it's handled by App.tsx
      // to properly store streams in remoteStreams state for audio playback
    })
  }, [updateConnectionState])

  /**
   * Join a room by ID
   */
  const joinRoomById = useCallback(async (roomIdInput: string, userName: string) => {
    // Validate room ID
    if (!isValidRoomId(roomIdInput)) {
      const errMsg = 'Invalid room ID. Use at least 4 alphanumeric characters.'
      RoomLog.error('Invalid room ID', { roomId: roomIdInput })
      setError(errMsg)
      return
    }

    try {
      updateConnectionState('signaling')
      setError(null)
      setRoomId(roomIdInput)
      localUserNameRef.current = userName

      RoomLog.info('Joining room', { roomId: roomIdInput, userName, selfId })

      await peerManager.joinRoom(roomIdInput, userName)
      
      RoomLog.info('Successfully joined room', { roomId: roomIdInput })

    } catch (err: any) {
      RoomLog.error('Failed to join room', { 
        roomId: roomIdInput, 
        error: err.message 
      })
      setError('Failed to join room. Please try again.')
      updateConnectionState('failed')
    }
  }, [updateConnectionState])

  /**
   * Leave the current room
   */
  const leaveRoomCallback = useCallback(() => {
    RoomLog.info('Leaving room', { roomId })
    
    peerManager.leaveRoom()
    
    setRoomId(null)
    setPeers(new Map())
    updateConnectionState('idle')
    setError(null)
    localUserNameRef.current = ''
    
    RoomLog.info('Left room successfully')
  }, [roomId, updateConnectionState])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      peerManager.leaveRoom()
    }
  }, [])

  return {
    room: peerManager,
    roomId,
    peers,
    localPeerId: selfId,
    connectionState,
    joinRoom: joinRoomById,
    leaveRoom: leaveRoomCallback,
    sendSignal: null, // Signaling is handled internally by SimplePeerManager
    onSignalReceived,
    broadcastUserInfo,
    error
  }
}
