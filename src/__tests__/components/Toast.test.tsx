/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Toast } from '../../renderer/components/Toast'

describe('Toast', () => {
    it('renders info toast correctly', () => {
        const onDismiss = vi.fn()
        render(<Toast message="Info message" type="info" onDismiss={onDismiss} />)

        expect(screen.getByText('Info message')).toBeInTheDocument()
    })

    it('renders success toast correctly', () => {
        const onDismiss = vi.fn()
        render(<Toast message="Success message" type="success" onDismiss={onDismiss} />)

        expect(screen.getByText('Success message')).toBeInTheDocument()
    })

    it('renders warning toast correctly', () => {
        const onDismiss = vi.fn()
        render(<Toast message="Warning message" type="warning" onDismiss={onDismiss} />)

        expect(screen.getByText('Warning message')).toBeInTheDocument()
    })

    it('renders error toast correctly', () => {
        const onDismiss = vi.fn()
        render(<Toast message="Error message" type="error" onDismiss={onDismiss} />)

        expect(screen.getByText('Error message')).toBeInTheDocument()
    })

    it('calls onDismiss when toast is clicked', () => {
        const onDismiss = vi.fn()
        render(<Toast message="Click me" type="info" onDismiss={onDismiss} />)

        const toast = screen.getByText('Click me').closest('div')
        fireEvent.click(toast!)

        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('calls onDismiss when close button is clicked', () => {
        const onDismiss = vi.fn()
        render(<Toast message="Test" type="info" onDismiss={onDismiss} />)

        // Find the close button (the small x button)
        const closeButton = screen.getByRole('button')
        fireEvent.click(closeButton)

        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('close button click does not propagate to parent', () => {
        const onDismiss = vi.fn()
        render(<Toast message="Test" type="info" onDismiss={onDismiss} />)

        const closeButton = screen.getByRole('button')
        fireEvent.click(closeButton)

        // Should only be called once, not twice (once from button, once from div)
        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('applies correct background color for each type', () => {
        const { rerender } = render(<Toast message="Test" type="info" onDismiss={() => { }} />)
        let container = screen.getByText('Test').closest('div')
        expect(container).toHaveClass('bg-gray-800')

        rerender(<Toast message="Test" type="success" onDismiss={() => { }} />)
        container = screen.getByText('Test').closest('div')
        expect(container).toHaveClass('bg-green-600')

        rerender(<Toast message="Test" type="warning" onDismiss={() => { }} />)
        container = screen.getByText('Test').closest('div')
        expect(container).toHaveClass('bg-yellow-500')

        rerender(<Toast message="Test" type="error" onDismiss={() => { }} />)
        container = screen.getByText('Test').closest('div')
        expect(container).toHaveClass('bg-red-600')
    })
})
