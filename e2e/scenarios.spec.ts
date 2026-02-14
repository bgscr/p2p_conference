import { test, expect, type Page } from '@playwright/test'
import {
  closeClient,
  joinAsHost,
  launchClient,
  setEnglishAndOpenLobby,
  type LaunchedClient
} from './helpers/multiPeerSession'

test.describe('E2E Scenarios', () => {
    test.describe.configure({ mode: 'serial' })

    let appClient: LaunchedClient | null = null
    let window: Page

    test.beforeAll(async () => {
      appClient = await launchClient('p2p-scenarios-')
      window = appClient.page
    })

    test.afterAll(async () => {
      await closeClient(appClient)
    })

    test('User can generate room ID and join a room', async () => {
      await setEnglishAndOpenLobby(window)
      const roomId = await joinAsHost(window, 'TestUser')
      expect(roomId.length).toBeGreaterThan(5)
    })

    test('User can toggle microphone', async () => {
      const muteBtn = window.locator('data-testid=room-mute-btn')
      await expect(muteBtn).toBeVisible()

      const initialTitle = await muteBtn.getAttribute('title')
      await window.keyboard.press('m')
      await expect.poll(async () => muteBtn.getAttribute('title')).not.toBe(initialTitle)

      await window.keyboard.press('m')
      await expect.poll(async () => muteBtn.getAttribute('title')).toBe(initialTitle)
    })

    test('User can toggle speaker', async () => {
      const speakerBtn = window.locator('data-testid=room-speaker-btn')
      await expect(speakerBtn).toBeVisible()

      const initialTitle = await speakerBtn.getAttribute('title')
      await window.keyboard.press('l')
      await expect.poll(async () => speakerBtn.getAttribute('title')).not.toBe(initialTitle)

      await window.keyboard.press('l')
      await expect.poll(async () => speakerBtn.getAttribute('title')).toBe(initialTitle)
    })
})
