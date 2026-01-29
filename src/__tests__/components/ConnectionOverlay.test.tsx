/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConnectionOverlay } from '../../renderer/components/ConnectionOverlay'

// Mock useI18n
vi.mock('../../renderer/hooks/useI18n', () => ({
    useI18n: () => ({
        t: (key: string, params?: Record<string, string | number>) => {
            const translations: Record<string, string> = {
                'connection.searching': 'Searching for participants...',
                'connection.searchingSubtitle': 'Looking for peers in the room',
                'connection.establishing': 'Establishing connection...',
                'connection.establishingSubtitle': 'Setting up P2P connection',
                'connection.failed': 'Connection Failed',
                'connection.failedSubtitle': 'Unable to establish connection',
                'connection.connecting': 'Connecting...',
                'connection.searchingFor': `Searching for ${params?.seconds || 0}s`,
                'connection.takingLonger': 'This is taking longer than expected',
                'connection.checkRoomId': 'Please verify the room ID is correct',
                'connection.mayTakeTime': 'Peer discovery may take some time',
                'common.cancel': 'Cancel',
                'common.back': 'Back'
            }
            return translations[key] || key
        }
    })
}))

describe('ConnectionOverlay', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('renders signaling state correctly', () => {
        render(<ConnectionOverlay state="signaling" />)

        expect(screen.getByText('Searching for participants...')).toBeInTheDocument()
        expect(screen.getByText('Looking for peers in the room')).toBeInTheDocument()
    })

    it('renders connecting state correctly', () => {
        render(<ConnectionOverlay state="connecting" />)

        expect(screen.getByText('Establishing connection...')).toBeInTheDocument()
        expect(screen.getByText('Setting up P2P connection')).toBeInTheDocument()
    })

    it('renders failed state correctly', () => {
        render(<ConnectionOverlay state="failed" />)

        expect(screen.getByText('Connection Failed')).toBeInTheDocument()
        expect(screen.getByText('Unable to establish connection')).toBeInTheDocument()
    })

    it('shows cancel button when onCancel is provided and not failed', () => {
        const onCancel = vi.fn()
        render(<ConnectionOverlay state="signaling" onCancel={onCancel} />)

        expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('shows back button when state is failed and onCancel is provided', () => {
        const onCancel = vi.fn()
        render(<ConnectionOverlay state="failed" onCancel={onCancel} />)

        expect(screen.getByText('Back')).toBeInTheDocument()
    })

    it('calls onCancel when cancel button is clicked', () => {
        const onCancel = vi.fn()
        render(<ConnectionOverlay state="signaling" onCancel={onCancel} />)

        fireEvent.click(screen.getByText('Cancel'))

        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when back button is clicked in failed state', () => {
        const onCancel = vi.fn()
        render(<ConnectionOverlay state="failed" onCancel={onCancel} />)

        fireEvent.click(screen.getByText('Back'))

        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('shows elapsed time during signaling', () => {
        render(<ConnectionOverlay state="signaling" />)

        // Initial state should show 0s
        expect(screen.getByText(/Searching for 0s/)).toBeInTheDocument()

        // Advance time by 5 seconds
        act(() => {
            vi.advanceTimersByTime(5000)
        })

        expect(screen.getByText(/Searching for 5s/)).toBeInTheDocument()
    })

    it('shows timeout warning after 20 seconds', () => {
        render(<ConnectionOverlay state="signaling" />)

        // Initially no warning
        expect(screen.queryByText('This is taking longer than expected')).not.toBeInTheDocument()

        // Advance time by 21 seconds
        act(() => {
            vi.advanceTimersByTime(21000)
        })

        expect(screen.getByText('This is taking longer than expected')).toBeInTheDocument()
        expect(screen.getByText('Please verify the room ID is correct')).toBeInTheDocument()
    })

    it('shows spinner for non-failed states', () => {
        const { container, rerender } = render(<ConnectionOverlay state="signaling" />)

        // Check for spinner (animated element)
        expect(container.querySelector('.animate-spin')).toBeInTheDocument()

        rerender(<ConnectionOverlay state="connecting" />)
        expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('shows error icon for failed state', () => {
        const { container } = render(<ConnectionOverlay state="failed" />)

        // No spinner in failed state
        expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()

        // Should have the error icon container
        expect(container.querySelector('.bg-red-100')).toBeInTheDocument()
    })

    it('resets elapsed time when state changes from signaling', () => {
        const { rerender } = render(<ConnectionOverlay state="signaling" />)

        // Advance time
        act(() => {
            vi.advanceTimersByTime(10000)
        })

        expect(screen.getByText(/Searching for 10s/)).toBeInTheDocument()

        // Change state
        rerender(<ConnectionOverlay state="connecting" />)

        // Time display should be gone (not in connecting state)
        expect(screen.queryByText(/Searching for/)).not.toBeInTheDocument()

        // Go back to signaling
        rerender(<ConnectionOverlay state="signaling" />)

        // Should reset to 0
        expect(screen.getByText(/Searching for 0s/)).toBeInTheDocument()
    })

    it('hides cancel button when onCancel is not provided', () => {
        render(<ConnectionOverlay state="signaling" />)

        expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
    })

    it('shows may take time notice before timeout warning', () => {
        render(<ConnectionOverlay state="signaling" />)

        expect(screen.getByText('Peer discovery may take some time')).toBeInTheDocument()

        // After timeout, this notice should be hidden
        act(() => {
            vi.advanceTimersByTime(21000)
        })

        expect(screen.queryByText('Peer discovery may take some time')).not.toBeInTheDocument()
    })
})
