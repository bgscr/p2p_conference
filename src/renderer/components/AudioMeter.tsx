/**
 * AudioMeter Component
 * Visual representation of audio level
 */

import React from 'react'

interface AudioMeterProps {
  level: number // 0-100
  size?: 'sm' | 'md' | 'lg'
  showValue?: boolean
}

export const AudioMeter: React.FC<AudioMeterProps> = ({
  level,
  size = 'md',
  showValue = false
}) => {
  // Clamp level between 0 and 100
  const clampedLevel = Math.max(0, Math.min(100, level))

  // Get bar heights for each segment
  const bars = size === 'sm' ? 8 : size === 'md' ? 12 : 16
  
  const getBarHeight = (index: number): number => {
    const threshold = (index + 1) * (100 / bars)
    if (clampedLevel >= threshold) {
      return 100
    } else if (clampedLevel >= threshold - (100 / bars)) {
      const partial = (clampedLevel - (threshold - (100 / bars))) / (100 / bars)
      return Math.max(20, partial * 100)
    }
    return 20 // Minimum height for visual presence
  }

  // Get bar color based on position
  const getBarColor = (index: number): string => {
    const position = (index + 1) / bars
    if (position > 0.8) return 'bg-red-500'
    if (position > 0.6) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const heightClass = size === 'sm' ? 'h-4' : size === 'md' ? 'h-6' : 'h-8'

  return (
    <div className="flex items-end gap-0.5">
      {Array.from({ length: bars }).map((_, index) => (
        <div
          key={index}
          className={`
            ${heightClass} flex-1 rounded-sm transition-all duration-75
            ${clampedLevel > (index * (100 / bars)) ? getBarColor(index) : 'bg-gray-200'}
          `}
          style={{
            opacity: clampedLevel > (index * (100 / bars)) ? 1 : 0.3,
            transform: `scaleY(${getBarHeight(index) / 100})`
          }}
        />
      ))}
      {showValue && (
        <span className="ml-2 text-xs font-mono text-gray-500 w-8">
          {Math.round(clampedLevel)}%
        </span>
      )}
    </div>
  )
}
