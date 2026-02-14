import { test, expect } from '@playwright/test'
import { closeClient, launchClient, type LaunchedClient } from './helpers/multiPeerSession'

test.describe('Application Launch', () => {
    let appClient: LaunchedClient | null = null

    test.beforeAll(async () => {
      appClient = await launchClient('p2p-main-', { fakeMedia: false })
    })

    test.afterAll(async () => {
      await closeClient(appClient)
    })

    test('Main window should be created', async () => {
      if (!appClient) throw new Error('Missing app client')
      await expect(appClient.page.locator('body')).toBeVisible()
      await expect(appClient.page).toHaveTitle(/P2P Conference/)
    })

    test('IPC: get-app-version should return version', async () => {
      if (!appClient) throw new Error('Missing app client')
      const version = await appClient.app.evaluate(async ({ app }) => {
        return app.getVersion()
      })
      expect(version).toBe('1.0.0')
    })

    test('IPC: get-platform should return valid platform info', async () => {
      if (!appClient) throw new Error('Missing app client')
      const platformInfo = await appClient.app.evaluate(() => {
        return {
          platform: process.platform,
          arch: process.arch
        }
      })
      expect(platformInfo.platform).toBeDefined()
      expect(platformInfo.arch).toBeDefined()
    })

    test('IPC: get-ice-servers should return configuration', async () => {
      if (!appClient) throw new Error('Missing app client')
      const iceServers = await appClient.page.evaluate(async () => {
        return await (window as any).electronAPI.getICEServers()
      })
      expect(iceServers.length).toBeGreaterThan(0)
      expect(iceServers[0].urls).toBeDefined()
    })
})
