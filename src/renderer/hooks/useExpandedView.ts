/**
 * useExpandedView Hook
 * Manages expanded/fullscreen state for remote participant video and screen sharing.
 * Auto-exits when the expanded peer stops sharing or disconnects.
 */

import { useState, useCallback, useEffect } from 'react'
import type { Peer } from '@/types'

export interface UseExpandedViewResult {
  expandedPeerId: string | null
  isFullscreen: boolean
  expandPeer: (peerId: string) => void
  enterFullscreen: (element: HTMLElement) => void
  collapse: () => void
}

export function useExpandedView(peers: Map<string, Peer>): UseExpandedViewResult {
  const [expandedPeerId, setExpandedPeerId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const collapse = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Ignore errors (e.g. already exited)
      })
    }
    setExpandedPeerId(null)
    setIsFullscreen(false)
  }, [])

  const expandPeer = useCallback((peerId: string) => {
    setExpandedPeerId(peerId)
    setIsFullscreen(false)
  }, [])

  const enterFullscreen = useCallback((element: HTMLElement) => {
    if (element.requestFullscreen) {
      element.requestFullscreen().then(() => {
        setIsFullscreen(true)
      }).catch(() => {
        // Fullscreen request denied, stay in expanded mode
      })
    }
  }, [])

  // Sync isFullscreen state when user exits fullscreen externally (e.g. browser ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // ESC key handler in capture phase to intercept before App.tsx's leave-confirm handler
  useEffect(() => {
    if (!expandedPeerId) return

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        collapse()
      }
    }
    window.addEventListener('keydown', handleEsc, { capture: true })
    return () => window.removeEventListener('keydown', handleEsc, { capture: true })
  }, [expandedPeerId, collapse])

  // Auto-exit when the expanded peer stops video/screen share or disconnects
  useEffect(() => {
    if (!expandedPeerId) return

    const peer = peers.get(expandedPeerId)
    if (!peer) {
      // Peer disconnected
      collapse()
      return
    }

    const hasActiveVideo = peer.isScreenSharing || !peer.isVideoMuted
    if (!hasActiveVideo) {
      collapse()
    }
  }, [expandedPeerId, peers, collapse])

  return {
    expandedPeerId,
    isFullscreen,
    expandPeer,
    enterFullscreen,
    collapse
  }
}
