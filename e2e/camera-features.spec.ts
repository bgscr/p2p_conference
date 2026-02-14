import { test, expect, type Page } from '@playwright/test'
import {
  closeClient,
  launchClient,
  setEnglishAndOpenLobby,
  type LaunchedClient
} from './helpers/multiPeerSession'

test.describe('Camera Features E2E', () => {
    test.describe.configure({ mode: 'serial' })

    let appClient: LaunchedClient | null = null
    let window: Page

    test.beforeAll(async () => {
      appClient = await launchClient('p2p-camera-')
      window = appClient.page
    })

    test.afterAll(async () => {
      await closeClient(appClient)
    })

    test('Lobby Camera Toggle & Join with Video Off', async () => {
      await setEnglishAndOpenLobby(window)

      const cameraToggle = window.locator('data-testid=camera-toggle')
      await expect(cameraToggle).toBeVisible()

      await expect(cameraToggle).toHaveClass(/bg-gray-300/)

      await cameraToggle.click()
      await expect(cameraToggle).toHaveClass(/bg-blue-600/)

      await cameraToggle.click()
      await expect(cameraToggle).toHaveClass(/bg-gray-300/)

      await window.locator('data-testid=lobby-name-input').fill('TestUser')
      await window.locator('data-testid=lobby-generate-btn').click()
      await window.locator('data-testid=lobby-join-btn').click()

      await expect(window.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20_000 })

      const roomVideoBtn = window.locator('data-testid=room-video-btn')
      await expect(roomVideoBtn).toBeVisible()
      await expect(roomVideoBtn).toHaveAttribute('title', 'Start Video')
    })
})
