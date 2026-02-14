import { test, expect } from '@playwright/test'
import {
  closeClient,
  joinAsHost,
  joinAsPeer,
  launchClient,
  setEnglishAndOpenLobby,
  type LaunchedClient,
  waitForConnectedPeerCount
} from './helpers/multiPeerSession'

test.describe('Peer Exit Detection', () => {
  test.describe.configure({ mode: 'serial' })

  test.setTimeout(120000)

  test('removes peer when app exits', async () => {
    let appA: LaunchedClient | null = null
    let appB: LaunchedClient | null = null

    try {
      appA = await launchClient('p2p-conf-a-')
      appB = await launchClient('p2p-conf-b-')
      const windowA = appA.page
      const windowB = appB.page

      await setEnglishAndOpenLobby(windowA)
      await setEnglishAndOpenLobby(windowB)

      const roomId = await joinAsHost(windowA, 'UserA')
      await joinAsPeer(windowB, 'UserB', roomId)
      await waitForConnectedPeerCount(windowB, 1)

      await closeClient(appA)
      appA = null

      await expect(windowB.locator('text=Waiting for others to join')).toBeVisible({ timeout: 20000 })
    } finally {
      await closeClient(appA)
      await closeClient(appB)
    }
  })
})
