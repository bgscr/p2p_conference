import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

test.describe('Screen Share E2E', () => {
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

  async function mockDisplayMedia(page: Page) {
    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const ctx = canvas.getContext('2d')
      ctx?.fillRect(0, 0, canvas.width, canvas.height)

      const createStream = () => {
        const track = canvas.captureStream(5).getVideoTracks()[0]
        return new MediaStream([track])
      }

      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          ...(navigator.mediaDevices || {}),
          getDisplayMedia: async () => createStream()
        },
        configurable: true
      })
    })
  }

  async function ensurePeerBJoined() {
    if (appB) return

    userDataDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-screen-b-'))
    appB = await electron.launch({
      args: ['.', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--user-data-dir=${userDataDirB}`],
      locale: 'en-US',
      env: { ...process.env, NODE_ENV: 'test' }
    })
    windowB = await appB.firstWindow()

    await setEnglishAndOpenLobby(windowB)
    await joinAsPeer(windowB, 'ScreenPeer', roomId)

    await waitForTwoPeerConnection(windowA)
    await waitForTwoPeerConnection(windowB)
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
    userDataDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-screen-a-'))
    appA = await electron.launch({
      args: ['.', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--user-data-dir=${userDataDirA}`],
      locale: 'en-US',
      env: { ...process.env, NODE_ENV: 'test' }
    })
    windowA = await appA.firstWindow()

    await setEnglishAndOpenLobby(windowA)
    roomId = await joinAsHost(windowA, 'ScreenHost')
  })

  test.afterAll(async () => {
    if (appA) await appA.close()
    if (appB) await appB.close()

    if (userDataDirA) fs.rmSync(userDataDirA, { recursive: true, force: true })
    if (userDataDirB) fs.rmSync(userDataDirB, { recursive: true, force: true })
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
