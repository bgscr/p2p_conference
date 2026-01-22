/**
 * LeaveConfirmDialog Component
 * Modal dialog to confirm leaving the call
 */

import React from 'react'
import { useI18n } from '../hooks/useI18n'

interface LeaveConfirmDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

export const LeaveConfirmDialog: React.FC<LeaveConfirmDialogProps> = ({
  onConfirm,
  onCancel
}) => {
  const { t } = useI18n()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{t('leaveConfirm.title')}</h2>
        </div>
        
        {/* Content */}
        <div className="px-6 py-4">
          <p className="text-gray-600">{t('leaveConfirm.message')}</p>
        </div>
        
        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="btn btn-secondary"
          >
            {t('leaveConfirm.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="btn bg-red-600 text-white hover:bg-red-700"
          >
            {t('leaveConfirm.leave')}
          </button>
        </div>
      </div>
    </div>
  )
}
