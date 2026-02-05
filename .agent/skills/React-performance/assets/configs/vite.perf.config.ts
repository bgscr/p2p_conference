import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viteCompression from 'vite-plugin-compression';

/**
 * Vite Performance Configuration
 *
 * This config applies production-ready performance optimizations.
 * Merge these settings into your existing vite.config.ts.
 *
 * Required dependencies:
 * - vite-plugin-compression (for gzip/brotli)
 *
 * Optional dependencies:
 * - vite-bundle-visualizer (for bundle analysis)
 * - @vitejs/plugin-legacy (for legacy browser support)
 */

export default defineConfig({
  plugins: [
    react(),

    // Gzip compression
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024, // Only compress files > 1kb
    }),

    // Brotli compression (better compression ratio)
    viteCompression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 1024,
    }),
  ],

  build: {
    // Target modern browsers for smaller bundles
    target: 'es2020',

    // Enable minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.* in production
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info'],
      },
    },

    // Generate source maps for error tracking (optional)
    sourcemap: false,

    // Chunk size warnings
    chunkSizeWarningLimit: 500, // Warn if chunks > 500kb

    rollupOptions: {
      output: {
        // Manual chunk splitting for optimal caching
        manualChunks: {
          // React core - rarely changes
          'react-vendor': ['react', 'react-dom'],

          // Router - changes less frequently than app code
          'router': ['react-router-dom'],

          // Add other vendor chunks as needed:
          // 'ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          // 'charts': ['recharts', 'd3'],
          // 'forms': ['react-hook-form', 'zod'],
        },

        // Consistent chunk naming for caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },

    // CSS code splitting
    cssCodeSplit: true,

    // Inline assets smaller than 4kb
    assetsInlineLimit: 4096,
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      // Add frequently used dependencies for faster dev startup
    ],
    exclude: [
      // Exclude dependencies that cause issues with pre-bundling
    ],
  },

  // Server optimizations for development
  server: {
    // Enable HMR
    hmr: true,

    // Warm up frequently used files
    warmup: {
      clientFiles: ['./src/main.tsx', './src/App.tsx'],
    },
  },

  // Preview server (for testing production builds locally)
  preview: {
    // Enable compression
    headers: {
      'Cache-Control': 'public, max-age=31536000',
    },
  },
});

/**
 * To analyze your bundle, run:
 * npx vite-bundle-visualizer
 *
 * Or add to package.json scripts:
 * "analyze": "vite-bundle-visualizer"
 */
