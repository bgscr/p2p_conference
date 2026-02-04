
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { MessageDeduplicator, MQTTClient, MultiBrokerMQTT, generatePeerId } from '../renderer/signaling/SimplePeerManager';


// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
    SignalingLog: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}));

// Mock WebSocket
class MockWebSocket {
    url: string;
    protocol: string;
    readyState: number = 0; // CONNECTING
    binaryType: string = 'blob'; // 'blob' or 'arraybuffer'
    onopen: (() => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onclose: ((event: any) => void) | null = null;
    send: Mock = vi.fn();
    close: Mock = vi.fn();

    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url: string, protocol: string) {
        this.url = url;
        this.protocol = protocol;
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            if (this.onopen) this.onopen();
        }, 10);
    }
}

global.WebSocket = MockWebSocket as any;


describe('MessageDeduplicator', () => {
    let deduplicator: MessageDeduplicator;

    beforeEach(() => {
        vi.useFakeTimers();
        deduplicator = new MessageDeduplicator();
    });

    afterEach(() => {
        deduplicator.destroy();
        vi.useRealTimers();
    });

    it('should identify duplicate messages', () => {
        const msgId = 'test-msg-1';
        expect(deduplicator.isDuplicate(msgId)).toBe(false); // First time seen
        expect(deduplicator.isDuplicate(msgId)).toBe(true);  // Duplicate
    });

    it('should handle null/empty msgId', () => {
        expect(deduplicator.isDuplicate('')).toBe(false);
        expect(deduplicator.isDuplicate('')).toBe(false);
    });


    it('should cleanup old entries', () => {
        const start = new Date('2025-01-01T12:00:00Z');
        vi.setSystemTime(start);

        const msgId = 'old-msg';
        deduplicator.isDuplicate(msgId);

        // Advance time
        vi.setSystemTime(new Date(start.getTime() + 31000));

        // Manually call cleanup to verify logic without relying on interval timing
        deduplicator.cleanup();

        expect(deduplicator.isDuplicate(msgId)).toBe(false);
    });
});

describe('MQTTClient', () => {
    let client: MQTTClient;
    const brokerUrl = 'wss://test.broker.com/mqtt';
    let mockWsInstance: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Spy on WebSocket constructor to capture instance
        // We need to do this BEFORE creating the client


        global.WebSocket = class extends MockWebSocket {
            constructor(url: string, protocol: string) {
                super(url, protocol);
                mockWsInstance = this; // eslint-disable-line @typescript-eslint/no-this-alias
            }
        } as any;

        // Copy static constants
        (global.WebSocket as any).CONNECTING = 0;
        (global.WebSocket as any).OPEN = 1;
        (global.WebSocket as any).CLOSING = 2;
        (global.WebSocket as any).CLOSED = 3;

        client = new MQTTClient(brokerUrl);
    });

    afterEach(() => {
        client.disconnect();
    });

    it('should connect successfully', async () => {
        const connectPromise = client.connect();
        await new Promise(resolve => setTimeout(resolve, 0)); // Wait for constructor
        expect(mockWsInstance).toBeDefined();
        await new Promise(resolve => setTimeout(resolve, 20)); // Wait for open

        // Simulate CONNACK (type 2)
        if (mockWsInstance.onmessage) {
            mockWsInstance.onmessage({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]) });
        }

        await connectPromise;
        expect(client.isConnected()).toBe(true);
    });

    it('should handle publish', async () => {
        // Setup connected client
        const connectPromise = client.connect();
        await new Promise(resolve => setTimeout(resolve, 20)); // Wait for open
        if (mockWsInstance.onmessage) {
            mockWsInstance.onmessage({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]) });
        }
        await connectPromise;

        const sent = client.publish('test-topic', 'test-message');
        expect(sent).toBe(true);
        expect(mockWsInstance.send).toHaveBeenCalled();
    });
});

describe('MultiBrokerMQTT', () => {
    let multiBroker: MultiBrokerMQTT;

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup Mock WebSocket global again since it might be reset or we want fresh state
        // (Doing it in MQTTClient describe block might isolate it, here we need it too)


        global.WebSocket = class extends MockWebSocket {
            constructor(url: string, protocol: string) {
                super(url, protocol);
                // Simulate auto-connect behavior needed for connectAll
                setTimeout(() => {
                    this.readyState = 1; // OPEN
                    if (this.onopen) this.onopen();
                    // Auto-reply with CONNACK for any connection attempt to make tests faster/easier
                    // But we need to do it after onmessage is assigned by client.
                    // Client assigns onmessage immediately after creation.
                    setTimeout(() => {
                        if (this.onmessage) {
                            this.onmessage({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]) });
                        }
                    }, 10);
                }, 10);
            }
        } as any;

        (global.WebSocket as any).CONNECTING = 0;
        (global.WebSocket as any).OPEN = 1;

        multiBroker = new MultiBrokerMQTT();
    });

    it('should connect to all brokers', async () => {
        // We mocked global WebSocket to auto-succeed
        const connected = await multiBroker.connectAll();
        // Default implementation has 3 brokers in the list
        expect(connected.length).toBeGreaterThan(0);
    });
});

describe('SimplePeerManager Logic', () => {
    it('generatePeerId should return 16 chars', () => {
        const id = generatePeerId();
        expect(id).toHaveLength(16);
    });
});
