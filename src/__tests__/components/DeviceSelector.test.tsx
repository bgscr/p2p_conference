/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DeviceSelector } from '../../renderer/components/DeviceSelector'

describe('DeviceSelector', () => {
    const mockDevices = [
        { deviceId: '1', label: 'Device 1', kind: 'audioinput' as const, groupId: 'g1' },
        { deviceId: '2', label: 'Device 2', kind: 'audioinput' as const, groupId: 'g1' }
    ]

    it('renders label and options correctly', () => {
        render(
            <DeviceSelector
                label="Microphone"
                devices={mockDevices}
                selectedDeviceId="1"
                onSelect={() => { }}
            />
        )
        expect(screen.getByText('Microphone')).toBeInTheDocument()
        expect(screen.getByRole('combobox')).toHaveValue('1')
        expect(screen.getAllByRole('option')).toHaveLength(2)
        expect(screen.getByText('Device 1')).toBeInTheDocument()
    })

    it('calls onSelect when selection changes', () => {
        const handleSelect = vi.fn()
        render(
            <DeviceSelector
                label="Microphone"
                devices={mockDevices}
                selectedDeviceId="1"
                onSelect={handleSelect}
            />
        )

        fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } })
        expect(handleSelect).toHaveBeenCalledWith('2')
    })

    it('displays no devices message when empty', () => {
        render(
            <DeviceSelector
                label="Microphone"
                devices={[]}
                selectedDeviceId=""
                onSelect={() => { }}
            />
        )
        expect(screen.getByRole('combobox')).toBeDisabled()
        expect(screen.getByText('No devices found')).toBeInTheDocument()
    })
})
