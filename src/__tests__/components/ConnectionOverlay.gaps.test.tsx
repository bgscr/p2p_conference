/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for ConnectionOverlay
 * Targets:
 * - Line 63: Default case in getMessage switch statement
 * - Timeout warning display after 20 seconds
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ConnectionOverlay } from '../../renderer/components/ConnectionOverlay'
import type { ConnectionState } from '@/types'

// Mock useI18n hook
vi.mock('../../renderer/hooks/useI18n', () => ({
    useI18n: () => ({
        t: (key: string, params?: Record<string, any>) => {
            const translations: Record<string, string> = {
                'connection.searching': 'Searching for participants...',
                'connection.searchingSubtitle': 'Looking for others in this room',
                'connection.establishing': 'Establishing connection...',
                'connection.establishingSubtitle': 'Setting up peer-to-peer audio channels',
                'connection.failed': 'Connection failed',
                'connection.failedSubtitle': 'Please check your network and try again',
                'connection.connecting': 'Connecting...',
                'connection.searchingFor': `Searching for ${params?.seconds || 0} seconds...`,
                'connection.takingLonger': 'Taking longer than expected',
                'connection.checkRoomId': 'Check room ID',
                'connection.mayTakeTime': 'This may take a few seconds...',
                'common.cancel': 'Cancel',
                'common.back': 'Back',
            }
            return translations[key] || key
        }
    })
}))

describe('ConnectionOverlay - coverage gaps', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('getMessage default case (line 63)', () => {
        it('shows default connecting message for idle state', () => {
            render(<ConnectionOverlay state={'idle' as ConnectionState} />)

            expect(screen.getByText('Connecting...')).toBeInTheDocument()
        })

        it('shows default connecting message for disconnected state', () => {
            render(<ConnectionOverlay state={'disconnected' as ConnectionState} />)

            expect(screen.getByText('Connecting...')).toBeInTheDocument()
        })

        it('shows default connecting message for unknown state', () => {
            render(<ConnectionOverlay state={'unknown' as ConnectionState} />)

            expect(screen.getByText('Connecting...')).toBeInTheDocument()
        })
    })

    describe('signaling state', () => {
        it('shows searching message for signaling state', () => {
            render(<ConnectionOverlay state="signaling" />)

            expect(screen.getByText('Searching for participants...')).toBeInTheDocument()
        })

        it('shows elapsed time counter', () => {
            render(<ConnectionOverlay state="signaling" />)

            // Initially shows 0 seconds
            expect(screen.getByText('Searching for 0 seconds...')).toBeInTheDocument()

            // Advance time by 5 seconds
            act(() => {
                vi.advanceTimersByTime(5000)
            })

            expect(screen.getByText('Searching for 5 seconds...')).toBeInTheDocument()
        })

        it('shows may take time message before timeout', () => {
            render(<ConnectionOverlay state="signaling" />)

            expect(screen.getByText('This may take a few seconds...')).toBeInTheDocument()
        })

        it('shows timeout warning after 20 seconds', () => {
            render(<ConnectionOverlay state="signaling" />)

            // Advance past timeout threshold (20 seconds)
            act(() => {
                vi.advanceTimersByTime(21000)
            })

            expect(screen.getByText('Taking longer than expected')).toBeInTheDocument()
            expect(screen.getByText('Check room ID')).toBeInTheDocument()
        })

        it('shows progress bar with yellow color after timeout', () => {
            const { container } = render(<ConnectionOverlay state="signaling" />)

            // Advance past timeout threshold
            act(() => {
                vi.advanceTimersByTime(21000)
            })

            const progressBar = container.querySelector('.bg-yellow-500')
            expect(progressBar).toBeInTheDocument()
        })

        it('shows progress bar with blue color before timeout', () => {
            const { container } = render(<ConnectionOverlay state="signaling" />)

            const progressBar = container.querySelector('.bg-blue-500')
            expect(progressBar).toBeInTheDocument()
        })
    })

    describe('connecting state', () => {
        it('shows establishing message for connecting state', () => {
            render(<ConnectionOverlay state="connecting" />)

            expect(screen.getByText('Establishing connection...')).toBeInTheDocument()
            expect(screen.getByText('Setting up peer-to-peer audio channels')).toBeInTheDocument()
        })

        it('shows spinner for connecting state', () => {
            const { container } = render(<ConnectionOverlay state="connecting" />)

            const spinner = container.querySelector('.animate-spin')
            expect(spinner).toBeInTheDocument()
        })
    })

    describe('failed state', () => {
        it('shows failure message', () => {
            render(<ConnectionOverlay state="failed" />)

            expect(screen.getByText('Connection failed')).toBeInTheDocument()
            expect(screen.getByText('Please check your network and try again')).toBeInTheDocument()
        })

        it('shows error icon instead of spinner', () => {
            const { container } = render(<ConnectionOverlay state="failed" />)

            // Should not have spinner
            const spinner = container.querySelector('.animate-spin')
            expect(spinner).not.toBeInTheDocument()

            // Should have error icon (red background)
            const errorIcon = container.querySelector('.bg-red-100')
            expect(errorIcon).toBeInTheDocument()
        })

        it('shows back button instead of cancel', () => {
            const onCancel = vi.fn()
            render(<ConnectionOverlay state="failed" onCancel={onCancel} />)

            expect(screen.getByText('Back')).toBeInTheDocument()
        })
    })

    describe('cancel button', () => {
        it('shows cancel button when onCancel provided and not failed', () => {
            const onCancel = vi.fn()
            render(<ConnectionOverlay state="signaling" onCancel={onCancel} />)

            expect(screen.getByText('Cancel')).toBeInTheDocument()
        })

        it('does not show cancel button when onCancel not provided', () => {
            render(<ConnectionOverlay state="signaling" />)

            expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
        })

        it('calls onCancel when cancel button clicked', () => {
            const onCancel = vi.fn()
            render(<ConnectionOverlay state="signaling" onCancel={onCancel} />)

            const cancelButton = screen.getByText('Cancel')
            cancelButton.click()

            expect(onCancel).toHaveBeenCalledTimes(1)
        })

        it('calls onCancel when back button clicked in failed state', () => {
            const onCancel = vi.fn()
            render(<ConnectionOverlay state="failed" onCancel={onCancel} />)

            const backButton = screen.getByText('Back')
            backButton.click()

            expect(onCancel).toHaveBeenCalledTimes(1)
        })
    })

    describe('state transitions', () => {
        it('resets timer when state changes from signaling', () => {
            const { rerender } = render(<ConnectionOverlay state="signaling" />)

            // Advance time
            act(() => {
                vi.advanceTimersByTime(10000)
            })

            expect(screen.getByText('Searching for 10 seconds...')).toBeInTheDocument()

            // Change state
            rerender(<ConnectionOverlay state="connecting" />)

            // Timer should be reset (no longer showing elapsed time)
            expect(screen.queryByText(/Searching for/)).not.toBeInTheDocument()
        })

        it('clears timeout warning when state changes', () => {
            const { rerender } = render(<ConnectionOverlay state="signaling" />)

            // Trigger timeout warning
            act(() => {
                vi.advanceTimersByTime(25000)
            })

            expect(screen.getByText('Taking longer than expected')).toBeInTheDocument()

            // Change to connected
            rerender(<ConnectionOverlay state="connecting" />)

            expect(screen.queryByText('Taking longer than expected')).not.toBeInTheDocument()
        })
    })
})
