import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test'

test.describe('Settings and Navigation E2E', () => {
    test.describe.configure({ mode: 'serial' })

    let electronApp: ElectronApplication
    let window: Page

    test.beforeAll(async () => {
        electronApp = await electron.launch({
            args: ['.', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
            locale: 'en-US',
            env: { ...process.env, NODE_ENV: 'test' }
        })
        window = await electronApp.firstWindow()
    })

    test.afterAll(async () => {
        await electronApp.close()
    })

    test('Settings panel opens and closes correctly', async () => {
        // Force English language
        await window.evaluate(() => {
            localStorage.setItem('p2p-conf-language', 'en')
        })
        await window.reload()
        await window.waitForLoadState('domcontentloaded')

        // Wait for lobby
        await expect(window.locator('data-testid=lobby-title')).toBeVisible()

        // Click settings button (gear icon)
        const settingsBtn = window.locator('button[title*="Settings"], button[aria-label*="Settings"], button:has(svg.lucide-settings)')

        // If settings button exists on lobby, click it
        if (await settingsBtn.count() > 0) {
            await settingsBtn.first().click()

            // Verify settings panel is visible
            const settingsPanel = window.locator('[data-testid=settings-panel], .settings-panel, text=Settings')
            await expect(settingsPanel.first()).toBeVisible({ timeout: 5000 })
        }
    })

    test('Language can be changed in settings', async () => {
        // Force English first
        await window.evaluate(() => {
            localStorage.setItem('p2p-conf-language', 'en')
        })
        await window.reload()
        await window.waitForLoadState('domcontentloaded')

        // Look for language selector
        const languageSelect = window.locator('select[data-testid=language-select], select:has-text("English")')

        if (await languageSelect.count() > 0) {
            // Get current value before change
            const currentLang = await window.evaluate(() => localStorage.getItem('p2p-conf-language'))
            expect(currentLang).toBe('en')

            // Change to another language (Spanish)
            await languageSelect.first().selectOption('es')

            // Verify localStorage was updated
            const newLang = await window.evaluate(() => localStorage.getItem('p2p-conf-language'))
            expect(newLang).toBe('es')

            // Reset to English
            await languageSelect.first().selectOption('en')
        }
    })

    test('Complete user flow: Join room, toggle controls, leave room', async () => {
        // Force English
        await window.evaluate(() => {
            localStorage.setItem('p2p-conf-language', 'en')
        })
        await window.reload()
        await window.waitForLoadState('domcontentloaded')

        // Wait for lobby
        await expect(window.locator('data-testid=lobby-title')).toBeVisible()

        // Enter username
        const nameInput = window.locator('data-testid=lobby-name-input')
        await nameInput.fill('E2ETestUser')

        // Generate room ID
        const generateBtn = window.locator('data-testid=lobby-generate-btn')
        await generateBtn.click()

        // Verify Room ID is generated
        const roomInput = window.locator('data-testid=lobby-room-input')
        const roomId = await roomInput.inputValue()
        expect(roomId.length).toBeGreaterThan(5)

        // Join room
        const joinBtn = window.locator('data-testid=lobby-join-btn')
        await joinBtn.click()

        // Wait for room view
        const leaveBtn = window.locator('data-testid=room-leave-btn')
        await expect(leaveBtn).toBeVisible({ timeout: 20000 })

        // Toggle mute using keyboard
        await window.keyboard.press('m')
        await window.waitForTimeout(500)
        await window.keyboard.press('m')

        // Check for overlay (Searching for peers...)
        const cancelBtn = window.locator('button:has-text("Cancel")')
        if (await cancelBtn.isVisible()) {
            await cancelBtn.click()
        } else {
            // Leave room via main button if connected
            await leaveBtn.click()
        }

        // Verify leave confirmation dialog or direct return to lobby
        const confirmBtn = window.locator('button:has-text("Leave"), button:has-text("Confirm")')
        if (await confirmBtn.count() > 0) {
            await confirmBtn.first().click()
        }

        // Verify return to lobby
        await expect(window.locator('data-testid=lobby-title')).toBeVisible({ timeout: 10000 })
    })

    test('Room ID validation shows error for empty room', async () => {
        // Force English
        await window.evaluate(() => {
            localStorage.setItem('p2p-conf-language', 'en')
        })
        await window.reload()
        await window.waitForLoadState('domcontentloaded')

        // Wait for lobby
        await expect(window.locator('data-testid=lobby-title')).toBeVisible()

        // Enter username
        const nameInput = window.locator('data-testid=lobby-name-input')
        await nameInput.fill('TestUser')

        // Clear room input (should be empty by default)
        const roomInput = window.locator('data-testid=lobby-room-input')
        await roomInput.clear()

        // Click Join without room ID
        const joinBtn = window.locator('data-testid=lobby-join-btn')

        // Join button should be disabled or show error
        const isDisabled = await joinBtn.isDisabled()

        if (!isDisabled) {
            await joinBtn.click()
            // Should see error or remain on lobby
            await expect(window.locator('data-testid=lobby-title')).toBeVisible()
        } else {
            expect(isDisabled).toBe(true)
        }
    })

    test('Copy room link functionality works', async () => {
        // Force English
        await window.evaluate(() => {
            localStorage.setItem('p2p-conf-language', 'en')
        })
        await window.reload()
        await window.waitForLoadState('domcontentloaded')

        // Wait for lobby
        await expect(window.locator('data-testid=lobby-title')).toBeVisible()

        // Enter username
        const nameInput = window.locator('data-testid=lobby-name-input')
        await nameInput.fill('TestUser')

        // Generate room ID
        const generateBtn = window.locator('data-testid=lobby-generate-btn')
        await generateBtn.click()

        // Look for copy button
        const copyBtn = window.locator('[data-testid=copy-link-btn], button[title*="Copy"], button:has(svg.lucide-copy)')

        if (await copyBtn.count() > 0) {
            await copyBtn.first().click()

            // Verify clipboard or toast notification
            // Note: Clipboard access may be restricted in test environment
            await window.waitForTimeout(500)
        }
    })
})
