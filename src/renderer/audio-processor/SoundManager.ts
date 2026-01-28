/**
 * Sound effects for the application
 * Uses Web Audio API to generate simple notification sounds
 */

import { logger } from '../utils/Logger'

const SoundLog = logger.createModuleLogger('Sound')

class SoundManager {
  private audioContext: AudioContext | null = null
  private enabled: boolean = true

  /**
   * Initialize the audio context (must be called after user interaction)
   */
  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }
    return this.audioContext
  }

  /**
   * Enable or disable sounds
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Check if sounds are enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Play a pleasant "join" sound - ascending tone
   */
  playJoin(): void {
    if (!this.enabled) return

    try {
      const ctx = this.getContext()
      const now = ctx.currentTime

      // Create oscillator for the tone
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      // Pleasant ascending two-tone chime
      osc.type = 'sine'
      osc.frequency.setValueAtTime(523.25, now) // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1) // E5

      // Envelope
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.3, now + 0.02)
      gain.gain.linearRampToValueAtTime(0.2, now + 0.1)
      gain.gain.linearRampToValueAtTime(0.3, now + 0.12)
      gain.gain.linearRampToValueAtTime(0, now + 0.3)

      osc.start(now)
      osc.stop(now + 0.3)
    } catch (err) {
      SoundLog.warn('Failed to play join sound', err)
    }
  }

  /**
   * Play a "leave" sound - descending tone
   */
  playLeave(): void {
    if (!this.enabled) return

    try {
      const ctx = this.getContext()
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      // Descending two-tone
      osc.type = 'sine'
      osc.frequency.setValueAtTime(523.25, now) // C5
      osc.frequency.setValueAtTime(392.0, now + 0.1) // G4

      // Envelope
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.25, now + 0.02)
      gain.gain.linearRampToValueAtTime(0.15, now + 0.1)
      gain.gain.linearRampToValueAtTime(0.2, now + 0.12)
      gain.gain.linearRampToValueAtTime(0, now + 0.25)

      osc.start(now)
      osc.stop(now + 0.25)
    } catch (err) {
      SoundLog.warn('Failed to play leave sound', err)
    }
  }

  /**
   * Play a subtle "connected" sound
   */
  playConnected(): void {
    if (!this.enabled) return

    try {
      const ctx = this.getContext()
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      // Quick positive chime
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, now) // A5

      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.2, now + 0.01)
      gain.gain.linearRampToValueAtTime(0, now + 0.15)

      osc.start(now)
      osc.stop(now + 0.15)
    } catch (err) {
      SoundLog.warn('Failed to play connected sound', err)
    }
  }

  /**
   * Play an error/disconnect sound
   */
  playError(): void {
    if (!this.enabled) return

    try {
      const ctx = this.getContext()
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      // Low warning tone
      osc.type = 'sine'
      osc.frequency.setValueAtTime(220, now) // A3
      osc.frequency.setValueAtTime(196, now + 0.15) // G3

      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.25, now + 0.02)
      gain.gain.linearRampToValueAtTime(0.2, now + 0.15)
      gain.gain.linearRampToValueAtTime(0, now + 0.3)

      osc.start(now)
      osc.stop(now + 0.3)
    } catch (err) {
      SoundLog.warn('Failed to play error sound', err)
    }
  }

  /**
   * Play mute/unmute click sound
   */
  playClick(): void {
    if (!this.enabled) return

    try {
      const ctx = this.getContext()
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.setValueAtTime(1000, now)

      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.1, now + 0.005)
      gain.gain.linearRampToValueAtTime(0, now + 0.05)

      osc.start(now)
      osc.stop(now + 0.05)
    } catch (err) {
      SoundLog.warn('Failed to play click sound', err)
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }
}

// Singleton instance
export const soundManager = new SoundManager()
