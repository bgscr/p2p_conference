#!/usr/bin/env node

/**
 * Bundle Analysis Helper
 *
 * Provides quick bundle analysis without full visualization tools.
 * Parses build output to identify large chunks and dependencies.
 *
 * Usage:
 *   node bundle-analyze.js [build-dir]
 *
 * Example:
 *   node bundle-analyze.js ./dist
 *   node bundle-analyze.js ./build
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = process.argv[2] || './dist';

// ANSI colors
const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getColor(sizeKB) {
  if (sizeKB > 500) return colors.red;
  if (sizeKB > 200) return colors.yellow;
  return colors.green;
}

function analyzeDirectory(dir) {
  const results = {
    js: [],
    css: [],
    other: [],
    total: 0,
  };

  function walkDir(currentPath) {
    try {
      const items = fs.readdirSync(currentPath);

      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else {
          const ext = path.extname(item).toLowerCase();
          const size = stat.size;
          const relativePath = path.relative(dir, fullPath);

          results.total += size;

          const entry = {
            name: relativePath,
            size,
            sizeFormatted: formatSize(size),
          };

          if (ext === '.js' || ext === '.mjs') {
            results.js.push(entry);
          } else if (ext === '.css') {
            results.css.push(entry);
          } else {
            results.other.push(entry);
          }
        }
      }
    } catch (err) {
      console.error(`Error reading ${currentPath}:`, err.message);
    }
  }

  walkDir(dir);

  // Sort by size descending
  results.js.sort((a, b) => b.size - a.size);
  results.css.sort((a, b) => b.size - a.size);
  results.other.sort((a, b) => b.size - a.size);

  return results;
}

function printReport(results) {
  console.log(`\n${colors.bold}📦 Bundle Analysis Report${colors.reset}`);
  console.log('='.repeat(60));

  // JavaScript files
  if (results.js.length > 0) {
    console.log(`\n${colors.cyan}JavaScript Files:${colors.reset}`);
    let jsTotal = 0;

    for (const file of results.js) {
      const sizeKB = file.size / 1024;
      const color = getColor(sizeKB);
      console.log(`  ${color}${file.sizeFormatted.padStart(12)}${colors.reset}  ${file.name}`);
      jsTotal += file.size;
    }

    console.log(`  ${colors.bold}${'─'.repeat(12)}${colors.reset}`);
    console.log(`  ${colors.bold}${formatSize(jsTotal).padStart(12)}${colors.reset}  Total JS`);
  }

  // CSS files
  if (results.css.length > 0) {
    console.log(`\n${colors.cyan}CSS Files:${colors.reset}`);
    let cssTotal = 0;

    for (const file of results.css) {
      console.log(`  ${formatSize(file.size).padStart(12)}  ${file.name}`);
      cssTotal += file.size;
    }

    console.log(`  ${colors.bold}${'─'.repeat(12)}${colors.reset}`);
    console.log(`  ${colors.bold}${formatSize(cssTotal).padStart(12)}${colors.reset}  Total CSS`);
  }

  // Summary
  console.log(`\n${colors.bold}Summary:${colors.reset}`);
  console.log(`  Total bundle size: ${formatSize(results.total)}`);
  console.log(`  JS files: ${results.js.length}`);
  console.log(`  CSS files: ${results.css.length}`);
  console.log(`  Other files: ${results.other.length}`);

  // Warnings
  console.log(`\n${colors.bold}Recommendations:${colors.reset}`);

  const largeChunks = results.js.filter((f) => f.size > 200 * 1024);
  if (largeChunks.length > 0) {
    console.log(`  ${colors.yellow}⚠️  ${largeChunks.length} chunk(s) exceed 200KB${colors.reset}`);
    console.log('     Consider code splitting or lazy loading');
  }

  const mainBundle = results.js.find(
    (f) => f.name.includes('main') || f.name.includes('index') || f.name.includes('app')
  );
  if (mainBundle && mainBundle.size > 300 * 1024) {
    console.log(`  ${colors.red}❌ Main bundle exceeds 300KB (${formatSize(mainBundle.size)})${colors.reset}`);
    console.log('     This may impact initial load time significantly');
  }

  const totalJSKB = results.js.reduce((sum, f) => sum + f.size, 0) / 1024;
  if (totalJSKB > 500) {
    console.log(`  ${colors.yellow}⚠️  Total JS exceeds 500KB${colors.reset}`);
    console.log('     Consider removing unused dependencies');
  }

  if (largeChunks.length === 0 && totalJSKB <= 500) {
    console.log(`  ${colors.green}✅ Bundle size looks good!${colors.reset}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('For detailed analysis, use:');
  console.log('  Vite:    npx vite-bundle-visualizer');
  console.log('  Webpack: npx webpack-bundle-analyzer stats.json');
  console.log('');
}

// Main
if (!fs.existsSync(BUILD_DIR)) {
  console.error(`Error: Build directory '${BUILD_DIR}' not found.`);
  console.error('Run your build command first, then run this script.');
  process.exit(1);
}

const results = analyzeDirectory(BUILD_DIR);
printReport(results);
