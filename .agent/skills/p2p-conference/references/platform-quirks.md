# Platform-Specific Configuration & Quirks

Comprehensive guide to handling OS-specific behaviors in Electron-based audio applications.

## macOS

### Microphone Permissions

macOS has strict permission requirements for accessing hardware.

#### Entitlements Configuration

**Create entitlements file:**

```xml
<!-- /electron/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" 
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Microphone access -->
  <key>com.apple.security.device.audio-input</key>
  <true/>
  
  <!-- Microphone permission (duplicate for compatibility) -->
  <key>com.apple.security.device.microphone</key>
  <true/>
  
  <!-- Network access (WebRTC) -->
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
  
  <!-- Allow JIT for WASM performance (optional) -->
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  
  <!-- Disable library validation for plugins (if needed) -->
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

**Apply in build configuration:**

```javascript
// electron.vite.config.ts or electron-builder.yml
module.exports = {
  // ...
  build: {
    appId: 'com.yourcompany.yourapp',
    mac: {
      category: 'public.app-category.social-networking',
      entitlements: './electron/entitlements.mac.plist',
      entitlementsInherit: './electron/entitlements.mac.plist',
      hardenedRuntime: true,
      gatekeeperAssess: false
    }
  }
}
```

#### Runtime Permission Request

**In main process:**

```typescript
// electron/main.ts
import { app, systemPreferences, dialog } from 'electron'

app.whenReady().then(async () => {
  // Check microphone permission status
  const microphoneStatus = systemPreferences.getMediaAccessStatus('microphone')
  
  if (microphoneStatus === 'not-determined') {
    // Request permission (triggers system dialog)
    const granted = await systemPreferences.askForMediaAccess('microphone')
    
    if (!granted) {
      // Permission denied - show instructions
      dialog.showErrorBox(
        'Microphone Access Required',
        'Please enable microphone access in System Preferences > Security & Privacy > Privacy > Microphone'
      )
      app.quit()
      return
    }
  } else if (microphoneStatus === 'denied') {
    // Previously denied - user must manually enable
    dialog.showErrorBox(
      'Microphone Access Denied',
      'Please enable microphone access in System Preferences > Security & Privacy > Privacy > Microphone, then restart the app.'
    )
    app.quit()
    return
  }
  
  // Permission granted - proceed
  createWindow()
})
```

**Open System Preferences programmatically:**

```typescript
import { shell } from 'electron'

function openPrivacySettings() {
  // Open Privacy settings
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
}
```

### Audio Device Quirks

**Built-in vs External Devices:**

```typescript
// macOS tends to switch to built-in mic when external device disconnects
navigator.mediaDevices.addEventListener('devicechange', async () => {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const currentDevice = getCurrentDeviceId()
  
  // Check if current device still exists
  const deviceExists = devices.some(d => d.deviceId === currentDevice)
  
  if (!deviceExists) {
    console.warn('Current device disconnected, switching to default')
    await switchToDefaultDevice()
  }
})
```

**AirPods/Bluetooth Latency:**

Bluetooth devices on macOS can have 100-200ms additional latency:

```typescript
// Detect Bluetooth device
const isBluetoothDevice = (device: MediaDeviceInfo) => {
  return device.label.toLowerCase().includes('airpods') ||
         device.label.toLowerCase().includes('bluetooth')
}

// Warn user
if (isBluetoothDevice(selectedDevice)) {
  showNotification({
    type: 'info',
    message: 'Bluetooth devices may have increased latency (100-200ms)'
  })
}
```

### Notarization (For Distribution)

If distributing outside Mac App Store:

```bash
# Sign the app
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name" \
  --options runtime \
  --entitlements entitlements.plist \
  YourApp.app

# Notarize
xcrun notarytool submit YourApp.app.zip \
  --apple-id your@email.com \
  --team-id TEAMID \
  --wait

# Staple notarization ticket
xcrun stapler staple YourApp.app
```

## Windows

### Firewall Configuration

WebRTC uses UDP which may be blocked by Windows Firewall.

#### Detect Firewall Blocking

```typescript
// In renderer process
const peerConnection = new RTCPeerConnection(config)

let connectionTimeout: NodeJS.Timeout

peerConnection.oniceconnectionstatechange = () => {
  if (peerConnection.iceConnectionState === 'checking') {
    // Start timeout
    connectionTimeout = setTimeout(() => {
      if (peerConnection.iceConnectionState === 'checking') {
        // Still checking after 15 seconds - likely firewall
        showFirewallWarning()
      }
    }, 15000)
  } else if (peerConnection.iceConnectionState === 'connected') {
    clearTimeout(connectionTimeout)
  } else if (peerConnection.iceConnectionState === 'failed') {
    showFirewallWarning()
  }
}

function showFirewallWarning() {
  dialog.showMessageBox({
    type: 'warning',
    title: 'Connection Failed',
    message: 'Unable to establish connection. Your firewall may be blocking the application.',
    detail: 'Please allow this app through Windows Firewall or try a different network.',
    buttons: ['Open Firewall Settings', 'OK']
  }).then(result => {
    if (result.response === 0) {
      shell.openExternal('ms-settings:network-firewall')
    }
  })
}
```

#### Installer Firewall Rules

**Add firewall rule during installation (NSIS):**

```nsh
; installer.nsh
!macro customInstall
  ; Add inbound rule for UDP
  DetailPrint "Adding firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${PRODUCT_NAME}" dir=in action=allow protocol=UDP program="$INSTDIR\${PRODUCT_NAME}.exe" enable=yes profile=any'
  
  ; Add outbound rule
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${PRODUCT_NAME}" dir=out action=allow protocol=UDP program="$INSTDIR\${PRODUCT_NAME}.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  ; Remove firewall rules
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${PRODUCT_NAME}"'
!macroend
```

**electron-builder configuration:**

```yaml
# electron-builder.yml
win:
  target:
    - nsis
  
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: true
  createDesktopShortcut: true
  include: installer-script.nsh
```

#### Windows Audio Session API

Windows uses WASAPI (Windows Audio Session API):

```typescript
// Check if running on Windows
const isWindows = process.platform === 'win32'

if (isWindows) {
  // Windows-specific: prefer exclusive mode for lowest latency
  const constraints = {
    audio: {
      echoCancellation: true,
      autoGainControl: true,
      latency: 0.01, // Request 10ms latency
      
      // Windows-specific (Chromium-based)
      advanced: [{
        // Request exclusive mode
        googAutoGainControl2: true,
        googNoiseSuppression2: false
      }]
    }
  }
  
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
}
```

### Windows Defender SmartScreen

First-time users may see SmartScreen warning:

**Solution:**
1. Code-sign your executable with EV certificate
2. Build reputation over time (downloads + time)
3. Provide clear documentation about SmartScreen

```typescript
// Show first-run instructions
if (isFirstRun && process.platform === 'win32') {
  dialog.showMessageBox({
    type: 'info',
    title: 'Windows SmartScreen',
    message: 'If you see a SmartScreen warning, click "More info" then "Run anyway".',
    detail: 'This warning appears for new applications and will disappear as our software builds reputation.'
  })
}
```

## Linux

### Audio Backend Diversity

Linux has multiple audio systems: ALSA, PulseAudio, PipeWire, JACK.

#### Detecting Audio Backend

```typescript
// In main process
import { exec } from 'child_process'

function detectAudioBackend(): Promise<string> {
  return new Promise((resolve) => {
    // Check for PipeWire
    exec('pactl info | grep "Server Name"', (error, stdout) => {
      if (stdout.includes('PulseAudio') && stdout.includes('PipeWire')) {
        resolve('pipewire')
      } else if (stdout.includes('PulseAudio')) {
        resolve('pulseaudio')
      } else {
        resolve('alsa')
      }
    })
  })
}

// Usage
const backend = await detectAudioBackend()
console.log(`Audio backend: ${backend}`)

if (backend === 'alsa') {
  console.warn('ALSA detected - audio device switching may not work reliably')
}
```

#### PulseAudio Configuration

**Enable echo cancellation module:**

```bash
# Load echo cancellation module
pactl load-module module-echo-cancel \
  aec_method=webrtc \
  source_name=echo_cancelled \
  sink_name=echo_cancelled
```

**Programmatically:**

```typescript
import { exec } from 'child_process'

// Check if module is loaded
exec('pactl list modules short | grep echo-cancel', (error, stdout) => {
  if (!stdout) {
    // Load module
    exec('pactl load-module module-echo-cancel aec_method=webrtc')
  }
})
```

#### PipeWire Considerations

PipeWire is the modern replacement for PulseAudio:

```typescript
// PipeWire generally works better with Chromium
const isPipeWire = await detectAudioBackend() === 'pipewire'

if (isPipeWire) {
  console.log('PipeWire detected - optimal configuration')
} else {
  console.log('Using PulseAudio - echo cancellation may need configuration')
}
```

### Distribution Package Formats

#### AppImage (Recommended)

**Pros:**
- No installation required
- Works on all distros
- Minimal sandboxing (direct hardware access)

**Build:**

```yaml
# electron-builder.yml
linux:
  target:
    - AppImage
  category: Network
  
appImage:
  license: LICENSE
  category: Network
```

**Ensure audio access:**

AppImage has direct access to audio devices (no special config needed).

#### Snap (Not Recommended for Audio)

Snap's strict confinement causes audio issues:

```yaml
# If you must use Snap
snap:
  confinement: classic  # Use classic, not strict
  plugs:
    - pulseaudio
    - audio-playback
    - audio-record
    - network
    - network-bind
```

**Still problematic:** Even with plugs, device enumeration may fail.

#### Flatpak

**Manifest permissions:**

```yaml
# flatpak manifest
finish-args:
  - --socket=pulseaudio
  - --device=all  # For audio devices
  - --share=network
  - --socket=wayland
  - --socket=fallback-x11
```

**Test thoroughly:** Device switching may not work in all cases.

#### DEB/RPM (Best Compatibility)

**Build both:**

```yaml
linux:
  target:
    - deb
    - rpm
  category: Network
```

**Dependencies:**

```yaml
deb:
  depends:
    - gconf2
    - gconf-service
    - libpulse0
    
rpm:
  depends:
    - pulseaudio-libs
```

### Desktop Entry

**Create .desktop file:**

```ini
[Desktop Entry]
Name=My Conference App
Comment=Serverless P2P Audio Conferencing
Exec=/usr/bin/my-conference-app
Icon=my-conference-app
Type=Application
Categories=Network;AudioVideo;
Terminal=false
StartupNotify=true
X-GNOME-UsesNotifications=true
```

### Wayland vs X11

```typescript
// Detect display server
const isWayland = process.env.XDG_SESSION_TYPE === 'wayland'
const isX11 = process.env.XDG_SESSION_TYPE === 'x11'

if (isWayland) {
  console.log('Wayland detected')
  // Wayland generally works fine with audio
} else if (isX11) {
  console.log('X11 detected')
}
```

## Cross-Platform Testing Checklist

### macOS
- [ ] Microphone permission prompt appears
- [ ] Permission denial is handled gracefully
- [ ] Built-in and USB microphones work
- [ ] AirPods/Bluetooth devices work (with latency warning)
- [ ] App runs on macOS 11+ (Big Sur and later)
- [ ] Notarization successful (for distribution)

### Windows
- [ ] Firewall prompt appears (or rules are added)
- [ ] UDP connections work through firewall
- [ ] Built-in and USB microphones work
- [ ] Bluetooth devices work
- [ ] App runs on Windows 10/11
- [ ] SmartScreen warning is dismissible
- [ ] Code-signed for better trust

### Linux
- [ ] Works on Ubuntu 20.04+ LTS
- [ ] Works on Fedora latest
- [ ] Works on Debian Stable
- [ ] PulseAudio configuration correct
- [ ] PipeWire configuration correct
- [ ] AppImage runs without installation
- [ ] Device enumeration works
- [ ] Device switching works

## Common Platform Issues

### Issue: Permission Denied on macOS

**Symptom:** `NotAllowedError` when accessing microphone

**Solution:**
1. Check entitlements.plist exists and is applied
2. Verify permission prompt appeared
3. If denied, guide user to System Preferences
4. After granting permission, restart app

### Issue: No Audio on Windows

**Symptom:** Microphone works in browser but not in Electron app

**Solution:**
```typescript
// Ensure Electron is using correct audio API
app.commandLine.appendSwitch('enable-features', 'WebRtcUseEchoCanceller3')
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')
```

### Issue: Device Switching Fails on Linux

**Symptom:** setSinkId throws error on Linux

**Solution:**
```typescript
// Check if setSinkId is supported
if ('setSinkId' in HTMLAudioElement.prototype) {
  await audioElement.setSinkId(deviceId)
} else {
  console.warn('setSinkId not supported on this platform')
  // Fallback: use default device only
}
```

### Issue: Sandboxed Environment (Snap/Flatpak)

**Symptom:** Audio doesn't work in sandboxed packages

**Solution:**
1. Use AppImage or native packages (DEB/RPM) instead
2. If must use Snap, use `classic` confinement
3. For Flatpak, ensure all audio permissions are granted

## Performance Considerations

### macOS
- Metal GPU acceleration available
- Efficient power management
- Good WASM performance

### Windows
- DirectX GPU acceleration
- WASM performance excellent
- Higher memory usage than macOS

### Linux
- GPU acceleration varies by driver
- Lower memory usage overall
- WASM performance good on modern systems

## Distribution Recommendations

| Platform | Recommended Format | Alternative |
|----------|-------------------|-------------|
| macOS | DMG (notarized) | PKG installer |
| Windows | NSIS installer (signed) | MSI |
| Linux | AppImage | DEB + RPM |

## Security Best Practices

### Sandboxing

```typescript
// electron/main.ts
import { app } from 'electron'

// Enable sandbox
app.enableSandbox()

// Create window with security settings
const mainWindow = new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: path.join(__dirname, 'preload.js')
  }
})
```

### Context Bridge

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Expose only specific APIs
  requestMicrophonePermission: () => ipcRenderer.invoke('request-microphone'),
  openPrivacySettings: () => ipcRenderer.invoke('open-privacy-settings')
})
```

## Platform-Specific UI Considerations

### macOS
- Use system fonts: `-apple-system, BlinkMacSystemFont`
- Traffic light window controls (native)
- Translucent title bar option

### Windows
- Use system fonts: `Segoe UI`
- Custom window controls (optional)
- Acrylic/fluent design elements

### Linux
- Use system fonts: `Ubuntu, Cantarell, sans-serif`
- GTK theme integration (if desired)
- Support both light and dark themes
