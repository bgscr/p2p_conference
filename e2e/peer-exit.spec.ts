import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

test.describe('Peer Exit Detection', () => {
  test.describe.configure({ mode: 'serial' })

  test.setTimeout(120000)

  test('removes peer when app exits', async () => {
    const userDataDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-conf-a-'))
    const userDataDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-conf-b-'))

    let appA: ElectronApplication | null = null
    let appB: ElectronApplication | null = null
    let windowA: Page
    let windowB: Page

    try {
      appA = await electron.launch({
        args: [
          '.',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          `--user-data-dir=${userDataDirA}`
        ],
        locale: 'en-US',
        env: { ...process.env, NODE_ENV: 'test' }
      })

      appB = await electron.launch({
        args: [
          '.',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          `--user-data-dir=${userDataDirB}`
        ],
        locale: 'en-US',
        env: { ...process.env, NODE_ENV: 'test' }
      })

      windowA = await appA.firstWindow()
      windowB = await appB.firstWindow()

      await windowA.evaluate(() => {
        localStorage.setItem('p2p-conf-language', 'en')
      })
      await windowB.evaluate(() => {
        localStorage.setItem('p2p-conf-language', 'en')
      })

      await windowA.reload()
      await windowB.reload()

      await windowA.waitForLoadState('domcontentloaded')
      await windowB.waitForLoadState('domcontentloaded')

      await expect(windowA.locator('data-testid=lobby-title')).toBeVisible()
      await expect(windowB.locator('data-testid=lobby-title')).toBeVisible()

      const nameInputA = windowA.locator('data-testid=lobby-name-input')
      await nameInputA.fill('UserA')

      const generateBtn = windowA.locator('data-testid=lobby-generate-btn')
      await generateBtn.click()

      const roomInputA = windowA.locator('data-testid=lobby-room-input')
      const roomId = await roomInputA.inputValue()

      const joinBtnA = windowA.locator('data-testid=lobby-join-btn')
      await joinBtnA.click()

      await expect(windowA.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20000 })

      const nameInputB = windowB.locator('data-testid=lobby-name-input')
      await nameInputB.fill('UserB')

      const roomInputB = windowB.locator('data-testid=lobby-room-input')
      await roomInputB.fill(roomId)

      const joinBtnB = windowB.locator('data-testid=lobby-join-btn')
      await joinBtnB.click()

      await expect(windowB.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20000 })
      await expect(windowB.locator('text=1 participant(s) connected')).toBeVisible({ timeout: 20000 })

      await appA.close()
      appA = null

      await expect(windowB.locator('text=Waiting for others to join')).toBeVisible({ timeout: 20000 })
    } finally {
      if (appA) await appA.close()
      if (appB) await appB.close()
    }
  })
})
