import { describe, it, expect } from 'vitest'

import * as components from '../renderer/components'
import * as hooks from '../renderer/hooks'
import * as signaling from '../renderer/signaling'
import * as utils from '../renderer/utils'

describe('barrel exports', () => {
  it('exports components', () => {
    expect(components.LobbyView).toBeDefined()
    expect(components.RoomView).toBeDefined()
    expect(components.ParticipantCard).toBeDefined()
    expect(components.SettingsPanel).toBeDefined()
  })

  it('exports hooks', () => {
    expect(hooks.useRoom).toBeDefined()
    expect(hooks.useMediaStream).toBeDefined()
    expect(hooks.usePeerConnections).toBeDefined()
    expect(hooks.useI18n).toBeDefined()
  })

  it('exports signaling utilities', () => {
    expect(signaling.SimplePeerManager).toBeDefined()
    expect(signaling.peerManager).toBeDefined()
    expect(signaling.generatePeerId).toBeDefined()
  })

  it('exports utils', () => {
    expect(utils.logger).toBeDefined()
    expect(utils.t).toBeDefined()
    expect(utils.i18n).toBeDefined()
  })
})
