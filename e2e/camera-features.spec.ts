import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test';

test.describe('Camera Features E2E', () => {
    test.describe.configure({ mode: 'serial' });

    let electronApp: ElectronApplication;
    let window: Page;

    test.beforeAll(async () => {
        electronApp = await electron.launch({
            args: ['.', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
            locale: 'en-US',
            env: { ...process.env, NODE_ENV: 'test' }
        });
        window = await electronApp.firstWindow();
    });

    test.afterAll(async () => {
        await electronApp.close();
    });

    test('Lobby Camera Toggle & Join with Video Off', async () => {
        // Force English language
        await window.evaluate(() => {
            localStorage.setItem('p2p-conf-language', 'en');
        });
        await window.reload();
        await window.waitForLoadState('domcontentloaded');

        // Check toggle exists
        const cameraToggle = window.locator('data-testid=camera-toggle');
        await expect(cameraToggle).toBeVisible();

        // Check it is OFF (gray background)
        await expect(cameraToggle).toHaveClass(/bg-gray-300/);

        // Click to turn ON
        await cameraToggle.click();
        await expect(cameraToggle).toHaveClass(/bg-blue-600/);

        // Click to turn OFF again
        await cameraToggle.click();
        await expect(cameraToggle).toHaveClass(/bg-gray-300/);

        // Enter username
        const nameInput = window.locator('data-testid=lobby-name-input');
        await nameInput.fill('TestUser');

        // Click Generate button
        const generateBtn = window.locator('data-testid=lobby-generate-btn');
        await generateBtn.click();

        // Click Join
        const joinBtn = window.locator('data-testid=lobby-join-btn');
        // Wait a bit just in case
        await window.waitForTimeout(1000);
        await joinBtn.click();

        // Verify transition to Room View
        const leaveBtn = window.locator('data-testid=room-leave-btn');
        await expect(leaveBtn).toBeVisible({ timeout: 20000 });

        // Verify Video Button exists and indicates "Start Video"
        const roomVideoBtn = window.locator('data-testid=room-video-btn');
        await expect(roomVideoBtn).toBeVisible();
        await expect(roomVideoBtn).toHaveAttribute('title', 'Start Video');
    });
});
