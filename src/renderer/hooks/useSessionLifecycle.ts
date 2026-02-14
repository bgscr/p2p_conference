import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Peer,
  RemoteMicControlMessage,
  RemoteMicSession,
  RemoteMicStopReason,
  VirtualAudioInstallResult,
  VirtualAudioInstallerState,
  VirtualMicDeviceStatus
} from '@/types'
import type { PeerManager } from '../signaling'

export type PlatformType = 'win' | 'mac' | 'linux'

type ToastType = 'info' | 'success' | 'warning' | 'error'

interface UseSessionLifecycleOptions {
  peerManager: PeerManager
  t: (key: string, params?: Record<string, string | number>) => string
  showToast: (message: string, type?: ToastType) => void
  localPlatform: PlatformType
  localPeerId: string
  peers: Map<string, Peer>
  virtualMicDeviceStatus: VirtualMicDeviceStatus
  refreshDevices: () => Promise<void>
}

interface UseSessionLifecycleResult {
  remoteMicSession: RemoteMicSession
  virtualAudioInstallerState: VirtualAudioInstallerState
  clearRemoteMicTimers: () => void
  resetRemoteMicSession: (nextState?: RemoteMicSession) => void
  handlePeerDisconnected: (peerId: string) => void
  handleRequestRemoteMic: (targetPeerId: string) => void
  handleRespondRemoteMicRequest: (accept: boolean) => Promise<void>
  handleStopRemoteMic: (reason?: RemoteMicStopReason) => void
  handleInstallRemoteMicDriver: () => Promise<void>
  handleRecheckVirtualMicDevice: () => Promise<void>
}

const REMOTE_MIC_REQUEST_TIMEOUT_MS = 30000
const REMOTE_MIC_INSTALL_TIMEOUT_MS = 180000
const REMOTE_MIC_OUTGOING_TIMEOUT_MS = REMOTE_MIC_REQUEST_TIMEOUT_MS + REMOTE_MIC_INSTALL_TIMEOUT_MS
const REMOTE_MIC_HEARTBEAT_INTERVAL_MS = 5000
const REMOTE_MIC_HEARTBEAT_TIMEOUT_MS = 15000

const REMOTE_MIC_STOP_REASON_SET: ReadonlySet<RemoteMicStopReason> = new Set<RemoteMicStopReason>([
  'stopped-by-source',
  'stopped-by-target',
  'rejected',
  'busy',
  'request-timeout',
  'heartbeat-timeout',
  'peer-disconnected',
  'virtual-device-missing',
  'virtual-device-install-failed',
  'virtual-device-restart-required',
  'user-cancelled',
  'routing-failed',
  'unknown'
])

export function normalizeRemoteMicStopReason(reason: unknown): RemoteMicStopReason {
  if (typeof reason !== 'string') return 'stopped-by-source'
  return REMOTE_MIC_STOP_REASON_SET.has(reason as RemoteMicStopReason)
    ? (reason as RemoteMicStopReason)
    : 'stopped-by-source'
}

export function isVirtualMicOutputReady(platform: PlatformType, devices: MediaDeviceInfo[]): boolean {
  if (platform === 'win') {
    return devices.some((device) => device.kind === 'audiooutput' && /cable input/i.test(device.label))
  }
  if (platform === 'mac') {
    return devices.some((device) => device.kind === 'audiooutput' && /blackhole/i.test(device.label))
  }
  return false
}

export function getVirtualAudioProviderForPlatform(
  platform: PlatformType
): VirtualAudioInstallResult['provider'] | null {
  if (platform === 'win') return 'vb-cable'
  if (platform === 'mac') return 'blackhole'
  return null
}

export function getVirtualAudioDeviceName(platform: PlatformType): string {
  if (platform === 'win') return 'VB-CABLE'
  if (platform === 'mac') return 'BlackHole 2ch'
  return 'Virtual Audio Device'
}

export function useSessionLifecycle({
  peerManager,
  t,
  showToast,
  localPlatform,
  localPeerId,
  peers,
  virtualMicDeviceStatus,
  refreshDevices
}: UseSessionLifecycleOptions): UseSessionLifecycleResult {
  const [remoteMicSession, setRemoteMicSession] = useState<RemoteMicSession>({ state: 'idle' })
  const [virtualAudioInstallerState, setVirtualAudioInstallerState] = useState<VirtualAudioInstallerState>({
    inProgress: false,
    platformSupported: localPlatform === 'win' || localPlatform === 'mac',
    bundleReady: true
  })

  const remoteMicRequestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remoteMicHeartbeatSendRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const remoteMicHeartbeatWatchRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const remoteMicLastHeartbeatAtRef = useRef<number>(0)

  const clearRemoteMicTimers = useCallback(() => {
    if (remoteMicRequestTimerRef.current) {
      clearTimeout(remoteMicRequestTimerRef.current)
      remoteMicRequestTimerRef.current = null
    }
    if (remoteMicHeartbeatSendRef.current) {
      clearInterval(remoteMicHeartbeatSendRef.current)
      remoteMicHeartbeatSendRef.current = null
    }
    if (remoteMicHeartbeatWatchRef.current) {
      clearInterval(remoteMicHeartbeatWatchRef.current)
      remoteMicHeartbeatWatchRef.current = null
    }
  }, [])

  const resetRemoteMicSession = useCallback((nextState: RemoteMicSession = { state: 'idle' }) => {
    clearRemoteMicTimers()
    setRemoteMicSession(nextState)
  }, [clearRemoteMicTimers])

  const syncVirtualAudioInstallerState = useCallback(async (): Promise<VirtualAudioInstallerState> => {
    const fallbackState: VirtualAudioInstallerState = {
      inProgress: false,
      platformSupported: localPlatform === 'win' || localPlatform === 'mac',
      bundleReady: true
    }

    try {
      const state = await window.electronAPI?.getVirtualAudioInstallerState?.()
      if (!state) {
        setVirtualAudioInstallerState(fallbackState)
        return fallbackState
      }

      const normalizedState: VirtualAudioInstallerState = {
        inProgress: state.inProgress,
        platformSupported: state.platformSupported,
        activeProvider: state.activeProvider,
        bundleReady: state.bundleReady !== false,
        bundleMessage: state.bundleMessage
      }
      setVirtualAudioInstallerState(normalizedState)
      return normalizedState
    } catch {
      setVirtualAudioInstallerState(fallbackState)
      return fallbackState
    }
  }, [localPlatform])

  const getInstallerPrecheckMessage = useCallback((reason?: string) => {
    return t('remoteMic.installPrecheckFailed', {
      reason: reason || t('remoteMic.installBundleMissingReasonDefault')
    })
  }, [t])

  const getRemoteMicRejectMessage = useCallback((reason?: string): string => {
    switch (reason) {
      case 'busy':
        return t('remoteMic.rejectedBusy')
      case 'virtual-device-missing':
        return t('remoteMic.rejectedVirtualDeviceMissing')
      case 'virtual-device-install-failed':
        return t('remoteMic.rejectedInstallFailed')
      case 'virtual-device-restart-required':
        return t('remoteMic.rejectedRestartRequired')
      case 'user-cancelled':
        return t('remoteMic.rejectedUserCancelled')
      case 'rejected':
        return t('remoteMic.requestRejected')
      default:
        return t('remoteMic.requestRejected')
    }
  }, [t])

  const installVirtualAudioDriver = useCallback(async (requestId: string): Promise<VirtualAudioInstallResult | null> => {
    const provider = getVirtualAudioProviderForPlatform(localPlatform)
    if (!provider) {
      return {
        provider: 'vb-cable',
        state: 'unsupported',
        message: 'Unsupported platform',
        correlationId: requestId
      }
    }

    const installerState = await syncVirtualAudioInstallerState()
    if (installerState.bundleReady === false) {
      return {
        provider,
        state: 'failed',
        message: installerState.bundleMessage || t('remoteMic.installBundleMissingReasonDefault'),
        correlationId: requestId
      }
    }

    setVirtualAudioInstallerState((prev) => ({
      ...prev,
      inProgress: true
    }))

    try {
      const result = await window.electronAPI?.installVirtualAudioDriver?.(provider, requestId)
      await syncVirtualAudioInstallerState()
      return result || null
    } catch (err: unknown) {
      await syncVirtualAudioInstallerState()
      return {
        provider,
        state: 'failed',
        message: err instanceof Error ? err.message : String(err),
        correlationId: requestId
      }
    }
  }, [localPlatform, syncVirtualAudioInstallerState, t])

  const finalizeRemoteMicSession = useCallback((reason?: string, notify: boolean = false) => {
    peerManager.setAudioRoutingMode('broadcast')
    resetRemoteMicSession({ state: 'idle' })
    if (notify && reason) {
      showToast(reason, 'info')
    }
  }, [peerManager, resetRemoteMicSession, showToast])

  const handlePeerDisconnected = useCallback((peerId: string) => {
    if (
      remoteMicSession.state !== 'idle' &&
      (remoteMicSession.sourcePeerId === peerId || remoteMicSession.targetPeerId === peerId)
    ) {
      peerManager.setAudioRoutingMode('broadcast')
      resetRemoteMicSession({ state: 'idle' })
      showToast(t('remoteMic.peerDisconnected'), 'info')
    }
  }, [peerManager, remoteMicSession, resetRemoteMicSession, showToast, t])

  const handleRequestRemoteMic = useCallback((targetPeerId: string) => {
    if (remoteMicSession.state === 'pendingOutgoing' || remoteMicSession.state === 'pendingIncoming' || remoteMicSession.state === 'active') {
      showToast(t('remoteMic.busy'), 'warning')
      return
    }

    const requestId = peerManager.sendRemoteMicRequest(targetPeerId)
    if (!requestId) {
      showToast(t('remoteMic.requestFailed'), 'error')
      return
    }

    const targetName = peers.get(targetPeerId)?.name || 'Unknown'
    const expiresAt = Date.now() + REMOTE_MIC_OUTGOING_TIMEOUT_MS
    setRemoteMicSession({
      state: 'pendingOutgoing',
      requestId,
      sourcePeerId: localPeerId,
      targetPeerId,
      targetName,
      role: 'source',
      expiresAt
    })

    if (remoteMicRequestTimerRef.current) {
      clearTimeout(remoteMicRequestTimerRef.current)
    }
    remoteMicRequestTimerRef.current = setTimeout(() => {
      peerManager.stopRemoteMicSession('request-timeout')
      setRemoteMicSession({
        state: 'expired',
        requestId,
        sourcePeerId: localPeerId,
        targetPeerId,
        targetName,
        role: 'source',
        reason: 'request-timeout'
      })
      showToast(t('remoteMic.requestTimeout'), 'warning')
    }, REMOTE_MIC_OUTGOING_TIMEOUT_MS)
  }, [localPeerId, peerManager, peers, remoteMicSession.state, showToast, t])

  const handleRespondRemoteMicRequest = useCallback(async (accept: boolean) => {
    if (remoteMicSession.state !== 'pendingIncoming' || !remoteMicSession.requestId) {
      return
    }
    const requestId = remoteMicSession.requestId

    if (!accept) {
      const ok = peerManager.respondRemoteMicRequest(requestId, false, 'rejected')
      if (!ok) {
        showToast(t('remoteMic.responseFailed'), 'error')
        finalizeRemoteMicSession()
        return
      }
      showToast(t('remoteMic.rejectedByTarget'), 'info')
      finalizeRemoteMicSession()
      return
    }

    if (virtualMicDeviceStatus.ready) {
      const ok = peerManager.respondRemoteMicRequest(requestId, true, 'accepted')
      if (!ok) {
        showToast(t('remoteMic.responseFailed'), 'error')
        finalizeRemoteMicSession()
      }
      return
    }

    const installProvider = getVirtualAudioProviderForPlatform(localPlatform)
    if (!installProvider) {
      peerManager.respondRemoteMicRequest(requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.installUnsupportedPlatform'), 'warning')
      finalizeRemoteMicSession()
      return
    }

    const installerState = await syncVirtualAudioInstallerState()
    if (installerState.bundleReady === false) {
      peerManager.respondRemoteMicRequest(requestId, false, 'virtual-device-install-failed')
      showToast(getInstallerPrecheckMessage(installerState.bundleMessage), 'warning')
      finalizeRemoteMicSession()
      return
    }

    let installTimedOut = false
    if (remoteMicRequestTimerRef.current) {
      clearTimeout(remoteMicRequestTimerRef.current)
    }

    const installExpiresAt = Date.now() + REMOTE_MIC_INSTALL_TIMEOUT_MS
    setRemoteMicSession((prev) => ({
      ...prev,
      isInstallingVirtualDevice: true,
      needsVirtualDeviceSetup: true,
      installError: undefined,
      expiresAt: installExpiresAt
    }))
    showToast(t('remoteMic.installStarting', {
      device: virtualMicDeviceStatus.expectedDeviceHint || getVirtualAudioDeviceName(localPlatform)
    }), 'info')

    remoteMicRequestTimerRef.current = setTimeout(() => {
      installTimedOut = true
      peerManager.respondRemoteMicRequest(requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.installTimeout'), 'warning')
      finalizeRemoteMicSession()
    }, REMOTE_MIC_INSTALL_TIMEOUT_MS)

    const installResult = await installVirtualAudioDriver(requestId)
    if (installTimedOut) {
      return
    }

    if (!installResult) {
      peerManager.respondRemoteMicRequest(requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.installFailed'), 'error')
      finalizeRemoteMicSession()
      return
    }

    if (installResult.state === 'reboot-required') {
      peerManager.respondRemoteMicRequest(requestId, false, 'virtual-device-restart-required')
      showToast(t('remoteMic.installNeedsRestart'), 'warning')
      finalizeRemoteMicSession()
      return
    }

    if (installResult.state === 'user-cancelled') {
      peerManager.respondRemoteMicRequest(requestId, false, 'user-cancelled')
      showToast(t('remoteMic.installCancelled'), 'warning')
      finalizeRemoteMicSession()
      return
    }

    if (installResult.state === 'failed' || installResult.state === 'unsupported') {
      peerManager.respondRemoteMicRequest(requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.installFailed'), 'error')
      finalizeRemoteMicSession()
      return
    }

    await refreshDevices()
    const devices = typeof navigator.mediaDevices?.enumerateDevices === 'function'
      ? await navigator.mediaDevices.enumerateDevices()
      : []
    const readyAfterInstall = devices.length > 0
      ? isVirtualMicOutputReady(localPlatform, devices)
      : virtualMicDeviceStatus.ready
    if (!readyAfterInstall) {
      peerManager.respondRemoteMicRequest(requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.virtualDeviceMissing'), 'warning')
      finalizeRemoteMicSession()
      return
    }

    setRemoteMicSession((prev) => ({
      ...prev,
      isInstallingVirtualDevice: false,
      needsVirtualDeviceSetup: false
    }))

    const ok = peerManager.respondRemoteMicRequest(requestId, true, 'accepted')
    if (!ok) {
      showToast(t('remoteMic.responseFailed'), 'error')
      finalizeRemoteMicSession()
      return
    }
    showToast(t('remoteMic.installCompleted', {
      device: virtualMicDeviceStatus.expectedDeviceHint || getVirtualAudioDeviceName(localPlatform)
    }), 'success')
  }, [
    finalizeRemoteMicSession,
    getInstallerPrecheckMessage,
    installVirtualAudioDriver,
    localPlatform,
    peerManager,
    refreshDevices,
    remoteMicSession,
    showToast,
    syncVirtualAudioInstallerState,
    t,
    virtualMicDeviceStatus.expectedDeviceHint,
    virtualMicDeviceStatus.ready
  ])

  const handleStopRemoteMic = useCallback((reason: RemoteMicStopReason = 'stopped-by-source') => {
    const normalizedReason = normalizeRemoteMicStopReason(reason)
    const session = remoteMicSession
    if (!session.requestId) {
      finalizeRemoteMicSession()
      return
    }

    if (session.role === 'source' && session.targetPeerId) {
      peerManager.sendRemoteMicStop(session.targetPeerId, session.requestId, normalizedReason)
    } else if (session.role === 'target' && session.sourcePeerId) {
      peerManager.sendRemoteMicStop(session.sourcePeerId, session.requestId, normalizedReason)
    }

    peerManager.stopRemoteMicSession(normalizedReason)
    finalizeRemoteMicSession()
  }, [finalizeRemoteMicSession, peerManager, remoteMicSession])

  const handleInstallRemoteMicDriver = useCallback(async () => {
    if (!getVirtualAudioProviderForPlatform(localPlatform)) {
      showToast(t('remoteMic.installUnsupportedPlatform'), 'warning')
      return
    }

    const installerState = await syncVirtualAudioInstallerState()
    if (installerState.bundleReady === false) {
      showToast(getInstallerPrecheckMessage(installerState.bundleMessage), 'warning')
      return
    }

    showToast(t('remoteMic.installStarting', {
      device: virtualMicDeviceStatus.expectedDeviceHint || getVirtualAudioDeviceName(localPlatform)
    }), 'info')
    const result = await installVirtualAudioDriver(`manual-${Date.now()}`)
    if (!result) {
      showToast(t('remoteMic.installFailed'), 'error')
      return
    }

    if (result.state === 'reboot-required') {
      showToast(t('remoteMic.installNeedsRestart'), 'warning')
      return
    }
    if (result.state === 'user-cancelled') {
      showToast(t('remoteMic.installCancelled'), 'warning')
      return
    }
    if (result.state === 'failed' || result.state === 'unsupported') {
      showToast(t('remoteMic.installFailed'), 'error')
      return
    }

    await refreshDevices()
    const devices = typeof navigator.mediaDevices?.enumerateDevices === 'function'
      ? await navigator.mediaDevices.enumerateDevices()
      : []
    const ready = devices.length > 0
      ? isVirtualMicOutputReady(localPlatform, devices)
      : virtualMicDeviceStatus.ready

    if (ready) {
      showToast(t('remoteMic.installCompleted', {
        device: virtualMicDeviceStatus.expectedDeviceHint || getVirtualAudioDeviceName(localPlatform)
      }), 'success')
    } else {
      showToast(t('remoteMic.virtualDeviceMissing'), 'warning')
    }
  }, [
    getInstallerPrecheckMessage,
    installVirtualAudioDriver,
    localPlatform,
    refreshDevices,
    showToast,
    syncVirtualAudioInstallerState,
    t,
    virtualMicDeviceStatus.expectedDeviceHint,
    virtualMicDeviceStatus.ready
  ])

  const handleRecheckVirtualMicDevice = useCallback(async () => {
    await refreshDevices()
    await syncVirtualAudioInstallerState()

    const devices = typeof navigator.mediaDevices?.enumerateDevices === 'function'
      ? await navigator.mediaDevices.enumerateDevices()
      : []
    const ready = devices.length > 0
      ? isVirtualMicOutputReady(localPlatform, devices)
      : virtualMicDeviceStatus.ready
    showToast(
      ready ? t('remoteMic.ready') : t('remoteMic.notReady'),
      ready ? 'success' : 'warning'
    )
  }, [localPlatform, refreshDevices, showToast, syncVirtualAudioInstallerState, t, virtualMicDeviceStatus.ready])

  useEffect(() => {
    syncVirtualAudioInstallerState()
  }, [syncVirtualAudioInstallerState])

  useEffect(() => {
    const handleRemoteMicControlMessage = (peerId: string, message: RemoteMicControlMessage) => {
      switch (message.type) {
        case 'rm_request': {
          if (remoteMicSession.state === 'active' || remoteMicSession.state === 'pendingIncoming' || remoteMicSession.state === 'pendingOutgoing') {
            peerManager.respondRemoteMicRequest(message.requestId, false, 'busy')
            return
          }

          const sourceName = message.sourceName || peers.get(peerId)?.name || 'Unknown'
          const expiresAt = Date.now() + REMOTE_MIC_REQUEST_TIMEOUT_MS
          setRemoteMicSession({
            state: 'pendingIncoming',
            requestId: message.requestId,
            sourcePeerId: peerId,
            sourceName,
            targetPeerId: localPeerId,
            role: 'target',
            expiresAt,
            needsVirtualDeviceSetup: !virtualMicDeviceStatus.ready,
            isInstallingVirtualDevice: false
          })

          if ((localPlatform === 'win' || localPlatform === 'mac') && !virtualMicDeviceStatus.ready) {
            syncVirtualAudioInstallerState()
          }

          if (remoteMicRequestTimerRef.current) {
            clearTimeout(remoteMicRequestTimerRef.current)
          }
          remoteMicRequestTimerRef.current = setTimeout(() => {
            peerManager.respondRemoteMicRequest(message.requestId, false, 'rejected')
            setRemoteMicSession({
              state: 'expired',
              requestId: message.requestId,
              sourcePeerId: peerId,
              sourceName,
              targetPeerId: localPeerId,
              role: 'target',
              reason: 'request-timeout'
            })
          }, REMOTE_MIC_REQUEST_TIMEOUT_MS)

          showToast(t('remoteMic.requestReceived', { name: sourceName }), 'info')
          break
        }

        case 'rm_response': {
          if (remoteMicSession.state !== 'pendingOutgoing' || remoteMicSession.requestId !== message.requestId) {
            return
          }

          if (remoteMicRequestTimerRef.current) {
            clearTimeout(remoteMicRequestTimerRef.current)
            remoteMicRequestTimerRef.current = null
          }

          if (message.accepted) {
            const targetPeerId = remoteMicSession.targetPeerId || peerId
            const routeSet = peerManager.setAudioRoutingMode('exclusive', targetPeerId)
            if (!routeSet) {
              showToast(t('remoteMic.routingFailed'), 'error')
              finalizeRemoteMicSession()
              return
            }

            peerManager.sendRemoteMicStart(targetPeerId, message.requestId)
            setRemoteMicSession({
              state: 'active',
              requestId: message.requestId,
              sourcePeerId: localPeerId,
              targetPeerId,
              targetName: remoteMicSession.targetName || peers.get(targetPeerId)?.name || 'Unknown',
              role: 'source',
              startedAt: Date.now()
            })

            if (remoteMicHeartbeatSendRef.current) {
              clearInterval(remoteMicHeartbeatSendRef.current)
            }
            remoteMicHeartbeatSendRef.current = setInterval(() => {
              peerManager.sendRemoteMicHeartbeat(targetPeerId, message.requestId)
            }, REMOTE_MIC_HEARTBEAT_INTERVAL_MS)

            showToast(t('remoteMic.requestAccepted'), 'success')
          } else {
            setRemoteMicSession({
              state: 'rejected',
              requestId: message.requestId,
              sourcePeerId: localPeerId,
              targetPeerId: remoteMicSession.targetPeerId,
              role: 'source',
              reason: message.reason || 'rejected'
            })
            showToast(getRemoteMicRejectMessage(message.reason), 'warning')
          }
          break
        }

        case 'rm_start': {
          if (remoteMicSession.state !== 'pendingIncoming' || remoteMicSession.requestId !== message.requestId) {
            return
          }

          if (remoteMicRequestTimerRef.current) {
            clearTimeout(remoteMicRequestTimerRef.current)
            remoteMicRequestTimerRef.current = null
          }

          remoteMicLastHeartbeatAtRef.current = Date.now()
          setRemoteMicSession((prev) => ({
            ...prev,
            state: 'active',
            startedAt: Date.now()
          }))

          if (remoteMicHeartbeatWatchRef.current) {
            clearInterval(remoteMicHeartbeatWatchRef.current)
          }

          remoteMicHeartbeatWatchRef.current = setInterval(() => {
            const elapsed = Date.now() - remoteMicLastHeartbeatAtRef.current
            if (elapsed > REMOTE_MIC_HEARTBEAT_TIMEOUT_MS) {
              peerManager.sendRemoteMicStop(peerId, message.requestId, 'heartbeat-timeout')
              finalizeRemoteMicSession(t('remoteMic.heartbeatTimeout'), true)
            }
          }, 1000)

          showToast(t('remoteMic.activeAsTarget'), 'success')
          break
        }

        case 'rm_heartbeat': {
          if (
            remoteMicSession.state === 'active' &&
            remoteMicSession.role === 'target' &&
            remoteMicSession.requestId === message.requestId &&
            remoteMicSession.sourcePeerId === peerId
          ) {
            remoteMicLastHeartbeatAtRef.current = Date.now()
          }
          break
        }

        case 'rm_stop': {
          if (remoteMicSession.requestId && remoteMicSession.requestId !== message.requestId) {
            return
          }
          finalizeRemoteMicSession(t('remoteMic.stopped'), true)
          break
        }
      }
    }

    peerManager.setOnRemoteMicControl(handleRemoteMicControlMessage)
    return () => {
      peerManager.setOnRemoteMicControl(null)
    }
  }, [
    finalizeRemoteMicSession,
    getRemoteMicRejectMessage,
    localPeerId,
    localPlatform,
    peerManager,
    peers,
    remoteMicSession,
    showToast,
    syncVirtualAudioInstallerState,
    t,
    virtualMicDeviceStatus.ready
  ])

  useEffect(() => {
    if (remoteMicSession.state !== 'rejected' && remoteMicSession.state !== 'expired') {
      return
    }

    const timer = setTimeout(() => {
      setRemoteMicSession({ state: 'idle' })
    }, 2500)

    return () => clearTimeout(timer)
  }, [remoteMicSession.state])

  return {
    remoteMicSession,
    virtualAudioInstallerState,
    clearRemoteMicTimers,
    resetRemoteMicSession,
    handlePeerDisconnected,
    handleRequestRemoteMic,
    handleRespondRemoteMicRequest,
    handleStopRemoteMic,
    handleInstallRemoteMicDriver,
    handleRecheckVirtualMicDevice
  }
}
