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

test.describe('Expand View E2E', () => {
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

    appB = await launchClient('p2p-expand-b-')
    windowB = appB.page

    await setEnglishAndOpenLobby(windowB)
    await joinAsPeer(windowB, 'ExpandPeer', roomId)

    await waitForConnectedPeerCount(windowA, 1)
    await waitForConnectedPeerCount(windowB, 1)
    await mockDisplayMedia(windowA)
  }

  async function ensureScreenShareStarted() {
    const screenShareButton = windowA.locator('data-testid=room-screenshare-btn')
    const title = await screenShareButton.getAttribute('title')
    if (!title?.includes('Stop')) {
      await windowA.keyboard.press('s')
      await expect(screenShareButton).toHaveAttribute('title', /Stop Sharing/)
      await expect(windowB.locator('data-testid=screen-sharing-badge').first()).toBeVisible({ timeout: 15000 })
    }
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

  async function ensureExpandedViewClosed() {
    const expandedView = windowB.locator('data-testid=expanded-view')
    if (await expandedView.isVisible().catch(() => false)) {
      const collapseBtn = windowB.locator('data-testid=collapse-btn')
      if (await collapseBtn.isVisible().catch(() => false)) {
        await collapseBtn.click()
      }
    }
    await expect(expandedView).toHaveCount(0, { timeout: 5000 })
  }

  test.beforeAll(async () => {
    appA = await launchClient('p2p-expand-a-')
    windowA = appA.page

    await setEnglishAndOpenLobby(windowA)
    roomId = await joinAsHost(windowA, 'ExpandHost')
  })

  test.afterAll(async () => {
    await closeClient(appA)
    await closeClient(appB)
  })

  test('expand button is visible on remote card when peer shares screen', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStarted()

    // On window B (recipient), the expand button should appear on A's card
    const expandBtn = windowB.locator('data-testid=expand-view-btn').first()
    // The button is visible on hover; move mouse over the card to trigger it
    const participantCard = windowB.locator('data-testid=screen-sharing-badge').first().locator('..')
    await participantCard.hover()
    await expect(expandBtn).toBeVisible({ timeout: 10000 })
  })

  test('expand button NOT visible on local card', async () => {
    await ensurePeerBJoined()

    // Window B's own local card should not have an expand button
    // Local card doesn't get onExpand, so no expand-view-btn on local card
    // Count expand buttons: should be at most 1 (for remote peer)
    const expandBtns = windowB.locator('data-testid=expand-view-btn')
    const count = await expandBtns.count()
    // At most 1 expand button (from the remote peer card)
    expect(count).toBeLessThanOrEqual(1)
  })

  test('clicking expand fills main area with expanded view', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStarted()
    await ensureExpandedViewClosed()

    // Hover and click expand
    const card = windowB.locator('data-testid=screen-sharing-badge').first().locator('..')
    await card.hover()
    const expandBtn = windowB.locator('data-testid=expand-view-btn').first()
    await expandBtn.click()

    // Expanded view should be visible
    await expect(windowB.locator('data-testid=expanded-view')).toBeVisible({ timeout: 5000 })
    await expect(windowB.locator('data-testid=expanded-video')).toBeVisible()
    await expect(windowB.locator('data-testid=collapse-btn')).toBeVisible()
    await expect(windowB.locator('data-testid=fullscreen-btn')).toBeVisible()
  })

  test('minimize button exits expanded view and returns to grid', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStarted()

    // Ensure we are in expanded view
    const expandedView = windowB.locator('data-testid=expanded-view')
    if (!await expandedView.isVisible().catch(() => false)) {
      const card = windowB.locator('data-testid=screen-sharing-badge').first().locator('..')
      await card.hover()
      await windowB.locator('data-testid=expand-view-btn').first().click()
      await expect(expandedView).toBeVisible({ timeout: 5000 })
    }

    // Click minimize
    // Move mouse to make toolbar visible
    await expandedView.hover()
    await windowB.locator('data-testid=collapse-btn').click()

    // Expanded view should be gone
    await expect(expandedView).toHaveCount(0, { timeout: 5000 })
  })

  test('ESC key exits expanded view', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStarted()
    await ensureExpandedViewClosed()

    // Expand
    const card = windowB.locator('data-testid=screen-sharing-badge').first().locator('..')
    await card.hover()
    await windowB.locator('data-testid=expand-view-btn').first().click()
    await expect(windowB.locator('data-testid=expanded-view')).toBeVisible({ timeout: 5000 })

    // Press ESC
    await windowB.keyboard.press('Escape')

    // Expanded view should be gone
    await expect(windowB.locator('data-testid=expanded-view')).toHaveCount(0, { timeout: 5000 })
  })

  test('fullscreen button enters fullscreen mode', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStarted()
    await ensureExpandedViewClosed()

    // Expand
    const card = windowB.locator('data-testid=screen-sharing-badge').first().locator('..')
    await card.hover()
    await windowB.locator('data-testid=expand-view-btn').first().click()
    await expect(windowB.locator('data-testid=expanded-view')).toBeVisible({ timeout: 5000 })

    // Move mouse to show toolbar
    await windowB.locator('data-testid=expanded-view').hover()

    // Click fullscreen
    await windowB.locator('data-testid=fullscreen-btn').click()

    // Check fullscreenElement is set (Electron supports Fullscreen API)
    const isFullscreen = await windowB.evaluate(() => !!document.fullscreenElement)
    expect(isFullscreen).toBe(true)

    // Exit fullscreen via ESC
    await windowB.keyboard.press('Escape')
    // Wait for fullscreen to exit
    await windowB.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 })
  })

  test('auto-exits expanded view when screen share stops', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStarted()
    await ensureExpandedViewClosed()

    // Expand on B
    const card = windowB.locator('data-testid=screen-sharing-badge').first().locator('..')
    await card.hover()
    await windowB.locator('data-testid=expand-view-btn').first().click()
    await expect(windowB.locator('data-testid=expanded-view')).toBeVisible({ timeout: 5000 })

    // Stop screen share on A
    await windowA.keyboard.press('s')
    await expect(windowA.locator('data-testid=room-screenshare-btn')).toHaveAttribute('title', /Share Screen/)

    // Expanded view on B should auto-close (auto-exit when peer stops sharing and has no video)
    await expect(windowB.locator('data-testid=expanded-view')).toHaveCount(0, { timeout: 15000 })
  })

  test('expand button hidden when no video or screen share active', async () => {
    await ensurePeerBJoined()
    await ensureScreenShareStopped()

    // Without screen sharing or video from A, the expand button should not be visible
    const expandBtns = windowB.locator('data-testid=expand-view-btn')
    await expect(expandBtns).toHaveCount(0)
  })
})
