import { useCallback, useRef, useState } from 'react'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastMessage {
  id: string
  message: string
  type: ToastType
}

interface UseToastNotificationsOptions {
  autoDismissMs?: number
}

export function useToastNotifications(options: UseToastNotificationsOptions = {}) {
  const { autoDismissMs = 3000 } = options
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const toastTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
    const timeoutId = toastTimeoutsRef.current.get(id)
    if (timeoutId) {
      clearTimeout(timeoutId)
      toastTimeoutsRef.current.delete(id)
    }
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])

    const timeoutId = setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id))
      toastTimeoutsRef.current.delete(id)
    }, autoDismissMs)
    toastTimeoutsRef.current.set(id, timeoutId)
  }, [autoDismissMs])

  const clearToasts = useCallback(() => {
    toastTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId))
    toastTimeoutsRef.current.clear()
    setToasts([])
  }, [])

  return {
    toasts,
    showToast,
    dismissToast,
    clearToasts
  }
}
