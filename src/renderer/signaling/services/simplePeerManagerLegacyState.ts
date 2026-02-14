import type { ControlState } from './controlState'
import type { NetworkReconnectState } from './networkReconnect'

interface InstallLegacyStateAccessorsOptions {
  target: object
  getControlState: () => ControlState
  getNetworkState: () => NetworkReconnectState
}

type AccessorDescriptor = Pick<PropertyDescriptor, 'get' | 'set' | 'enumerable' | 'configurable'>

function defineAccessor(target: object, property: string, descriptor: AccessorDescriptor) {
  Object.defineProperty(target, property, descriptor)
}

export function installLegacyStateAccessors(options: InstallLegacyStateAccessorsOptions): void {
  const { target, getControlState, getNetworkState } = options

  defineAccessor(target, 'pendingRemoteMicRequests', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().pendingRemoteMicRequests,
    set: (value) => {
      getControlState().pendingRemoteMicRequests = value as Map<string, string>
    }
  })
  defineAccessor(target, 'pendingOutgoingRemoteMicRequestId', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().pendingOutgoingRemoteMicRequestId,
    set: (value) => {
      getControlState().pendingOutgoingRemoteMicRequestId = value as string | null
    }
  })
  defineAccessor(target, 'activeRemoteMicTargetPeerId', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().activeRemoteMicTargetPeerId,
    set: (value) => {
      getControlState().activeRemoteMicTargetPeerId = value as string | null
    }
  })
  defineAccessor(target, 'activeRemoteMicSourcePeerId', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().activeRemoteMicSourcePeerId,
    set: (value) => {
      getControlState().activeRemoteMicSourcePeerId = value as string | null
    }
  })
  defineAccessor(target, 'activeRemoteMicRequestId', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().activeRemoteMicRequestId,
    set: (value) => {
      getControlState().activeRemoteMicRequestId = value as string | null
    }
  })
  defineAccessor(target, 'roomLocked', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().roomLocked,
    set: (value) => {
      getControlState().roomLocked = value as boolean
    }
  })
  defineAccessor(target, 'roomLockOwnerPeerId', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().roomLockOwnerPeerId,
    set: (value) => {
      getControlState().roomLockOwnerPeerId = value as string | null
    }
  })
  defineAccessor(target, 'raisedHands', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().raisedHands,
    set: (value) => {
      getControlState().raisedHands = value as Map<string, number>
    }
  })
  defineAccessor(target, 'localHandRaised', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().localHandRaised,
    set: (value) => {
      getControlState().localHandRaised = value as boolean
    }
  })
  defineAccessor(target, 'pendingMuteAllRequests', {
    enumerable: false,
    configurable: true,
    get: () => getControlState().pendingMuteAllRequests,
    set: (value) => {
      getControlState().pendingMuteAllRequests = value as Map<string, string>
    }
  })

  defineAccessor(target, 'isOnline', {
    enumerable: false,
    configurable: true,
    get: () => getNetworkState().isOnline,
    set: (value) => {
      getNetworkState().isOnline = value as boolean
    }
  })
  defineAccessor(target, 'wasInRoomWhenOffline', {
    enumerable: false,
    configurable: true,
    get: () => getNetworkState().wasInRoomWhenOffline,
    set: (value) => {
      getNetworkState().wasInRoomWhenOffline = value as boolean
    }
  })
  defineAccessor(target, 'networkReconnectAttempts', {
    enumerable: false,
    configurable: true,
    get: () => getNetworkState().networkReconnectAttempts,
    set: (value) => {
      getNetworkState().networkReconnectAttempts = value as number
    }
  })
}
