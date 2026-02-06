/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { configureOpusSdp } from '../renderer/signaling/opus'

describe('configureOpusSdp', () => {
  it('should append Opus parameters to fmtp lines', () => {
    const sdp = 'a=fmtp:111 minptime=10;useinbandfec=1'
    const result = configureOpusSdp(sdp)
    expect(result).toBe(
      'a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=60000;stereo=0;useinbandfec=1'
    )
  })

  it('should handle multiple fmtp lines', () => {
    const sdp = [
      'a=fmtp:111 minptime=10',
      'a=fmtp:112 minptime=10',
    ].join('\n')
    const result = configureOpusSdp(sdp)
    expect(result).toContain('a=fmtp:111 minptime=10;maxaveragebitrate=60000;stereo=0;useinbandfec=1')
    expect(result).toContain('a=fmtp:112 minptime=10;maxaveragebitrate=60000;stereo=0;useinbandfec=1')
  })

  it('should not modify SDP without fmtp lines', () => {
    const sdp = 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\ns=-\r\n'
    const result = configureOpusSdp(sdp)
    expect(result).toBe(sdp)
  })

  it('should return empty string for empty input', () => {
    expect(configureOpusSdp('')).toBe('')
  })

  it('should handle SDP with various codec IDs', () => {
    const sdp = 'a=fmtp:96 apt=100'
    const result = configureOpusSdp(sdp)
    expect(result).toContain(';maxaveragebitrate=60000')
    expect(result).toContain(';stereo=0')
    expect(result).toContain(';useinbandfec=1')
  })

  it('should preserve surrounding SDP content', () => {
    const sdp = [
      'v=0',
      'o=- 123 456 IN IP4 127.0.0.1',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1',
      'a=ssrc:12345 cname:test',
    ].join('\r\n')
    const result = configureOpusSdp(sdp)
    expect(result).toContain('v=0')
    expect(result).toContain('a=rtpmap:111 opus/48000/2')
    expect(result).toContain('a=ssrc:12345 cname:test')
    expect(result).toContain(';maxaveragebitrate=60000;stereo=0;useinbandfec=1')
  })
})
