/**
 * Signaling module exports
 */

export { 
  SimplePeerManager, 
  peerManager as legacyPeerManager, 
  selfId, 
  generatePeerId,
  loadCredentials  // Export credential loader for manual pre-loading if needed
} from './SimplePeerManager'

export {
  peerManager,
  type PeerManager,
  type PeerManagerEventMap,
  type InitOptions,
  type JoinRequest,
  type JoinResult,
  type LeaveReason,
  type LocalMediaPatch,
  type DataMessage,
  type PeerSnapshot
} from './PeerManagerFacade'
