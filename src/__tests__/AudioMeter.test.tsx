/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AudioMeter } from '../renderer/components/AudioMeter'

describe('AudioMeter Component', () => {
    it('should render correct number of bars for different sizes', () => {
        const { container: sm } = render(<AudioMeter level={50} size="sm" />)
        expect(sm.firstElementChild?.children.length).toBe(8)
        cleanup() // Manual cleanup to avoid interference

        const { container: md } = render(<AudioMeter level={50} size="md" />)
        expect(md.firstElementChild?.children.length).toBe(12)
        cleanup()

        const { container: lg } = render(<AudioMeter level={50} size="lg" />)
        expect(lg.firstElementChild?.children.length).toBe(16)
        cleanup()
    })

    it('should show value when showValue prop is true', () => {
        render(<AudioMeter level={75} showValue={true} />)
        expect(screen.getByText('75%')).toBeDefined()
    })

    it('should apply correct color classes based on level', () => {
        // Render large meter (16 bars)
        const { container } = render(<AudioMeter level={100} size="lg" />)
        const bars = container.querySelectorAll('.flex > div')

        // Check static color classes assigned based on index
        // Index 0-60% (0-9) -> green
        expect(bars[0].className).toContain('bg-green-500')
        expect(bars[8].className).toContain('bg-green-500') // ~56%

        // Index 60-80% (10-12) -> yellow
        expect(bars[10].className).toContain('bg-yellow-500') // 62.5%

        // Index 80-100% (13-15) -> red
        expect(bars[13].className).toContain('bg-red-500')
        expect(bars[15].className).toContain('bg-red-500')
    })

    it('should adjust opacity based on input level', () => {
        const level = 50 // 50%
        const { container } = render(<AudioMeter level={level} size="sm" />)
        const bars = container.querySelectorAll('.flex > div')

        // 8 bars. 50% means 4 bars active.
        // Bar 0 (0-12.5%): active
        // Bar 3 (37.5-50%): active
        // Bar 4 (50-62.5%): inactive

        const bar3 = bars[3] as HTMLElement
        const bar4 = bars[4] as HTMLElement

        // Check active/inactive classes/integrity
        expect(bar3.className).not.toContain('bg-gray-200')
        expect(bar4.className).toContain('bg-gray-200')

        expect(bar3.style.opacity).toBe('1')
        expect(bar4.style.opacity).toBe('0.3')
    })
})
