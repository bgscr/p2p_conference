/**
 * usePeerConnections Hook
 * Manages WebRTC peer connections in Full Mesh topology
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { logger } from '../utils/Logger'
import { ICE_SERVERS } from './useRoom'

const WebRTCLog = logger.createModuleLogger('WebRTC')

interface PeerConnectionData {
  connection: RTCPeerConnection
  stream: MediaStream | null
  isInitiator: boolean
  connectionState: RTCPeerConnectionState
}

interface UsePeerConnectionsResult {
  peerConnections: Map<string, PeerConnectionData>
  remoteStreams: Map<string, MediaStream>
  createOffer: (peerId: string) => Promise<RTCSessionDescriptionInit | null>
  handleOffer: (peerId: string, offer: RTCSessionDescriptionInit) => Promise<RTCSessionDescriptionInit | null>
  handleAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => Promise<void>
  handleIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => Promise<void>
  addLocalStream: (stream: MediaStream) => void
  replaceTrack: (newTrack: MediaStreamTrack) => void
  closePeerConnection: (peerId: string) => void
  closeAllConnections: () => void
  getConnectionState: (peerId: string) => RTCPeerConnectionState | null
}

export function usePeerConnections(
  onIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => void,
  onConnectionStateChange?: (peerId: string, state: RTCPeerConnectionState) => void
): UsePeerConnectionsResult {
  const [peerConnections, setPeerConnections] = useState<Map<string, PeerConnectionData>>(new Map())
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  
  const localStreamRef = useRef<MediaStream | null>(null)
  const connectionsRef = useRef<Map<string, PeerConnectionData>>(new Map())
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())

  /**
   * Create a new RTCPeerConnection for a peer
   */
  const createPeerConnection = useCallback((peerId: string, isInitiator: boolean): RTCPeerConnection => {
    WebRTCLog.info(`Creating peer connection for ${peerId}`, { initiator: isInitiator })

    const config: RTCConfiguration = {
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10
    }

    const pc = new RTCPeerConnection(config)

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        WebRTCLog.debug(`ICE candidate for ${peerId}`, { type: event.candidate.type || 'end' })
        onIceCandidate(peerId, event.candidate.toJSON())
      }
    }

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      WebRTCLog.debug(`ICE state for ${peerId}: ${pc.iceConnectionState}`)
      
      if (pc.iceConnectionState === 'failed') {
        WebRTCLog.error(`ICE failed for ${peerId}, attempting restart`)
        pc.restartIce()
      }
    }

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      WebRTCLog.info(`Connection state for ${peerId}: ${pc.connectionState}`)
      
      // Update local ref
      const data = connectionsRef.current.get(peerId)
      if (data) {
        data.connectionState = pc.connectionState
        connectionsRef.current.set(peerId, data)
      }

      // Notify parent
      onConnectionStateChange?.(peerId, pc.connectionState)
      
      // Force state update
      setPeerConnections(new Map(connectionsRef.current))
      
      // Handle disconnection
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        WebRTCLog.warn(`Connection ${pc.connectionState} for ${peerId}`)
      }
    }

    // Handle incoming tracks (remote audio)
    pc.ontrack = (event) => {
      WebRTCLog.info(`Received track from ${peerId}`, { kind: event.track.kind })
      
      const remoteStream = event.streams[0] || new MediaStream([event.track])
      
      setRemoteStreams(prev => {
        const updated = new Map(prev)
        updated.set(peerId, remoteStream)
        return updated
      })

      // Update peer connection data with stream
      const data = connectionsRef.current.get(peerId)
      if (data) {
        data.stream = remoteStream
        connectionsRef.current.set(peerId, data)
      }
    }

    // Handle negotiation needed (renegotiation)
    pc.onnegotiationneeded = () => {
      WebRTCLog.debug(`Negotiation needed for ${peerId}`)
    }

    // Add local stream tracks if available
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!)
        WebRTCLog.debug(`Added local ${track.kind} track to ${peerId}`)
      })
    }

    // Store connection
    const connectionData: PeerConnectionData = {
      connection: pc,
      stream: null,
      isInitiator,
      connectionState: pc.connectionState
    }
    
    connectionsRef.current.set(peerId, connectionData)
    setPeerConnections(new Map(connectionsRef.current))

    return pc
  }, [onIceCandidate, onConnectionStateChange])

  /**
   * Add pending ICE candidates after remote description is set
   */
  const addPendingCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current.get(peerId) || []
    
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
        WebRTCLog.debug(`Added pending ICE candidate for ${peerId}`)
      } catch (err) {
        WebRTCLog.warn(`Failed to add pending candidate for ${peerId}`, err)
      }
    }
    
    pendingCandidatesRef.current.delete(peerId)
  }, [])

  /**
   * Create an SDP offer for a peer
   */
  const createOffer = useCallback(async (peerId: string): Promise<RTCSessionDescriptionInit | null> => {
    try {
      let pc = connectionsRef.current.get(peerId)?.connection
      
      if (!pc) {
        pc = createPeerConnection(peerId, true)
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      })

      // Modify SDP for Opus configuration
      if (offer.sdp) {
        offer.sdp = optimizeOpusSdp(offer.sdp)
      }

      await pc.setLocalDescription(offer)
      
      WebRTCLog.info(`Created offer for ${peerId}`)
      return offer
    } catch (err) {
      WebRTCLog.error(`Failed to create offer for ${peerId}`, err)
      return null
    }
  }, [createPeerConnection])

  /**
   * Handle an incoming SDP offer and create answer
   */
  const handleOffer = useCallback(async (
    peerId: string, 
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit | null> => {
    try {
      let pc = connectionsRef.current.get(peerId)?.connection
      
      if (!pc) {
        pc = createPeerConnection(peerId, false)
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      
      // Add any pending ICE candidates
      await addPendingCandidates(peerId, pc)
      
      const answer = await pc.createAnswer()
      
      if (answer.sdp) {
        answer.sdp = optimizeOpusSdp(answer.sdp)
      }

      await pc.setLocalDescription(answer)
      
      WebRTCLog.info(`Created answer for ${peerId}`)
      return answer
    } catch (err) {
      WebRTCLog.error(`Failed to handle offer from ${peerId}`, err)
      return null
    }
  }, [createPeerConnection, addPendingCandidates])

  /**
   * Handle an incoming SDP answer
   */
  const handleAnswer = useCallback(async (peerId: string, answer: RTCSessionDescriptionInit): Promise<void> => {
    try {
      const pc = connectionsRef.current.get(peerId)?.connection
      
      if (!pc) {
        WebRTCLog.error(`No connection found for ${peerId}`)
        return
      }

      await pc.setRemoteDescription(new RTCSessionDescription(answer))
      
      // Add any pending ICE candidates
      await addPendingCandidates(peerId, pc)
      
      WebRTCLog.info(`Set remote answer for ${peerId}`)
    } catch (err) {
      WebRTCLog.error(`Failed to handle answer from ${peerId}`, err)
    }
  }, [addPendingCandidates])

  /**
   * Handle an incoming ICE candidate
   */
  const handleIceCandidate = useCallback(async (
    peerId: string, 
    candidate: RTCIceCandidateInit
  ): Promise<void> => {
    try {
      const pc = connectionsRef.current.get(peerId)?.connection
      
      if (!pc) {
        // Store candidate for later if connection doesn't exist yet
        WebRTCLog.debug(`Storing ICE candidate for ${peerId} (no connection yet)`)
        const pending = pendingCandidatesRef.current.get(peerId) || []
        pending.push(candidate)
        pendingCandidatesRef.current.set(peerId, pending)
        return
      }

      // Check if we have a remote description
      if (!pc.remoteDescription) {
        WebRTCLog.debug(`Storing ICE candidate for ${peerId} (no remote description)`)
        const pending = pendingCandidatesRef.current.get(peerId) || []
        pending.push(candidate)
        pendingCandidatesRef.current.set(peerId, pending)
        return
      }

      await pc.addIceCandidate(new RTCIceCandidate(candidate))
      WebRTCLog.debug(`Added ICE candidate for ${peerId}`)
    } catch (err) {
      WebRTCLog.error(`Failed to add ICE candidate for ${peerId}`, err)
    }
  }, [])

  /**
   * Add local stream to all peer connections
   */
  const addLocalStream = useCallback((stream: MediaStream) => {
    localStreamRef.current = stream
    
    // Add tracks to all existing connections
    connectionsRef.current.forEach((data, peerId) => {
      stream.getTracks().forEach(track => {
        // Check if track already added
        const senders = data.connection.getSenders()
        const trackAlreadyAdded = senders.some(s => s.track === track)
        
        if (!trackAlreadyAdded) {
          data.connection.addTrack(track, stream)
          WebRTCLog.debug(`Added local track to ${peerId}`)
        }
      })
    })
  }, [])

  /**
   * Replace track in all peer connections (for device switching)
   */
  const replaceTrack = useCallback((newTrack: MediaStreamTrack) => {
    connectionsRef.current.forEach((data, peerId) => {
      const senders = data.connection.getSenders()
      const audioSender = senders.find(s => s.track?.kind === 'audio')
      
      if (audioSender) {
        audioSender.replaceTrack(newTrack)
          .then(() => WebRTCLog.debug(`Replaced track for ${peerId}`))
          .catch(err => WebRTCLog.error(`Failed to replace track for ${peerId}`, err))
      }
    })
  }, [])

  /**
   * Close a specific peer connection
   */
  const closePeerConnection = useCallback((peerId: string) => {
    const data = connectionsRef.current.get(peerId)
    
    if (data) {
      data.connection.close()
      connectionsRef.current.delete(peerId)
      pendingCandidatesRef.current.delete(peerId)
      setPeerConnections(new Map(connectionsRef.current))
      
      setRemoteStreams(prev => {
        const updated = new Map(prev)
        updated.delete(peerId)
        return updated
      })
      
      WebRTCLog.info(`Closed connection for ${peerId}`)
    }
  }, [])

  /**
   * Close all peer connections
   */
  const closeAllConnections = useCallback(() => {
    connectionsRef.current.forEach((data, peerId) => {
      data.connection.close()
      WebRTCLog.info(`Closed connection for ${peerId}`)
    })
    
    connectionsRef.current.clear()
    pendingCandidatesRef.current.clear()
    setPeerConnections(new Map())
    setRemoteStreams(new Map())
  }, [])

  /**
   * Get connection state for a peer
   */
  const getConnectionState = useCallback((peerId: string): RTCPeerConnectionState | null => {
    return connectionsRef.current.get(peerId)?.connection.connectionState || null
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closeAllConnections()
    }
  }, [closeAllConnections])

  return {
    peerConnections,
    remoteStreams,
    createOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    addLocalStream,
    replaceTrack,
    closePeerConnection,
    closeAllConnections,
    getConnectionState
  }
}

/**
 * Optimize Opus codec settings in SDP
 */
function optimizeOpusSdp(sdp: string): string {
  // Set Opus bitrate to 60kbps (good quality for voice, low bandwidth)
  // Enable forward error correction for packet loss resilience
  // Disable stereo (not needed for conference)
  return sdp.replace(
    /(a=fmtp:\d+ .*)/g,
    '$1;maxaveragebitrate=60000;stereo=0;useinbandfec=1'
  )
}
