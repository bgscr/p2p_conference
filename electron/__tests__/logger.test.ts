
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be hoisted
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(),
        isPackaged: false,
    }
}));

vi.mock('fs', async () => {
    const mocks = {
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        appendFileSync: vi.fn(),
        readdirSync: vi.fn().mockReturnValue([]),
        unlinkSync: vi.fn(),
        statSync: vi.fn(),
    };
    return {
        ...mocks,
        default: mocks,
    }
});

import { app } from 'electron';
import fs from 'fs';
import { fileLogger } from '../logger';

describe('FileLogger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton state
        (fileLogger as any).initialized = false;
        (fileLogger as any).initPromise = null;
    });

    it('should initialize correctly in dev mode', async () => {
        (app.getPath as any).mockReturnValue('/mock/app/path');
        (fs.existsSync as any).mockReturnValue(false);

        await fileLogger.init();

        expect(fs.mkdirSync).toHaveBeenCalled();
        const logDir = fileLogger.getLogsDir();
        expect(logDir).toBeDefined();
    });

    it('should write log when initialized', async () => {
        (fs.existsSync as any).mockReturnValue(true);
        await fileLogger.init();

        fileLogger.info('TestModule', 'Test Message');

        expect(fs.appendFileSync).toHaveBeenCalled();

        // Robust check
        const calls = (fs.appendFileSync as any).mock.calls;
        const found = calls.some((args: any[]) => args[1] && typeof args[1] === 'string' && args[1].includes('Test Message'));
        expect(found).toBe(true);
    });

    it('should cleanup old logs', async () => {
        // Mock files
        (fs.readdirSync as any).mockReturnValue(['p2p-conference-2000-01-01.log', 'other.txt']);

        // Mock statSync to return OLD time (older than 7 days)
        (fs.statSync as any).mockReturnValue({
            mtime: new Date('2000-01-01')
        });

        await fileLogger.init();

        // other.txt should be ignored
        expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('p2p-conference-2000-01-01.log'));
        expect(fs.unlinkSync).not.toHaveBeenCalledWith(expect.stringContaining('other.txt'));
    });
});
