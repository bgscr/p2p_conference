/**
 * DeviceSelector Component
 * Dropdown for selecting audio input/output devices
 */

import React from 'react'
import type { AudioDevice } from '@/types'

interface DeviceSelectorProps {
  label: string
  devices: AudioDevice[]
  selectedDeviceId: string | null
  onSelect: (deviceId: string) => void
  disabled?: boolean
  icon?: 'mic' | 'speaker'
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  label,
  devices,
  selectedDeviceId,
  onSelect,
  disabled = false,
  icon = 'mic'
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onSelect(e.target.value)
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
        {icon === 'mic' ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        )}
        {label}
      </label>
      
      <select
        value={selectedDeviceId || ''}
        onChange={handleChange}
        disabled={disabled || devices.length === 0}
        className={`
          w-full px-3 py-2 
          border border-gray-300 rounded-lg
          bg-white text-gray-900
          focus:ring-2 focus:ring-blue-500 focus:border-blue-500
          disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed
          transition-colors
        `}
      >
        {devices.length === 0 ? (
          <option value="">No devices found</option>
        ) : (
          devices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))
        )}
      </select>
    </div>
  )
}
