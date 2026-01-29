/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['src/__tests__/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts', 'src/**/*.tsx'],
            exclude: [
                'src/__tests__/**',
                'src/types/**',
                'src/vite-env.d.ts',
                '**/*.d.ts',
                '**/*.test.ts',
                '**/*.test.tsx',
                'electron/**', // Exclude electron main/preload from this report as we are testing renderer
                'out/**',
                'build/**',
                'dist/**'
            ],
            all: true, // Show all files in report, even if not tested
            thresholds: {
                lines: 55,
                functions: 55,
                branches: 40,
                statements: 55
            }
        },
    },
})
