import { test, expect, type Page } from '@playwright/test'
import {
  closeClient,
  launchClient,
  setEnglishAndOpenLobby,
  type LaunchedClient
} from './helpers/multiPeerSession'

test.describe('Settings and Navigation E2E', () => {
  test.describe.configure({ mode: 'serial' })

  let appClient: LaunchedClient | null = null
  let window: Page

  async function joinRoom(userName: string): Promise<string> {
    await window.locator('data-testid=lobby-name-input').fill(userName)
    await window.locator('data-testid=lobby-generate-btn').click()
    const roomId = await window.locator('data-testid=lobby-room-input').inputValue()
    await window.locator('data-testid=lobby-join-btn').click()
    await expect(window.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20_000 })
    return roomId
  }

  async function openLobbySettings(): Promise<void> {
    await window.getByRole('button', { name: /Settings/i }).first().evaluate((element: HTMLButtonElement) => {
      element.click()
    })
    await expect(window.getByRole('heading', { name: /Settings/i })).toBeVisible({ timeout: 10_000 })
  }

  async function leaveRoomIfNeeded(): Promise<void> {
    const leaveButton = window.locator('data-testid=room-leave-btn')
    if ((await leaveButton.count()) === 0) return

    await leaveButton.first().evaluate((element: HTMLButtonElement) => {
      element.click()
    })
    const confirmLeaveButton = window.locator('button.btn.bg-red-600')
    if ((await confirmLeaveButton.count()) > 0) {
      await confirmLeaveButton.first().evaluate((element: HTMLButtonElement) => {
        element.click()
      })
    }

    await expect(window.locator('data-testid=lobby-title')).toBeVisible({ timeout: 10_000 })
  }

  test.beforeAll(async () => {
    appClient = await launchClient('p2p-settings-')
    window = appClient.page
  })

  test.afterAll(async () => {
    await closeClient(appClient)
  })

  test.beforeEach(async () => {
    await setEnglishAndOpenLobby(window)
  })

  test.afterEach(async () => {
    await leaveRoomIfNeeded()
  })

  test('Settings panel opens and closes correctly', async () => {
    await openLobbySettings()

    await window.locator('header button[title]').first().click()
    await expect(window.locator('data-testid=lobby-title')).toBeVisible()
  })

  test('Language can be changed in settings', async () => {
    await openLobbySettings()

    const languageButtons = window.locator('section.card').first().locator('button')
    expect(await languageButtons.count()).toBeGreaterThan(1)

    await languageButtons.nth(1).click()
    await expect.poll(async () => {
      return await window.evaluate(() => localStorage.getItem('p2p-conf-language'))
    }).not.toBe('en')

    await window.getByRole('button', { name: 'English' }).click()
    await expect.poll(async () => {
      return await window.evaluate(() => localStorage.getItem('p2p-conf-language'))
    }).toBe('en')
  })

  test('Complete user flow: Join room, toggle controls, leave room', async () => {
    const roomId = await joinRoom('E2ETestUser')
    expect(roomId.length).toBeGreaterThan(5)

    const muteBtn = window.locator('data-testid=room-mute-btn')
    await expect(muteBtn).toBeVisible()
    await window.keyboard.press('m')
    await window.keyboard.press('m')
    await expect(window.locator('data-testid=room-leave-btn')).toBeVisible()

    await leaveRoomIfNeeded()
  })

  test('Room ID validation shows error for empty room', async () => {
    await window.locator('data-testid=lobby-name-input').fill('TestUser')
    await window.locator('data-testid=lobby-room-input').fill('')

    const joinBtn = window.locator('data-testid=lobby-join-btn')
    await expect(joinBtn).toBeDisabled()
  })

  test('Copy room link functionality works', async () => {
    await joinRoom('CopyUser')

    const copyBtn = window.locator('data-testid=room-copy-btn')
    await expect(copyBtn).toBeVisible()
    await copyBtn.evaluate((element: HTMLButtonElement) => {
      element.click()
    })
    await expect(window.locator('data-testid=room-leave-btn')).toBeVisible()
  })
})
