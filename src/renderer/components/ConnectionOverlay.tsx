/**
 * ConnectionOverlay Component
 * Full-screen overlay showing connection progress with cancel option
 * Includes timeout warning after 20 seconds
 */

import React, { useState, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import type { ConnectionState } from '@/types'

const TIMEOUT_WARNING_SECONDS = 20
const MAX_SEARCH_SECONDS = 60

interface ConnectionOverlayProps {
  state: ConnectionState
  onCancel?: () => void
}

export const ConnectionOverlay: React.FC<ConnectionOverlayProps> = ({ state, onCancel }) => {
  const { t } = useI18n()
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false)
  
  // Track elapsed time during signaling
  useEffect(() => {
    if (state !== 'signaling') {
      setElapsedSeconds(0)
      setShowTimeoutWarning(false)
      return
    }
    
    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setElapsedSeconds(elapsed)
      
      if (elapsed >= TIMEOUT_WARNING_SECONDS && !showTimeoutWarning) {
        setShowTimeoutWarning(true)
      }
    }, 1000)
    
    return () => clearInterval(interval)
  }, [state, showTimeoutWarning])
  
  const getMessage = (): { title: string; subtitle: string } => {
    switch (state) {
      case 'signaling':
        return {
          title: t('connection.searching'),
          subtitle: t('connection.searchingSubtitle')
        }
      case 'connecting':
        return {
          title: t('connection.establishing'),
          subtitle: t('connection.establishingSubtitle')
        }
      case 'failed':
        return {
          title: t('connection.failed'),
          subtitle: t('connection.failedSubtitle')
        }
      default:
        return {
          title: t('connection.connecting'),
          subtitle: ''
        }
    }
  }

  const { title, subtitle } = getMessage()
  const progressPercent = Math.min((elapsedSeconds / MAX_SEARCH_SECONDS) * 100, 100)

  return (
    <div className="fixed inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="text-center animate-fade-in max-w-md px-4">
        {/* Spinner */}
        {state !== 'failed' && (
          <div className="relative mx-auto w-20 h-20 mb-6">
            <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
          </div>
        )}

        {/* Error Icon */}
        {state === 'failed' && (
          <div className="mx-auto w-20 h-20 mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )}

        {/* Text */}
        <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
        {subtitle && (
          <p className="text-sm text-gray-500 max-w-xs mx-auto">{subtitle}</p>
        )}

        {/* Elapsed Time Counter */}
        {state === 'signaling' && (
          <div className="mt-4">
            <p className="text-sm text-gray-500">
              {t('connection.searchingFor', { seconds: elapsedSeconds })}
            </p>
            
            {/* Progress Bar */}
            <div className="mt-3 w-48 h-1.5 bg-gray-200 rounded-full mx-auto overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${
                  showTimeoutWarning ? 'bg-yellow-500' : 'bg-blue-500'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Timeout Warning */}
        {state === 'signaling' && showTimeoutWarning && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-left">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-yellow-500 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-sm font-medium text-yellow-800">
                  {t('connection.takingLonger')}
                </p>
                <p className="text-xs text-yellow-700 mt-1">
                  {t('connection.checkRoomId')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* DHT Discovery Notice */}
        {state === 'signaling' && !showTimeoutWarning && (
          <div className="mt-6 text-xs text-gray-400 max-w-sm mx-auto">
            <p>{t('connection.mayTakeTime')}</p>
          </div>
        )}

        {/* Cancel Button */}
        {onCancel && state !== 'failed' && (
          <button
            onClick={onCancel}
            className="mt-6 px-6 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {t('common.cancel')}
          </button>
        )}

        {/* Back Button for failed state */}
        {onCancel && state === 'failed' && (
          <button
            onClick={onCancel}
            className="mt-8 px-6 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors"
          >
            {t('common.back')}
          </button>
        )}
      </div>
    </div>
  )
}
