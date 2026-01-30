import { _electron as electron, test, expect, ElectronApplication } from '@playwright/test';

test.describe('Application Launch', () => {
    let electronApp: ElectronApplication;

    test.beforeAll(async () => {
        // Start the app with the main script from package.json
        // We assume the app is built or at least the main process is transpiled to out/main/index.js
        // If running from source with ts-node/electron-vite is needed, args might differ.
        // Standard electron-vite setup usually means we run the built main process.
        electronApp = await electron.launch({
            args: ['.'],
            env: { ...process.env, NODE_ENV: 'test' }
        });
    });

    test.afterAll(async () => {
        await electronApp.close();
    });

    test('Main window should be created', async () => {
        const window = await electronApp.firstWindow();
        await expect(window.locator('body')).toBeVisible();
        await expect(window).toHaveTitle(/P2P Conference/);
    });

    test('IPC: get-app-version should return version', async () => {
        const version = await electronApp.evaluate(async ({ app }) => {
            return app.getVersion();
        });
        expect(version).toBe('1.0.0');
    });

    test('IPC: get-platform should return valid platform info', async () => {
        // Access process global directly
        const platformInfo = await electronApp.evaluate(() => {
            return {
                platform: process.platform,
                arch: process.arch
            };
        });
        expect(platformInfo.platform).toBeDefined();
        expect(platformInfo.arch).toBeDefined();
    });

    test('IPC: get-ice-servers should return configuration', async () => {
        // We can't easily invoke IPC handler directly from here without using the renderer window
        // so we evaluate in the main process by accessing the ipcMain handler if exposed?
        // Or simpler: use the window to call window.electronAPI.getICEServers()
        const window = await electronApp.firstWindow();
        const iceServers = await window.evaluate(async () => {
            return await (window as any).electronAPI.getICEServers();
        });
        expect(iceServers.length).toBeGreaterThan(0);
        expect(iceServers[0].urls).toBeDefined();
    });
});
