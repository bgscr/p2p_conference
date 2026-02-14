import { SignalingLog } from '../../utils/Logger'

interface EventTargetLike {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
}

interface RegisterNetworkMonitoringOptions {
  target: EventTargetLike | null | undefined
  onOnline: () => void
  onOffline: () => void
  getIsOnline: () => boolean
}

interface RegisterBeforeUnloadHandlerOptions {
  target: EventTargetLike | null | undefined
  onBeforeUnload: () => void
}

export function registerNetworkMonitoring(options: RegisterNetworkMonitoringOptions): boolean {
  const {
    target,
    onOnline,
    onOffline,
    getIsOnline
  } = options

  if (!target) {
    return false
  }

  target.addEventListener('online', onOnline)
  target.addEventListener('offline', onOffline)

  SignalingLog.info('Network monitoring initialized', {
    isOnline: getIsOnline()
  })

  return true
}

export function registerBeforeUnloadHandler(options: RegisterBeforeUnloadHandlerOptions): boolean {
  const {
    target,
    onBeforeUnload
  } = options

  if (!target) {
    return false
  }

  target.addEventListener('beforeunload', onBeforeUnload)
  return true
}
