import { defineConfig } from '@playwright/test';

// Ensure Electron runs in app mode for e2e tests (not Node mode).
if (process.env.ELECTRON_RUN_AS_NODE) {
    delete process.env.ELECTRON_RUN_AS_NODE;
}

const smokeSpecs = ['main.spec.ts', 'chat.spec.ts', 'keyboard-shortcuts.spec.ts']

export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    timeout: 60000,
    expect: {
        timeout: 5000
    },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Electron tests should run sequentially usually to avoid conflicts
    reporter: 'html',
    use: {
        actionTimeout: 0,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'smoke',
            testMatch: smokeSpecs
        },
        {
            name: 'nightly',
            testMatch: '*.spec.ts',
            testIgnore: smokeSpecs
        }
    ]
});
