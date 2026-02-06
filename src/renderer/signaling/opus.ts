/**
 * Opus SDP Configuration Helper
 * Extracted from SimplePeerManager and usePeerConnections for shared use and testability
 */

/**
 * Configure Opus codec settings in SDP for optimal voice quality
 * - maxaveragebitrate=60000: 60kbps (good quality for voice, low bandwidth)
 * - stereo=0: Mono (not needed for conference)
 * - useinbandfec=1: Forward error correction for packet loss resilience
 */
export function configureOpusSdp(sdp: string): string {
  return sdp.replace(
    /(a=fmtp:\d+ .*)/g,
    '$1;maxaveragebitrate=60000;stereo=0;useinbandfec=1'
  )
}
