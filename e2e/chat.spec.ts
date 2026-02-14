import { test, expect, type Page } from '@playwright/test'
import {
  closeClient,
  joinAsHost,
  joinAsPeer,
  launchClient,
  setEnglishAndOpenLobby,
  type LaunchedClient,
  waitForConnectedPeerCount
} from './helpers/multiPeerSession'

test.describe('Chat E2E', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180000)

  let appA: LaunchedClient | null = null
  let appB: LaunchedClient | null = null
  let windowA: Page
  let windowB: Page
  let roomId = ''

  async function ensureChatClosed(page: Page) {
    const panel = page.locator('data-testid=chat-panel')
    if ((await panel.count()) > 0) {
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        active?.blur?.()
      })
      await page.keyboard.press('t')
      await expect(panel).toHaveCount(0)
    }
  }

  async function clearUnreadBadge(page: Page) {
    const unreadBadge = page.locator('data-testid=chat-unread-badge')
    if ((await unreadBadge.count()) > 0) {
      await page.keyboard.press('t')
      await expect(page.locator('data-testid=chat-panel')).toBeVisible()
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        active?.blur?.()
      })
      await page.keyboard.press('t')
      await expect(unreadBadge).toHaveCount(0)
    }
  }

  async function openChatByButton(page: Page) {
    await page.locator('data-testid=room-chat-btn').evaluate((el: HTMLButtonElement) => el.click())
    await expect(page.locator('data-testid=chat-panel')).toBeVisible()
  }

  async function closeChatByButton(page: Page) {
    if ((await page.locator('data-testid=chat-panel').count()) > 0) {
      await page.locator('data-testid=chat-close-btn').evaluate((el: HTMLButtonElement) => el.click())
      await expect(page.locator('data-testid=chat-panel')).toHaveCount(0)
    }
  }

  test.beforeAll(async () => {
    appA = await launchClient('p2p-chat-a-')
    appB = await launchClient('p2p-chat-b-')
    windowA = appA.page
    windowB = appB.page

    await setEnglishAndOpenLobby(windowA)
    await setEnglishAndOpenLobby(windowB)

    roomId = await joinAsHost(windowA, 'ChatHost')
    await joinAsPeer(windowB, 'ChatPeer', roomId)
    await waitForConnectedPeerCount(windowA, 1)
    await waitForConnectedPeerCount(windowB, 1)
  })

  test.afterAll(async () => {
    await closeClient(appA)
    await closeClient(appB)
  })

  test.beforeEach(async () => {
    await ensureChatClosed(windowA)
    await ensureChatClosed(windowB)
    await clearUnreadBadge(windowA)
    await clearUnreadBadge(windowB)
  })

  test('chat button is visible for both peers in room controls', async () => {
    await expect(windowA.locator('data-testid=room-chat-btn')).toBeVisible()
    await expect(windowB.locator('data-testid=room-chat-btn')).toBeVisible()
  })

  test('clicking chat button opens and closes panel', async () => {
    await openChatByButton(windowA)
    await closeChatByButton(windowA)
  })

  test('keyboard shortcut T toggles chat panel', async () => {
    await windowB.keyboard.press('t')
    await expect(windowB.locator('data-testid=chat-panel')).toBeVisible()

    await windowB.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      active?.blur?.()
    })
    await windowB.keyboard.press('t')
    await expect(windowB.locator('data-testid=chat-panel')).toHaveCount(0)
  })

  test('messages are delivered from one peer to another', async () => {
    await openChatByButton(windowA)
    await openChatByButton(windowB)

    const content = `E2E message ${Date.now()}`
    await windowA.locator('data-testid=chat-input').fill(content)
    await windowA.locator('data-testid=chat-send-btn').evaluate((el: HTMLButtonElement) => el.click())

    await expect(windowA.locator(`text=${content}`)).toBeVisible()
    await expect(windowB.locator(`text=${content}`)).toBeVisible({ timeout: 15000 })
  })

  test('unread badge appears when chat is closed and message is received', async () => {
    await ensureChatClosed(windowB)
    await expect(windowB.locator('data-testid=chat-unread-badge')).toHaveCount(0)

    await openChatByButton(windowA)
    const content = `Unread test ${Date.now()}`
    await windowA.locator('data-testid=chat-input').fill(content)
    await windowA.locator('data-testid=chat-send-btn').evaluate((el: HTMLButtonElement) => el.click())

    await expect(windowB.locator('data-testid=chat-unread-badge')).toBeVisible({ timeout: 15000 })

    await openChatByButton(windowB)
    await expect(windowB.locator(`text=${content}`)).toBeVisible()
    await expect(windowB.locator('data-testid=chat-unread-badge')).toHaveCount(0)
  })
})
