/**
 * Internationalization (i18n) System
 * Simple and lightweight translation system
 */

export type Language = 'en' | 'zh-CN'

export interface Translations {
  [key: string]: string | Translations
}

// English translations
const en: Translations = {
  app: {
    name: 'P2P Conference',
    tagline: 'Serverless Audio Conferencing',
    version: 'v1.0.0',
  },
  lobby: {
    yourName: 'Your Name',
    enterName: 'Enter your name',
    roomId: 'Room ID',
    enterRoomId: 'Enter or generate room ID',
    generate: 'Generate',
    shareRoomId: 'Share this ID with others to join the same room',
    audioSetup: 'Audio Setup',
    testMicrophone: 'Test Microphone',
    testSpeaker: 'Test Speaker',
    testCamera: 'Test Camera',
    stopTest: 'Stop Test',
    micActive: 'Mic Active',
    inputLevel: 'Input Level (speak to test)',
    micWorking: 'Microphone is working! Speak to see the level meter move.',
    microphone: 'Microphone',
    speaker: 'Speaker',
    privacyNotice: 'Privacy Notice',
    privacyText: 'This is peer-to-peer communication. Your IP address will be visible to other participants in the call. All audio is encrypted end-to-end via WebRTC DTLS-SRTP.',
    joinRoom: 'Join Room',
    joining: 'Joining...',
    settings: 'Settings',
    roomIdMinLength: 'Room ID must be at least 4 characters',
    roomIdSecurityWarning: 'Short room IDs are easy to guess. Use 8+ characters for privacy.',
    nameMinLength: 'Please enter your name',
    micPermissionDenied: 'Could not access microphone. Please check permissions.',
    cameraPermissionDenied: 'Could not access camera. Please check permissions.',
    startWithCamera: 'Start with camera',
  },
  room: {
    you: 'You',
    muted: 'Muted',
    unmuted: 'Unmuted',
    copyRoomId: 'Copy Room ID',
    roomIdCopied: 'Room ID copied to clipboard',
    roomIdCopyHint: 'Click to copy room ID',
    leaveCall: 'Leave Call',
    leaveCallHint: 'Leave Room (Esc)',
    participants: 'Participants',
    inCall: 'in call',
    searchingParticipants: 'Searching for participants...',
    connecting: 'Connecting...',
    connected: 'Connected',
    notConnected: 'Not connected',
    connectionFailed: 'Connection failed',
    participantsConnected: '{count} participant(s) connected',
    participantJoined: '{name} joined the call',
    participantLeft: '{name} left the call',
    soundEnabled: 'Sound notifications enabled',
    soundDisabled: 'Sound notifications disabled',
    toggleMute: 'Toggle Mute (M)',
    muteHint: 'Mute (M)',
    unmuteHint: 'Unmute (M)',
    toggleSound: 'Toggle Sound Notifications',
    muteNotifications: 'Mute notifications',
    enableNotifications: 'Enable notifications',
    audioSettings: 'Audio Settings',
    noiseSuppressionBrowser: 'AI Noise Suppression (RNNoise)',
    echoCancellation: 'Echo Cancellation',
    autoGainControl: 'Auto Gain Control',
    enabled: 'Enabled',
    disabled: 'Disabled',
    on: 'On',
    off: 'Off',
    live: 'Live',
    waitingForOthers: 'Waiting for others to join',
    shareRoomIdHint: 'Share the room ID with participants to connect',
    copied: 'Copied!',
    performanceWarning: '{count} participants - performance may degrade above 10',
    havingIssues: 'Having issues? Press Ctrl+Shift+L or',
    downloadLogs: 'Download Logs',
    micMuted: 'Microphone muted',
    speakerMuted: 'Speaker muted',
    networkOffline: 'Network offline - waiting for connection',
    reconnecting: 'Reconnecting...',
    retryNow: 'Retry Now',
    reconnectSuccess: 'Connection restored',
    reconnectFailed: 'Reconnection failed',
    startVideo: 'Start Video',
    stopVideo: 'Stop Video',
    toggleChat: 'Chat (T)',
    startScreenShare: 'Share Screen',
    stopScreenShare: 'Stop Sharing',
    screenSharing: 'Sharing Screen',
    screenShareHint: 'Share Screen (S)',
    peerScreenSharing: '{name} is sharing their screen',
  },
  leaveConfirm: {
    title: 'Leave Call?',
    message: 'Are you sure you want to leave the current call?',
    cancel: 'Cancel',
    leave: 'Leave',
  },
  settings: {
    title: 'Settings',
    audioProcessing: 'Audio Processing',
    noiseSuppression: 'AI Noise Suppression',
    noiseSuppressionDesc: 'RNNoise AI-powered noise reduction (removes keyboard, fan noise)',
    echoCancellation: 'Echo Cancellation',
    echoCancellationDesc: 'Prevents audio feedback loops',
    autoGainControl: 'Auto Gain Control',
    autoGainControlDesc: 'Automatically adjusts microphone volume',
    devices: 'Audio Devices',
    inputDevice: 'Input Device (Microphone)',
    outputDevice: 'Output Device (Speaker)',
    videoDevices: 'Video Devices',
    videoDevice: 'Camera',
    cameraPreview: 'Camera Preview',
    language: 'Language',
    debug: 'Debug',
    downloadLogs: 'Download Logs',
    downloadLogsDesc: 'Download debug logs for troubleshooting',
    clearLogs: 'Clear Logs',
    logsCleared: 'Cleared {count} log entries',
    close: 'Close',
  },
  errors: {
    micPermissionDenied: 'Microphone permission denied. Please allow access in your browser/system settings.',
    micNotFound: 'No microphone found. Please connect a microphone and try again.',
    micAccessFailed: 'Failed to access microphone: {error}',
    connectionFailed: 'Failed to join room. Please try again.',
    deviceEnumFailed: 'Failed to enumerate audio devices',
    switchDeviceFailed: 'Failed to switch microphone',
    webSocketFailed: 'WebSocket connection failed, using local mode only',
    peerConnectionFailed: 'Peer connection failed',
    screenShareFailed: 'Failed to start screen sharing',
    screenShareNotSupported: 'Screen sharing is not supported',
  },
  common: {
    cancel: 'Cancel',
    back: 'Back',
    microphone: 'Microphone',
    speaker: 'Speaker',
  },
  connection: {
    idle: 'Ready to connect',
    signaling: 'Finding peers...',
    connecting: 'Establishing connection...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    failed: 'Connection failed',
    searching: 'Searching for participants...',
    searchingSubtitle: 'Looking for others in this room',
    establishing: 'Establishing connection...',
    establishingSubtitle: 'Setting up peer-to-peer audio channels',
    failedSubtitle: 'Please check your network and try again',
    mayTakeTime: 'This may take a few seconds...',
    searchingFor: 'Searching for {seconds} seconds...',
    takingLonger: 'Taking longer than expected',
    checkRoomId: 'Make sure the room ID is correct and other participants are online.',
  },
  warnings: {
    tooManyParticipants: 'Performance may degrade with more than {count} participants',
    symmetricNat: 'Connection may fail due to network restrictions. Try a different network if issues persist.',
  },
  menu: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    help: 'Help',
    downloadLogs: 'Download Logs',
    downloadLogsAccelerator: 'CmdOrCtrl+Shift+L',
    quit: 'Quit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    reload: 'Reload',
    toggleDevTools: 'Toggle Developer Tools',
    about: 'About',
  },
  tray: {
    tooltip: 'P2P Conference',
    tooltipInCall: 'P2P Conference - In Call',
    tooltipMuted: 'P2P Conference - Muted',
    showWindow: 'Show Window',
    hideWindow: 'Hide Window',
    mute: 'Mute Microphone',
    unmute: 'Unmute Microphone',
    leaveCall: 'Leave Call',
    inCall: 'In Call',
    notInCall: 'Not in Call',
    downloadLogs: 'Download Logs',
    quit: 'Quit',
    minimizedTitle: 'P2P Conference',
    minimizedContent: 'App minimized to tray. Call is still active.',
  },
  chat: {
    title: 'Chat',
    placeholder: 'Type a message...',
    send: 'Send',
    noMessages: 'No messages yet',
    joined: '{name} joined',
    left: '{name} left',
    messageTooLong: 'Message is too long (max 5000 characters)',
  },
}

// Simplified Chinese translations
const zhCN: Translations = {
  app: {
    name: 'P2P 会议',
    tagline: '无服务器音频会议',
    version: 'v1.0.0',
  },
  lobby: {
    yourName: '您的名字',
    enterName: '请输入您的名字',
    roomId: '房间 ID',
    enterRoomId: '输入或生成房间 ID',
    generate: '生成',
    shareRoomId: '将此 ID 分享给其他人以加入同一房间',
    audioSetup: '音频设置',
    testMicrophone: '测试麦克风',
    testSpeaker: '测试扬声器',
    testCamera: '测试摄像头',
    stopTest: '停止测试',
    micActive: '麦克风已激活',
    inputLevel: '输入音量（请说话测试）',
    micWorking: '麦克风正常工作！说话可以看到音量指示器变化。',
    microphone: '麦克风',
    speaker: '扬声器',
    privacyNotice: '隐私声明',
    privacyText: '这是点对点通信。您的 IP 地址将对通话中的其他参与者可见。所有音频通过 WebRTC DTLS-SRTP 进行端到端加密。',
    joinRoom: '加入房间',
    joining: '加入中...',
    settings: '设置',
    roomIdMinLength: '房间 ID 至少需要 4 个字符',
    roomIdSecurityWarning: '短房间 ID 容易被猜到。建议使用 8 个以上字符以保护隐私。',
    nameMinLength: '请输入您的名字',
    micPermissionDenied: '无法访问麦克风，请检查权限设置。',
    cameraPermissionDenied: '无法访问摄像头，请检查权限设置。',
    startWithCamera: '启动时打开摄像头',
  },
  room: {
    you: '我',
    muted: '已静音',
    unmuted: '已取消静音',
    copyRoomId: '复制房间 ID',
    roomIdCopied: '房间 ID 已复制到剪贴板',
    roomIdCopyHint: '点击复制房间 ID',
    leaveCall: '离开通话',
    leaveCallHint: '离开房间 (Esc)',
    participants: '参与者',
    inCall: '在通话中',
    searchingParticipants: '正在搜索参与者...',
    connecting: '连接中...',
    connected: '已连接',
    notConnected: '未连接',
    connectionFailed: '连接失败',
    participantsConnected: '{count} 位参与者已连接',
    participantJoined: '{name} 加入了通话',
    participantLeft: '{name} 离开了通话',
    soundEnabled: '声音提示已开启',
    soundDisabled: '声音提示已关闭',
    toggleMute: '切换静音 (M)',
    muteHint: '静音 (M)',
    unmuteHint: '取消静音 (M)',
    toggleSound: '切换声音提示',
    muteNotifications: '关闭通知声音',
    enableNotifications: '开启通知声音',
    audioSettings: '音频设置',
    noiseSuppressionBrowser: 'AI 降噪 (RNNoise)',
    echoCancellation: '回声消除',
    autoGainControl: '自动增益控制',
    enabled: '已开启',
    disabled: '已关闭',
    on: '开',
    off: '关',
    live: '直播中',
    waitingForOthers: '等待其他人加入',
    shareRoomIdHint: '将房间 ID 分享给参与者以连接',
    copied: '已复制！',
    performanceWarning: '{count} 位参与者 - 超过 10 人可能影响性能',
    havingIssues: '遇到问题？按 Ctrl+Shift+L 或',
    downloadLogs: '下载日志',
    micMuted: '麦克风已静音',
    speakerMuted: '扬声器已静音',
    networkOffline: '网络已断开 - 等待连接',
    reconnecting: '正在重连...',
    retryNow: '立即重试',
    reconnectSuccess: '连接已恢复',
    reconnectFailed: '重连失败',
    startVideo: '开启视频',
    stopVideo: '关闭视频',
    toggleChat: '聊天 (T)',
    startScreenShare: '共享屏幕',
    stopScreenShare: '停止共享',
    screenSharing: '正在共享屏幕',
    screenShareHint: '共享屏幕 (S)',
    peerScreenSharing: '{name} 正在共享屏幕',
  },
  leaveConfirm: {
    title: '离开通话？',
    message: '您确定要离开当前通话吗？',
    cancel: '取消',
    leave: '离开',
  },
  settings: {
    title: '设置',
    audioProcessing: '音频处理',
    noiseSuppression: 'AI 降噪',
    noiseSuppressionDesc: 'RNNoise AI 智能降噪（消除键盘、风扇噪音）',
    echoCancellation: '回声消除',
    echoCancellationDesc: '防止音频反馈回路',
    autoGainControl: '自动增益控制',
    autoGainControlDesc: '自动调节麦克风音量',
    devices: '音频设备',
    inputDevice: '输入设备（麦克风）',
    outputDevice: '输出设备（扬声器）',
    videoDevices: '视频设备',
    videoDevice: '摄像头',
    cameraPreview: '摄像头预览',
    language: '语言',
    debug: '调试',
    downloadLogs: '下载日志',
    downloadLogsDesc: '下载调试日志用于故障排查',
    clearLogs: '清除日志',
    logsCleared: '已清除 {count} 条日志',
    close: '关闭',
  },
  errors: {
    micPermissionDenied: '麦克风权限被拒绝。请在浏览器/系统设置中允许访问。',
    micNotFound: '未找到麦克风。请连接麦克风后重试。',
    micAccessFailed: '无法访问麦克风：{error}',
    connectionFailed: '加入房间失败，请重试。',
    deviceEnumFailed: '无法枚举音频设备',
    switchDeviceFailed: '切换麦克风失败',
    webSocketFailed: 'WebSocket 连接失败，仅使用本地模式',
    peerConnectionFailed: '对等连接失败',
    screenShareFailed: '启动屏幕共享失败',
    screenShareNotSupported: '不支持屏幕共享',
  },
  common: {
    cancel: '取消',
    back: '返回',
    microphone: '麦克风',
    speaker: '扬声器',
  },
  connection: {
    idle: '准备连接',
    signaling: '正在查找参与者...',
    connecting: '正在建立连接...',
    connected: '已连接',
    disconnected: '已断开',
    failed: '连接失败',
    searching: '正在搜索参与者...',
    searchingSubtitle: '正在此房间中查找其他人',
    establishing: '正在建立连接...',
    establishingSubtitle: '正在设置点对点音频通道',
    failedSubtitle: '请检查网络后重试',
    mayTakeTime: '这可能需要几秒钟...',
    searchingFor: '已搜索 {seconds} 秒...',
    takingLonger: '搜索时间超出预期',
    checkRoomId: '请确保房间 ID 正确，且其他参与者已在线。',
  },
  warnings: {
    tooManyParticipants: '参与者超过 {count} 人时可能会影响性能',
    symmetricNat: '由于网络限制，连接可能失败。如果持续出现问题，请尝试切换网络。',
  },
  menu: {
    file: '文件',
    edit: '编辑',
    view: '视图',
    help: '帮助',
    downloadLogs: '下载日志',
    downloadLogsAccelerator: 'CmdOrCtrl+Shift+L',
    quit: '退出',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    reload: '重新加载',
    toggleDevTools: '切换开发者工具',
    about: '关于',
  },
  tray: {
    tooltip: 'P2P 会议',
    tooltipInCall: 'P2P 会议 - 通话中',
    tooltipMuted: 'P2P 会议 - 已静音',
    showWindow: '显示窗口',
    hideWindow: '隐藏窗口',
    mute: '静音麦克风',
    unmute: '取消静音',
    leaveCall: '离开通话',
    inCall: '通话中',
    notInCall: '未通话',
    downloadLogs: '下载日志',
    quit: '退出',
    minimizedTitle: 'P2P 会议',
    minimizedContent: '应用已最小化到托盘，通话仍在进行中。',
  },
  chat: {
    title: '聊天',
    placeholder: '输入消息...',
    send: '发送',
    noMessages: '暂无消息',
    joined: '{name} 加入了',
    left: '{name} 离开了',
    messageTooLong: '消息过长（最多5000字符）',
  },
}

const translations: Record<Language, Translations> = {
  'en': en,
  'zh-CN': zhCN,
}

class I18n {
  private currentLanguage: Language = 'en'
  private listeners: Set<() => void> = new Set()

  constructor() {
    // Load saved language preference
    const saved = localStorage.getItem('p2p-conf-language') as Language
    if (saved && translations[saved]) {
      this.currentLanguage = saved
    } else {
      // Detect browser language
      const browserLang = navigator.language
      if (browserLang.startsWith('zh')) {
        this.currentLanguage = 'zh-CN'
      }
    }
  }

  getLanguage(): Language {
    return this.currentLanguage
  }

  setLanguage(lang: Language) {
    if (translations[lang]) {
      this.currentLanguage = lang
      localStorage.setItem('p2p-conf-language', lang)
      this.notifyListeners()
    }
  }

  getAvailableLanguages(): { code: Language; name: string }[] {
    return [
      { code: 'en', name: 'English' },
      { code: 'zh-CN', name: '简体中文' },
    ]
  }

  t(key: string, params?: Record<string, string | number>): string {
    const keys = key.split('.')
    let value: any = translations[this.currentLanguage]

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        // Fallback to English
        value = translations['en']
        for (const fallbackKey of keys) {
          if (value && typeof value === 'object' && fallbackKey in value) {
            value = value[fallbackKey]
          } else {
            return key
          }
        }
        break
      }
    }

    if (typeof value !== 'string') {
      return key
    }

    if (params) {
      return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
        return params[paramKey]?.toString() ?? match
      })
    }

    return value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener())
  }
}

export const i18n = new I18n()

export const t = (key: string, params?: Record<string, string | number>): string => {
  return i18n.t(key, params)
}
