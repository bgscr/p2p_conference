/**
 * ExpandedParticipantView Component
 * Displays a single remote participant's video filling the main content area.
 * Supports fullscreen mode via the Fullscreen API.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useI18n } from '../hooks/useI18n'
import type { Peer, ConnectionQuality } from '@/types'

interface ExpandedParticipantViewProps {
  peer: Peer
  stream?: MediaStream
  isFullscreen: boolean
  onCollapse: () => void
  onEnterFullscreen: () => void
  connectionQuality?: ConnectionQuality
}

const TOOLBAR_HIDE_DELAY = 3000

export const ExpandedParticipantView = React.forwardRef<HTMLDivElement, ExpandedParticipantViewProps>(
  ({ peer, stream, isFullscreen, onCollapse, onEnterFullscreen, connectionQuality }, ref) => {
    const { t } = useI18n()
    const videoRef = useRef<HTMLVideoElement>(null)
    const [toolbarVisible, setToolbarVisible] = useState(true)
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Set up video playback
    useEffect(() => {
      const videoElement = videoRef.current
      if (videoElement && stream) {
        if (videoElement.srcObject !== stream) {
          videoElement.srcObject = stream
        }
      } else if (videoElement) {
        videoElement.srcObject = null
      }
    }, [stream])

    // Toolbar auto-hide logic
    const resetHideTimer = useCallback(() => {
      setToolbarVisible(true)
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
      hideTimerRef.current = setTimeout(() => {
        setToolbarVisible(false)
      }, TOOLBAR_HIDE_DELAY)
    }, [])

    useEffect(() => {
      resetHideTimer()
      return () => {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current)
        }
      }
    }, [resetHideTimer])

    const handleMouseMove = useCallback(() => {
      resetHideTimer()
    }, [resetHideTimer])

    const objectFit = peer.isScreenSharing ? 'object-contain' : 'object-cover'

    return (
      <div
        ref={ref}
        className="relative w-full h-full bg-black flex items-center justify-center"
        onMouseMove={handleMouseMove}
        data-testid="expanded-view"
      >
        {/* Video */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full ${objectFit}`}
          data-testid="expanded-video"
        />

        {/* Floating Toolbar */}
        <div
          className={`absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3
            bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-300
            ${toolbarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          data-testid="expanded-toolbar"
        >
          {/* Left: Participant info */}
          <div className="flex items-center gap-2">
            <span className="text-white font-medium text-sm">{peer.name}</span>
            {peer.isScreenSharing && (
              <span className="px-2 py-0.5 bg-green-500 text-white text-xs rounded-full">
                {t('room.screenSharing')}
              </span>
            )}
            {connectionQuality && (
              <span className="text-white/70 text-xs">
                {connectionQuality.quality} · {connectionQuality.rtt}ms
              </span>
            )}
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-2">
            {/* Fullscreen Toggle */}
            <button
              onClick={isFullscreen ? onCollapse : onEnterFullscreen}
              className="p-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
              title={isFullscreen ? t('room.exitFullscreen') : t('room.enterFullscreen')}
              data-testid="fullscreen-btn"
            >
              {isFullscreen ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              )}
            </button>

            {/* Minimize */}
            <button
              onClick={onCollapse}
              className="p-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
              title={t('room.collapseView')}
              data-testid="collapse-btn"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }
)

ExpandedParticipantView.displayName = 'ExpandedParticipantView'
