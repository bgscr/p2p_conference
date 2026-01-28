import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, existsSync, mkdirSync } from 'fs'

// Plugin to copy app icons to main process output for development
function copyAppIconsPlugin() {
  return {
    name: 'copy-app-icons',
    closeBundle() {
      const srcDir = resolve(__dirname, 'build/icons')
      const destDir = resolve(__dirname, 'out/main/icons')
      
      // Create destination directory if it doesn't exist
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
      }
      
      // Copy icon files
      const icons = ['icon.png', 'icon.ico']
      icons.forEach(icon => {
        const srcPath = resolve(srcDir, icon)
        const destPath = resolve(destDir, icon)
        if (existsSync(srcPath)) {
          copyFileSync(srcPath, destPath)
          console.log(`Copied ${icon} to out/main/icons/`)
        }
      })
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        }
      }
    },
    plugins: [copyAppIconsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      },
      target: 'esnext',
      minify: false,
      sourcemap: true
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@types': resolve(__dirname, 'src/types')
      }
    }
  }
})
