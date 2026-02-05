/**
 * Webpack Performance Configuration
 *
 * This config applies production-ready performance optimizations.
 * Merge these settings into your existing webpack.config.js.
 *
 * Required dependencies:
 * - compression-webpack-plugin (for gzip/brotli)
 * - terser-webpack-plugin (usually included with webpack 5)
 * - css-minimizer-webpack-plugin
 *
 * Optional dependencies:
 * - webpack-bundle-analyzer (for bundle analysis)
 */

const path = require('path');
const CompressionPlugin = require('compression-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = {
  mode: 'production',

  // Modern target for smaller bundles
  target: ['web', 'es2020'],

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash].js',
    chunkFilename: '[name].[contenthash].js',
    assetModuleFilename: 'assets/[name].[contenthash][ext]',
    clean: true,
  },

  optimization: {
    minimize: true,

    minimizer: [
      // JavaScript minification
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
            drop_debugger: true,
            pure_funcs: ['console.log', 'console.info'],
          },
          mangle: true,
          output: {
            comments: false,
          },
        },
        extractComments: false,
      }),

      // CSS minification
      new CssMinimizerPlugin(),
    ],

    // Code splitting configuration
    splitChunks: {
      chunks: 'all',
      maxInitialRequests: 25,
      maxAsyncRequests: 25,
      minSize: 20000,

      cacheGroups: {
        // React core bundle
        react: {
          test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
          name: 'react',
          chunks: 'all',
          priority: 40,
        },

        // Router bundle
        router: {
          test: /[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/,
          name: 'router',
          chunks: 'all',
          priority: 30,
        },

        // All other vendor code
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          priority: 20,
        },

        // Common code used across multiple chunks
        common: {
          minChunks: 2,
          priority: 10,
          reuseExistingChunk: true,
        },
      },
    },

    // Keep runtime chunk separate for better caching
    runtimeChunk: 'single',

    // Use deterministic IDs for better caching
    moduleIds: 'deterministic',
    chunkIds: 'deterministic',
  },

  plugins: [
    // Gzip compression
    new CompressionPlugin({
      algorithm: 'gzip',
      test: /\.(js|css|html|svg)$/,
      threshold: 1024,
      minRatio: 0.8,
    }),

    // Brotli compression (better ratio than gzip)
    new CompressionPlugin({
      algorithm: 'brotliCompress',
      test: /\.(js|css|html|svg)$/,
      threshold: 1024,
      minRatio: 0.8,
      filename: '[path][base].br',
    }),

    // Uncomment to analyze bundle
    // new BundleAnalyzerPlugin({
    //   analyzerMode: 'static',
    //   reportFilename: 'bundle-report.html',
    //   openAnalyzer: false,
    // }),
  ],

  // Performance hints
  performance: {
    hints: 'warning',
    maxEntrypointSize: 250000, // 250kb
    maxAssetSize: 250000,
  },

  // Resolve configuration
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],

    // Aliases for cleaner imports
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  // Module rules
  module: {
    rules: [
      // TypeScript/JavaScript
      {
        test: /\.(ts|tsx|js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: 'defaults, not ie 11' }],
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-typescript',
            ],
          },
        },
      },

      // CSS
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },

      // Images - inline small images
      {
        test: /\.(png|jpg|jpeg|gif|webp)$/,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: 4 * 1024, // 4kb
          },
        },
      },

      // SVG - inline as React components
      {
        test: /\.svg$/,
        use: ['@svgr/webpack'],
      },
    ],
  },
};

/**
 * To analyze your bundle, run:
 * npx webpack-bundle-analyzer dist/stats.json
 *
 * First generate stats: webpack --profile --json > dist/stats.json
 */
