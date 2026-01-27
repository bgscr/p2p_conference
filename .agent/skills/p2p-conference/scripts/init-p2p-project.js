#!/usr/bin/env node

/**
 * P2P Conference App Initialization Script
 * 
 * This script sets up a complete Electron + React + TypeScript project
 * with the structure needed for a P2P audio conferencing application.
 * 
 * Usage:
 *   node init-p2p-project.js my-conference-app
 *   cd my-conference-app
 *   npm install
 *   npm run dev
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get project name from command line
const projectName = process.argv[2];

if (!projectName) {
  console.error('❌ Error: Please provide a project name');
  console.log('Usage: node init-p2p-project.js <project-name>');
  process.exit(1);
}

const projectPath = path.join(process.cwd(), projectName);

// Check if directory already exists
if (fs.existsSync(projectPath)) {
  console.error(`❌ Error: Directory "${projectName}" already exists`);
  process.exit(1);
}

console.log(`🚀 Creating P2P Conference App: ${projectName}\n`);

// Create project directory
fs.mkdirSync(projectPath, { recursive: true });

// Project structure
const directories = [
  'electron',
  'src/renderer',
  'src/renderer/components',
  'src/renderer/hooks',
  'src/renderer/audio-processor',
  'src/renderer/signaling',
  'src/types',
  'public/audio-processor'
];

console.log('📁 Creating directory structure...');
directories.forEach(dir => {
  fs.mkdirSync(path.join(projectPath, dir), { recursive: true });
  console.log(`   ✓ ${dir}`);
});

// package.json
const packageJson = {
  name: projectName,
  version: "1.0.0",
  description: "Serverless P2P audio conferencing application",
  main: "dist/electron/main.js",
  scripts: {
    dev: "electron-vite dev",
    build: "electron-vite build",
    preview: "electron-vite preview",
    "build:win": "npm run build && electron-builder --win",
    "build:mac": "npm run build && electron-builder --mac",
    "build:linux": "npm run build && electron-builder --linux"
  },
  keywords: ["electron", "webrtc", "p2p", "audio", "conference"],
  author: "",
  license: "MIT",
  devDependencies: {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0",
    "electron-vite": "^2.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  },
  dependencies: {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "trystero": "^0.18.0"
  }
};

console.log('\n📦 Creating package.json...');
fs.writeFileSync(
  path.join(projectPath, 'package.json'),
  JSON.stringify(packageJson, null, 2)
);

// tsconfig.json
const tsconfig = {
  compilerOptions: {
    target: "ES2020",
    lib: ["ES2020", "DOM", "DOM.Iterable"],
    module: "ESNext",
    skipLibCheck: true,
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    jsx: "react-jsx",
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true
  },
  include: ["src/**/*", "electron/**/*"],
  exclude: ["node_modules"]
};

console.log('📝 Creating tsconfig.json...');
fs.writeFileSync(
  path.join(projectPath, 'tsconfig.json'),
  JSON.stringify(tsconfig, null, 2)
);

// electron.vite.config.ts
const electronViteConfig = `import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html')
        }
      }
    },
    plugins: [react()]
  }
})
`;

console.log('⚙️  Creating electron.vite.config.ts...');
fs.writeFileSync(
  path.join(projectPath, 'electron.vite.config.ts'),
  electronViteConfig
);

// electron-builder.yml
const electronBuilder = `appId: com.example.${projectName}
productName: ${projectName}
directories:
  output: release
  buildResources: build

mac:
  category: public.app-category.social-networking
  entitlements: electron/entitlements.mac.plist
  entitlementsInherit: electron/entitlements.mac.plist
  hardenedRuntime: true

win:
  target:
    - nsis

linux:
  target:
    - AppImage
    - deb
  category: Network
`;

console.log('🔧 Creating electron-builder.yml...');
fs.writeFileSync(
  path.join(projectPath, 'electron-builder.yml'),
  electronBuilder
);

// entitlements.mac.plist
const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.device.microphone</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
</dict>
</plist>
`;

console.log('🍎 Creating macOS entitlements...');
fs.writeFileSync(
  path.join(projectPath, 'electron/entitlements.mac.plist'),
  entitlements
);

// index.html
const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
`;

console.log('🌐 Creating index.html...');
fs.writeFileSync(path.join(projectPath, 'index.html'), indexHtml);

// README.md
const readme = `# ${projectName}

Serverless P2P audio conferencing application built with Electron and WebRTC.

## Features

- ✅ Serverless peer-to-peer architecture
- ✅ AI-powered noise suppression (RNNoise)
- ✅ Cross-platform (Windows, macOS, Linux)
- ✅ Full mesh topology for low latency
- ✅ Device selection (microphone & speaker)

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Build platform-specific packages
npm run build:win   # Windows
npm run build:mac   # macOS
npm run build:linux # Linux
\`\`\`

## Architecture

- **Frontend**: React + TypeScript
- **Runtime**: Electron
- **Signaling**: Trystero (BitTorrent DHT)
- **Audio Processing**: RNNoise (WebAssembly)
- **Network**: WebRTC Full Mesh

## Development

The project structure:

\`\`\`
${projectName}/
├── electron/              # Main process
│   ├── main.ts
│   └── preload.ts
├── src/
│   ├── renderer/          # Renderer process (React)
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── audio-processor/
│   │   └── signaling/
│   └── types/
└── public/
    └── audio-processor/   # WASM modules
\`\`\`

## Next Steps

1. Download RNNoise WASM:
   - Visit https://github.com/jitsi/rnnoise-wasm
   - Copy \`rnnoise.wasm\` to \`public/audio-processor/\`

2. Implement components in \`src/renderer/components/\`

3. Configure audio pipeline in \`src/renderer/audio-processor/\`

4. Set up signaling in \`src/renderer/signaling/\`

## License

MIT
`;

console.log('📄 Creating README.md...');
fs.writeFileSync(path.join(projectPath, 'README.md'), readme);

// .gitignore
const gitignore = `node_modules/
dist/
release/
*.log
.DS_Store
.env
`;

console.log('🚫 Creating .gitignore...');
fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore);

console.log('\n✨ Project structure created successfully!\n');
console.log('📥 Installing dependencies (this may take a few minutes)...\n');

// Install dependencies
try {
  execSync('npm install', { cwd: projectPath, stdio: 'inherit' });
  
  console.log('\n✅ Installation complete!\n');
  console.log('🎉 Your P2P Conference App is ready!\n');
  console.log('Next steps:');
  console.log(`   1. cd ${projectName}`);
  console.log('   2. Download RNNoise WASM to public/audio-processor/');
  console.log('   3. npm run dev');
  console.log('\nFor detailed implementation guidance, refer to the p2p-conference skill documentation.\n');
  
} catch (error) {
  console.error('\n❌ Installation failed:', error.message);
  console.log('\nYou can try installing manually:');
  console.log(`   cd ${projectName}`);
  console.log('   npm install\n');
  process.exit(1);
}
