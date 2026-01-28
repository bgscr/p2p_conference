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

// Determine if we're in production build
const isProduction = process.env.NODE_ENV === 'production'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        }
      },
      // Enable minification for main process in production
      minify: isProduction ? 'terser' : false,
      terserOptions: isProduction ? {
        compress: {
          drop_console: false,  // Keep console for debugging if needed
          drop_debugger: true,
          passes: 2
        },
        mangle: {
          // Mangle property names for better obfuscation
          properties: {
            regex: /^_/  // Only mangle private properties starting with _
          }
        },
        format: {
          comments: false  // Remove all comments
        }
      } : undefined
    },
    plugins: [copyAppIconsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      },
      // Enable minification for preload in production
      minify: isProduction ? 'terser' : false,
      terserOptions: isProduction ? {
        compress: {
          drop_console: false,
          drop_debugger: true,
          passes: 2
        },
        mangle: true,
        format: {
          comments: false
        }
      } : undefined
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'public'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      },
      target: 'esnext',
      // Enable minification and obfuscation for renderer in production
      minify: isProduction ? 'terser' : false,
      terserOptions: isProduction ? {
        compress: {
          drop_console: false,  // Keep console for user-facing errors
          drop_debugger: true,
          passes: 3,  // More passes for better compression
          pure_funcs: ['console.debug'],  // Remove debug logs in production
          dead_code: true,
          unused: true
        },
        mangle: {
          // Aggressive mangling for renderer code
          toplevel: true,
          properties: {
            regex: /^_/  // Mangle private properties
          }
        },
        format: {
          comments: false
        }
      } : undefined,
      sourcemap: !isProduction  // Disable sourcemaps in production
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
