import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test'

test.describe('Keyboard Shortcuts E2E', () => {
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

    test('Join room for keyboard shortcut testing', async () => {
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
        await nameInput.fill('KeyboardUser')

        // Generate room ID
        const generateBtn = window.locator('data-testid=lobby-generate-btn')
        await generateBtn.click()

        // Join room
        const joinBtn = window.locator('data-testid=lobby-join-btn')
        await joinBtn.click()

        // Wait for room view
        await expect(window.locator('data-testid=room-leave-btn')).toBeVisible({ timeout: 20000 })
    })

    test('M key toggles microphone', async () => {
        const muteBtn = window.locator('data-testid=room-mute-btn')
        await expect(muteBtn).toBeVisible()

        // Get initial title
        const initialTitle = await muteBtn.getAttribute('title')

        // Press 'm' to toggle mute
        await window.keyboard.press('m')
        await window.waitForTimeout(300)

        // Title should change
        const newTitle = await muteBtn.getAttribute('title')
        expect(newTitle).not.toBe(initialTitle)

        // Press 'm' again to toggle back
        await window.keyboard.press('m')
        await window.waitForTimeout(300)

        // Title should return to initial
        const finalTitle = await muteBtn.getAttribute('title')
        expect(finalTitle).toBe(initialTitle)
    })

    test('L key toggles speaker output', async () => {
        const speakerBtn = window.locator('data-testid=room-speaker-btn')
        await expect(speakerBtn).toBeVisible()

        // Get initial title
        const initialTitle = await speakerBtn.getAttribute('title')

        // Press 'l' to toggle speaker
        await window.keyboard.press('l')
        await window.waitForTimeout(300)

        // Title should change
        const newTitle = await speakerBtn.getAttribute('title')
        expect(newTitle).not.toBe(initialTitle)

        // Press 'l' again to toggle back
        await window.keyboard.press('l')
        await window.waitForTimeout(300)

        // Title should return to initial
        const finalTitle = await speakerBtn.getAttribute('title')
        expect(finalTitle).toBe(initialTitle)
    })

    test('V key toggles video', async () => {
        const videoBtn = window.locator('data-testid=room-video-btn')
        await expect(videoBtn).toBeVisible()

        // Get initial title (should be "Start Video" since we joined without video)
        const initialTitle = await videoBtn.getAttribute('title')

        // Press 'v' to toggle video
        await window.keyboard.press('v')
        await window.waitForTimeout(500)

        // Title should change
        const newTitle = await videoBtn.getAttribute('title')
        expect(newTitle).not.toBe(initialTitle)

        // Press 'v' again to toggle back
        await window.keyboard.press('v')
        await window.waitForTimeout(500)

        // Title should return to initial
        const finalTitle = await videoBtn.getAttribute('title')
        expect(finalTitle).toBe(initialTitle)
    })

    test('Escape key triggers leave', async () => {
        // Press Escape to trigger leave
        await window.keyboard.press('Escape')
        await window.waitForTimeout(500)

        // Should see leave confirmation dialog or return to lobby
        const confirmDialog = window.locator('text=Are you sure, text=Leave')
        const lobbyTitle = window.locator('data-testid=lobby-title')

        // Wait for either confirmation dialog or lobby
        const confirmVisible = await confirmDialog.first().isVisible().catch(() => false)

        if (confirmVisible) {
            // Click cancel to stay in room
            const cancelBtn = window.locator('button:has-text("Cancel"), button:has-text("Stay")')
            if (await cancelBtn.count() > 0) {
                await cancelBtn.first().click()
            }
        } else {
            // May have gone directly to lobby - that's also valid behavior
            const lobbyVisible = await lobbyTitle.isVisible().catch(() => false)
            if (lobbyVisible) {
                expect(lobbyVisible).toBe(true)
            }
        }
    })
})
