import { desktopCapturer, screen } from 'electron'

type LoggerLike = {
  debug: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
}

interface SetupDisplayMediaHandlerOptions {
  currentSession: Electron.Session | null | undefined
  logger: LoggerLike
}

interface DisplayMediaRequest {
  securityOrigin?: string
  videoRequested?: boolean
  audioRequested?: boolean
  userGesture?: boolean
}

interface CaptureSourceLike {
  id: string
  name: string
  display_id: string
}

export function pickCurrentScreenSource(
  sources: Electron.DesktopCapturerSource[]
): Electron.DesktopCapturerSource | undefined {
  const screenSources = sources.filter((source) => source.id.startsWith('screen:'))
  if (screenSources.length === 0) {
    return undefined
  }

  try {
    const cursorPoint = screen.getCursorScreenPoint()
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint)
    const currentDisplayId = String(currentDisplay.id)
    const matched = screenSources.find((source) => source.display_id === currentDisplayId)
    return matched ?? screenSources[0]
  } catch {
    return screenSources[0]
  }
}

export function prioritizeCaptureSources(
  sources: Electron.DesktopCapturerSource[]
): Electron.DesktopCapturerSource[] {
  const screenSources = sources.filter((source) => source.id.startsWith('screen:'))
  const windowSources = sources.filter((source) => source.id.startsWith('window:'))
  const currentScreen = pickCurrentScreenSource(screenSources)
  const orderedScreens = currentScreen
    ? [currentScreen, ...screenSources.filter((source) => source.id !== currentScreen.id)]
    : screenSources

  return [...orderedScreens, ...windowSources]
}

export function setupDisplayMediaHandler(options: SetupDisplayMediaHandlerOptions): void {
  const { currentSession, logger } = options
  try {
    if (!currentSession || typeof (currentSession as any).setDisplayMediaRequestHandler !== 'function') {
      logger.warn('Display media request handler not available')
      return
    }

    const requestHandler = async (
      request: DisplayMediaRequest,
      callback: (streams: { video?: Electron.DesktopCapturerSource; audio?: any }) => void
    ) => {
      try {
        logger.debug('Display media request received', {
          origin: request.securityOrigin,
          videoRequested: request.videoRequested,
          audioRequested: request.audioRequested,
          userGesture: request.userGesture
        })

        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
        const prioritizedSources = prioritizeCaptureSources(sources)

        if (!prioritizedSources || prioritizedSources.length === 0) {
          logger.warn('No display capture sources available')
          callback({ video: undefined })
          return
        }

        const preferred = prioritizedSources[0]
        logger.info('Display capture source granted', {
          sourceCount: prioritizedSources.length,
          sourceId: preferred.id,
          sourceName: preferred.name,
          sourceType: preferred.id.startsWith('screen:') ? 'screen' : 'window'
        })
        callback({ video: preferred })
      } catch (err) {
        logger.error('Failed to provide display capture source', { error: String(err) })
        callback({ video: undefined })
      }
    }

    try {
      currentSession.setDisplayMediaRequestHandler(requestHandler, { useSystemPicker: true })
      logger.info('Display media request handler configured', { useSystemPicker: true })
    } catch (err) {
      logger.warn('Failed to enable system picker for display media, retrying without it', {
        error: String(err)
      })
      currentSession.setDisplayMediaRequestHandler(requestHandler)
      logger.info('Display media request handler configured', { useSystemPicker: false })
    }
  } catch (err) {
    logger.error('Failed to configure display media handler', { error: String(err) })
  }
}

export async function getScreenSourcesForIpc(
  logger: LoggerLike
): Promise<CaptureSourceLike[]> {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    const prioritizedSources = prioritizeCaptureSources(sources)
    const serializableSources = prioritizedSources.map((source) => ({ id: source.id, name: source.name, display_id: source.display_id }))
    logger.debug('Screen sources requested', {
      count: serializableSources.length,
      firstSourceId: serializableSources[0]?.id
    })
    return serializableSources
  } catch (err) {
    logger.error('Failed to get screen sources', { error: String(err) })
    return []
  }
}
