import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

export interface LaunchedClient {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

interface LaunchClientOptions {
  fakeMedia?: boolean
}

interface WaitForConnectedPeerCountOptions {
  timeoutMs?: number
  require?: boolean
}

const BASE_ELECTRON_ARGS = ['.']
const FAKE_MEDIA_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']

export async function launchClient(userDataPrefix: string, options: LaunchClientOptions = {}): Promise<LaunchedClient> {
  const { fakeMedia = true } = options
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), userDataPrefix))
  const args = fakeMedia
    ? [...BASE_ELECTRON_ARGS, ...FAKE_MEDIA_ARGS, `--user-data-dir=${userDataDir}`]
    : [...BASE_ELECTRON_ARGS, `--user-data-dir=${userDataDir}`]

  const app = await electron.launch({
    args,
    locale: 'en-US',
    env: { ...process.env, NODE_ENV: 'test' }
  })
  const page = await app.firstWindow()
  return { app, page, userDataDir }
}

export async function closeClient(client: LaunchedClient | null): Promise<void> {
  if (!client) return

  await client.app.close()
  fs.rmSync(client.userDataDir, { recursive: true, force: true })
}

export async function setEnglishAndOpenLobby(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('p2p-conf-language', 'en')
  })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('data-testid=lobby-title')).toBeVisible()
}

export async function joinAsHost(page: Page, userName: string): Promise<string> {
  await page.locator('data-testid=lobby-name-input').fill(userName)
  await page.locator('data-testid=lobby-generate-btn').click()
  const roomId = await page.locator('data-testid=lobby-room-input').inputValue()
  await page.locator('data-testid=lobby-join-btn').click()
  await expect(page.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20_000 })
  return roomId
}

export async function joinAsPeer(page: Page, userName: string, roomId: string): Promise<void> {
  await page.locator('data-testid=lobby-name-input').fill(userName)
  await page.locator('data-testid=lobby-room-input').fill(roomId)
  await page.locator('data-testid=lobby-join-btn').click()
  await expect(page.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20_000 })
}

export async function waitForConnectedPeerCount(
  page: Page,
  peerCount: number,
  options: WaitForConnectedPeerCountOptions = {}
): Promise<boolean> {
  const {
    timeoutMs = 30_000,
    require = true
  } = options
  const connectedText = `${peerCount} participant(s) connected`
  const inCallText = `${peerCount + 1} in call`

  try {
    await expect
      .poll(async () => {
        const legacyVisible = await page
          .locator(`text=${connectedText}`)
          .first()
          .isVisible()
          .catch(() => false)
        if (legacyVisible) {
          return true
        }

        return page
          .locator(`text=${inCallText}`)
          .first()
          .isVisible()
          .catch(() => false)
      }, { timeout: timeoutMs })
      .toBe(true)
    return true
  } catch (error) {
    if (!require) {
      return false
    }
    throw error
  }
}

export async function mockDisplayMedia(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const context = canvas.getContext('2d')
    context?.fillRect(0, 0, canvas.width, canvas.height)

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
