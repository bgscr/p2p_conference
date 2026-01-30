
import { describe, it, expect, vi } from 'vitest';

// Mock electron before import
vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld: vi.fn(),
    },
    ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        send: vi.fn(),
        removeAllListeners: vi.fn(),
    }
}));

import { contextBridge, ipcRenderer } from 'electron';
// We need to import the file to trigger execution. 
// Since it's a script that executes on load, dynamic import might be best?
// Or just require.
// But Vitest uses ESM. 
// Also the file is .ts, so we can mock imports if needed.
// But we want to test that 'exposeInMainWorld' was called.
// So we just import it.
import './preload';

describe('Preload Script', () => {
    it('should expose electronAPI', () => {
        expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
            'electronAPI',
            expect.objectContaining({
                getMicPermission: expect.any(Function),
                requestMicPermission: expect.any(Function),
                log: expect.any(Function),
            })
        );
    });

    it('should invoke IPC correctly', () => {
        // Get the exposed API object
        const exposedApi = (contextBridge.exposeInMainWorld as any).mock.calls[0][1];

        // Test a method
        exposedApi.getMicPermission();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-mic-permission');

        exposedApi.log('info', 'PreloadTest', 'Message');
        expect(ipcRenderer.send).toHaveBeenCalledWith('log-message', {
            level: 'info',
            module: 'PreloadTest',
            message: 'Message',
            data: undefined
        });
    });
});
