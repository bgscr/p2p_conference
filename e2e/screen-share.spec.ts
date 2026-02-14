import { test, expect, type Page } from '@playwright/test'
import {
  closeClient,
  joinAsHost,
  joinAsPeer,
  launchClient,
  mockDisplayMedia,
  setEnglishAndOpenLobby,
  type LaunchedClient,
  waitForConnectedPeerCount
} from './helpers/multiPeerSession'

test.describe('Screen Share E2E', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180000)

  let appA: LaunchedClient | null = null
  let appB: LaunchedClient | null = null
  let windowA: Page
  let windowB: Page
  let roomId = ''

  async function ensurePeerBJoined() {
    if (appB) {
      return
    }

    appB = await launchClient('p2p-screen-b-')
    windowB = appB.page

    await setEnglishAndOpenLobby(windowB)
    await joinAsPeer(windowB, 'ScreenPeer', roomId)
    await waitForConnectedPeerCount(windowA, 1)
    await waitForConnectedPeerCount(windowB, 1)
    await mockDisplayMedia(windowA)
  }

  async function ensureScreenShareStopped() {
    const screenShareButton = windowA.locator('data-testid=room-screenshare-btn')
    const title = await screenShareButton.getAttribute('title')
    if (title?.includes('Stop')) {
      await windowA.keyboard.press('s')
    }
    await expect(screenShareButton).toHaveAttribute('title', /Share Screen/)
    if (appB) {
      await expect(windowB.locator('data-testid=screen-sharing-badge')).toHaveCount(0)
    }
  }

  test.beforeAll(async () => {
    appA = await launchClient('p2p-screen-a-')
    windowA = appA.page

    await setEnglishAndOpenLobby(windowA)
    roomId = await joinAsHost(windowA, 'ScreenHost')
  })

  test.afterAll(async () => {
    await closeClient(appA)
    await closeClient(appB)
  })

  test('screen share button is visible and disabled when no peers are connected', async () => {
    const button = windowA.locator('data-testid=room-screenshare-btn')
    await expect(button).toBeVisible()
    await expect(button).toBeDisabled()
  })

  test('screen share button becomes enabled when a peer joins the room', async () => {
    await ensurePeerBJoined()

    const buttonA = windowA.locator('data-testid=room-screenshare-btn')
    const buttonB = windowB.locator('data-testid=room-screenshare-btn')
    await expect(buttonA).toBeEnabled()
    await expect(buttonB).toBeEnabled()
  })

  test('keyboard shortcut S toggles screen share and updates remote indicator', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStopped()

    await windowA.keyboard.press('s')
    await expect(windowA.locator('data-testid=room-screenshare-btn')).toHaveAttribute('title', /Stop Sharing/)
    await expect(windowB.locator('data-testid=screen-sharing-badge').first()).toBeVisible({ timeout: 15000 })

    await windowA.keyboard.press('s')
    await expect(windowA.locator('data-testid=room-screenshare-btn')).toHaveAttribute('title', /Share Screen/)
    await expect(windowB.locator('data-testid=screen-sharing-badge')).toHaveCount(0)
  })

  test('clicking screen share button toggles sharing state', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStopped()

    const button = windowA.locator('data-testid=room-screenshare-btn')
    await button.click()
    await expect(button).toHaveAttribute('title', /Stop Sharing/)
    await expect(windowB.locator('data-testid=screen-sharing-badge').first()).toBeVisible({ timeout: 15000 })

    await button.click()
    await expect(button).toHaveAttribute('title', /Share Screen/)
    await expect(windowB.locator('data-testid=screen-sharing-badge')).toHaveCount(0)
  })

  test('screen share remains active when toggling mute, speaker, and video', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStopped()

    const button = windowA.locator('data-testid=room-screenshare-btn')
    await button.click()
    await expect(button).toHaveAttribute('title', /Stop Sharing/)
    await expect(windowB.locator('data-testid=screen-sharing-badge').first()).toBeVisible({ timeout: 15000 })
    await expect(windowB.locator('video.opacity-100').first()).toBeVisible({ timeout: 15000 })

    await windowA.keyboard.press('m')
    await windowA.keyboard.press('l')
    await windowA.keyboard.press('v')

    await expect(button).toHaveAttribute('title', /Stop Sharing/)
    await expect(windowB.locator('data-testid=screen-sharing-badge').first()).toBeVisible({ timeout: 15000 })
    await expect(windowB.locator('video.opacity-100').first()).toBeVisible({ timeout: 15000 })

    await button.click()
    await expect(button).toHaveAttribute('title', /Share Screen/)
    await expect(windowB.locator('data-testid=screen-sharing-badge')).toHaveCount(0)
  })
})
