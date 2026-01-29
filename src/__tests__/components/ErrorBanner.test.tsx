/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ErrorBanner } from '../../renderer/components/ErrorBanner'

describe('ErrorBanner', () => {
    it('renders message correctly', () => {
        const message = 'Test Error Message'
        render(<ErrorBanner message={message} onDismiss={() => { }} />)
        expect(screen.getByText(message)).toBeInTheDocument()
    })

    it('calls onDismiss when close button is clicked', () => {
        const handleDismiss = vi.fn()
        render(<ErrorBanner message="Error" onDismiss={handleDismiss} />)

        const button = screen.getByRole('button')
        fireEvent.click(button)

        expect(handleDismiss).toHaveBeenCalledTimes(1)
    })
})
