import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

test.describe('Chat E2E', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180000)

  let appA: ElectronApplication | null = null
  let appB: ElectronApplication | null = null
  let windowA: Page
  let windowB: Page
  let roomId = ''
  let userDataDirA = ''
  let userDataDirB = ''

  async function setEnglishAndOpenLobby(page: Page) {
    await page.evaluate(() => {
      localStorage.setItem('p2p-conf-language', 'en')
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('data-testid=lobby-title')).toBeVisible()
  }

  async function joinAsHost(page: Page, userName: string): Promise<string> {
    await page.locator('data-testid=lobby-name-input').fill(userName)
    await page.locator('data-testid=lobby-generate-btn').click()
    const generatedRoomId = await page.locator('data-testid=lobby-room-input').inputValue()
    await page.locator('data-testid=lobby-join-btn').click()
    await expect(page.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20000 })
    return generatedRoomId
  }

  async function joinAsPeer(page: Page, userName: string, joinRoomId: string) {
    await page.locator('data-testid=lobby-name-input').fill(userName)
    await page.locator('data-testid=lobby-room-input').fill(joinRoomId)
    await page.locator('data-testid=lobby-join-btn').click()
    await expect(page.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20000 })
  }

  async function waitForTwoPeerConnection(page: Page) {
    await expect(page.locator('text=1 participant(s) connected')).toBeVisible({ timeout: 30000 })
  }

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
    userDataDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-chat-a-'))
    userDataDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-chat-b-'))

    appA = await electron.launch({
      args: ['.', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--user-data-dir=${userDataDirA}`],
      locale: 'en-US',
      env: { ...process.env, NODE_ENV: 'test' }
    })
    appB = await electron.launch({
      args: ['.', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--user-data-dir=${userDataDirB}`],
      locale: 'en-US',
      env: { ...process.env, NODE_ENV: 'test' }
    })

    windowA = await appA.firstWindow()
    windowB = await appB.firstWindow()

    await setEnglishAndOpenLobby(windowA)
    await setEnglishAndOpenLobby(windowB)

    roomId = await joinAsHost(windowA, 'ChatHost')
    await joinAsPeer(windowB, 'ChatPeer', roomId)

    await waitForTwoPeerConnection(windowA)
    await waitForTwoPeerConnection(windowB)
  })

  test.afterAll(async () => {
    if (appA) await appA.close()
    if (appB) await appB.close()

    if (userDataDirA) fs.rmSync(userDataDirA, { recursive: true, force: true })
    if (userDataDirB) fs.rmSync(userDataDirB, { recursive: true, force: true })
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
