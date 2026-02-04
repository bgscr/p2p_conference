
import { describe, it, expect, vi } from 'vitest';

// Mocks
vi.mock('fs', () => {
    const mocks = {
        existsSync: vi.fn().mockReturnValue(false),
        mkdirSync: vi.fn(),
    };
    return {
        ...mocks,
        default: mocks,
    };
});

vi.mock('electron', () => {
    return {
        app: {
            quit: vi.fn(),
            getPath: vi.fn().mockReturnValue('/tmp'),
            getAppPath: vi.fn().mockReturnValue('/'),
            getVersion: vi.fn().mockReturnValue('1.0.0'),
            whenReady: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            isPackaged: false,
        },
        BrowserWindow: vi.fn(function () {
            return {
                webContents: {
                    session: {
                        webRequest: {
                            onHeadersReceived: vi.fn(),
                        }
                    },
                    on: vi.fn(),
                    openDevTools: vi.fn(),
                    send: vi.fn(),
                },
                on: vi.fn(),
                loadURL: vi.fn(),
                loadFile: vi.fn(),
                show: vi.fn(),
                focus: vi.fn(),
                hide: vi.fn(),
            };
        }),
        ipcMain: {
            handle: vi.fn(),
            on: vi.fn(),
        },
        Tray: vi.fn(function () {
            return {
                setToolTip: vi.fn(),
                setContextMenu: vi.fn(),
                setImage: vi.fn(),
                on: vi.fn(),
                displayBalloon: vi.fn(),
            };
        }),
        Menu: {
            buildFromTemplate: vi.fn(),
            setApplicationMenu: vi.fn(),
            MenuItem: vi.fn(),
        },
        nativeImage: {
            createFromPath: vi.fn().mockReturnValue({
                isEmpty: () => false,
                resize: vi.fn().mockReturnThis(),
                getSize: () => ({ width: 32, height: 32 }),
            }),
            createFromDataURL: vi.fn().mockReturnValue({
                resize: vi.fn(),
            }),
        },
        shell: {
            openPath: vi.fn(),
            openExternal: vi.fn(),
        },
        systemPreferences: {
            getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
            askForMediaAccess: vi.fn().mockResolvedValue(true),
        }
    };
});

vi.mock('../logger', () => ({
    fileLogger: {
        init: vi.fn().mockResolvedValue(undefined),
        getLogsDir: vi.fn(),
        logFromRenderer: vi.fn(),
        createModuleLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    },
    MainLog: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    },
    TrayLog: { info: vi.fn(), debug: vi.fn() },
    IPCLog: { info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../credentials', () => ({
    getICEServers: vi.fn(),
    getMQTTBrokers: vi.fn(),
}));

// Import main to trigger execution
import '../main';
import { ipcMain, app, BrowserWindow } from 'electron';
import { MainLog } from '../logger';

describe('Main Process', () => {
    it('should register IPC handlers', () => {
        expect(ipcMain.handle).toHaveBeenCalledWith('get-app-version', expect.any(Function));
        expect(ipcMain.handle).toHaveBeenCalledWith('get-ice-servers', expect.any(Function));
        expect(ipcMain.on).toHaveBeenCalledWith('log-message', expect.any(Function));
    });

    it('should initialize app on ready', async () => {
        // Wait for whenReady
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify flow
        expect(MainLog.info).toHaveBeenCalledWith('App starting', expect.anything());
        // expect(MainLog.info).toHaveBeenCalledWith('Creating main window'); // Uncomment if we reach here

        expect(BrowserWindow).toHaveBeenCalled();
        expect(app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
    });
});
