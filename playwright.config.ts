import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
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
});
