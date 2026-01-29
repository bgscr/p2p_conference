/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { LeaveConfirmDialog } from '../../renderer/components/LeaveConfirmDialog'

// Mock useI18n
vi.mock('../../renderer/hooks/useI18n', () => ({
    useI18n: () => ({
        t: (key: string) => {
            const translations: Record<string, string> = {
                'leaveConfirm.title': 'Leave Call?',
                'leaveConfirm.message': 'Are you sure you want to leave the call?',
                'leaveConfirm.cancel': 'Cancel',
                'leaveConfirm.leave': 'Leave'
            }
            return translations[key] || key
        }
    })
}))

describe('LeaveConfirmDialog', () => {
    it('renders dialog with title and message', () => {
        const onConfirm = vi.fn()
        const onCancel = vi.fn()

        render(<LeaveConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />)

        expect(screen.getByText('Leave Call?')).toBeInTheDocument()
        expect(screen.getByText('Are you sure you want to leave the call?')).toBeInTheDocument()
    })

    it('renders cancel and leave buttons', () => {
        const onConfirm = vi.fn()
        const onCancel = vi.fn()

        render(<LeaveConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />)

        expect(screen.getByText('Cancel')).toBeInTheDocument()
        expect(screen.getByText('Leave')).toBeInTheDocument()
    })

    it('calls onCancel when cancel button is clicked', () => {
        const onConfirm = vi.fn()
        const onCancel = vi.fn()

        render(<LeaveConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />)

        fireEvent.click(screen.getByText('Cancel'))

        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(onConfirm).not.toHaveBeenCalled()
    })

    it('calls onConfirm when leave button is clicked', () => {
        const onConfirm = vi.fn()
        const onCancel = vi.fn()

        render(<LeaveConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />)

        fireEvent.click(screen.getByText('Leave'))

        expect(onConfirm).toHaveBeenCalledTimes(1)
        expect(onCancel).not.toHaveBeenCalled()
    })

    it('has proper overlay styling', () => {
        render(<LeaveConfirmDialog onConfirm={() => { }} onCancel={() => { }} />)

        // Find the overlay container (first div)
        const overlay = screen.getByText('Leave Call?').closest('.fixed')
        expect(overlay).toHaveClass('inset-0')
        expect(overlay).toHaveClass('z-50')
    })
})
