import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock functions – survive vi.resetModules() because they are
// created in vi.hoisted() which runs before everything else.
// ---------------------------------------------------------------------------
const { mockRender, mockCreateRoot } = vi.hoisted(() => {
  const mockRender = vi.fn()
  const mockCreateRoot = vi.fn(() => ({ render: mockRender }))
  return { mockRender, mockCreateRoot }
})

vi.mock('react-dom/client', () => ({
  default: { createRoot: mockCreateRoot },
  createRoot: mockCreateRoot,
}))

vi.mock('../renderer/App', () => ({
  default: function MockApp() {
    return 'MockApp'
  },
}))

vi.mock('../renderer/styles/globals.css', () => ({}))

// ---------------------------------------------------------------------------
// Helper – re-import the entry point so its top-level code runs fresh.
// ---------------------------------------------------------------------------
async function loadMain() {
  vi.resetModules()
  await import('../renderer/main.tsx')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Renderer entry point (main.tsx)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Reset DOM to a clean state with a #root div
    document.body.innerHTML = '<div id="root"></div>'

    // Reset mock state
    mockCreateRoot.mockClear()
    mockRender.mockClear()
    mockCreateRoot.mockReturnValue({ render: mockRender })

    // Spy on console.error (suppress output in test runner)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Clear any previous global error handlers
    window.onerror = null
    window.onunhandledrejection = null
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  // -------------------------------------------------------
  // 1. Successful render when root element exists
  // -------------------------------------------------------
  describe('successful render', () => {
    it('calls createRoot with the #root element and renders the App', async () => {
      await loadMain()

      const rootEl = document.getElementById('root')
      expect(mockCreateRoot).toHaveBeenCalledWith(rootEl)
      expect(mockRender).toHaveBeenCalledTimes(1)
    })

    it('renders inside React.StrictMode', async () => {
      await loadMain()

      // The first argument to render() should be a React.StrictMode element
      const rendered = mockRender.mock.calls[0][0]
      expect(rendered.type).toBe(Symbol.for('react.strict_mode'))
    })
  })

  // -------------------------------------------------------
  // 2. Error handling when root element is missing
  // -------------------------------------------------------
  describe('missing root element', () => {
    it('logs error when #root is absent', async () => {
      document.body.innerHTML = '' // no #root

      await loadMain()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to render app:',
        expect.any(Error),
      )
      // createRoot should NOT have been called since there is no element
      expect(mockCreateRoot).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------
  // 3. window.onerror handler renders error message to DOM
  // -------------------------------------------------------
  describe('window.onerror handler', () => {
    it('renders an error message into #root', async () => {
      await loadMain()

      // Invoke the installed handler directly
      expect(window.onerror).toBeTypeOf('function')

      const handler = window.onerror as (
        message: string | Event,
        source?: string,
        lineno?: number,
        colno?: number,
        error?: Error,
      ) => void

      handler('Something broke', 'app.js', 10, 5, new Error('boom'))

      const rootEl = document.getElementById('root')!
      expect(rootEl.innerHTML).toContain('Application Error')
      expect(rootEl.innerHTML).toContain('Something broke')
      expect(rootEl.innerHTML).toContain('app.js:10:5')
    })

    it('logs the error to console.error', async () => {
      await loadMain()
      consoleErrorSpy.mockClear()

      const handler = window.onerror as Function
      handler('Oops', 'index.js', 1, 1, new Error('fail'))

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Global error:',
        'Oops',
        'index.js',
        1,
        1,
        expect.any(Error),
      )
    })
  })

  // -------------------------------------------------------
  // 4. window.onunhandledrejection handler logs to console
  // -------------------------------------------------------
  describe('window.onunhandledrejection handler', () => {
    it('logs the rejection reason to console.error', async () => {
      await loadMain()
      consoleErrorSpy.mockClear()

      expect(window.onunhandledrejection).toBeTypeOf('function')

      const handler = window.onunhandledrejection as (event: PromiseRejectionEvent) => void
      handler({ reason: 'async failure' } as unknown as PromiseRejectionEvent)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unhandled promise rejection:',
        'async failure',
      )
    })
  })

  // -------------------------------------------------------
  // 5. Catch block renders error message to DOM
  // -------------------------------------------------------
  describe('catch block error rendering', () => {
    it('renders "Failed to Start" when createRoot throws', async () => {
      mockCreateRoot.mockImplementation(() => {
        throw new Error('createRoot exploded')
      })

      await loadMain()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to render app:',
        expect.any(Error),
      )

      const rootEl = document.getElementById('root')!
      expect(rootEl.innerHTML).toContain('Failed to Start')
      expect(rootEl.innerHTML).toContain('createRoot exploded')
    })

    it('renders "Failed to Start" when render() throws', async () => {
      mockRender.mockImplementation(() => {
        throw new Error('render blew up')
      })

      await loadMain()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to render app:',
        expect.any(Error),
      )

      const rootEl = document.getElementById('root')!
      expect(rootEl.innerHTML).toContain('Failed to Start')
      expect(rootEl.innerHTML).toContain('render blew up')
    })

    it('handles non-Error throw values gracefully', async () => {
      mockCreateRoot.mockImplementation(() => {
        throw 'string error' // eslint-disable-line no-throw-literal
      })

      await loadMain()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to render app:',
        'string error',
      )

      const rootEl = document.getElementById('root')!
      expect(rootEl.innerHTML).toContain('Failed to Start')
      expect(rootEl.innerHTML).toContain('string error')
    })
  })
})
