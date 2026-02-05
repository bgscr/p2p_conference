# Bundle Size Optimization

## Code Splitting with React.lazy

```tsx
import { lazy, Suspense } from 'react';

// Split at route level
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));

// Split heavy components
const ChartLibrary = lazy(() => import('./components/Chart'));
const MarkdownEditor = lazy(() => import('./components/MarkdownEditor'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
```

## Named Exports with Lazy

```tsx
// For named exports, create intermediate module or use this pattern
const Modal = lazy(() => 
  import('./components').then(module => ({ default: module.Modal }))
);
```

## Conditional Loading

```tsx
function FeatureComponent({ showAdvanced }: Props) {
  const [AdvancedPanel, setAdvancedPanel] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (showAdvanced && !AdvancedPanel) {
      import('./AdvancedPanel').then(mod => setAdvancedPanel(() => mod.default));
    }
  }, [showAdvanced]);

  return (
    <div>
      <BasicContent />
      {AdvancedPanel && <AdvancedPanel />}
    </div>
  );
}
```

## Tree Shaking Best Practices

```tsx
// ✅ Named imports enable tree shaking
import { map, filter } from 'lodash-es';

// ❌ Default import bundles entire library
import _ from 'lodash';

// ✅ Specific deep imports
import debounce from 'lodash/debounce';
```

## Dynamic Imports for Heavy Libraries

```tsx
async function generatePDF() {
  // Load only when needed
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  // ...
}

async function formatDate(date: Date) {
  const { format } = await import('date-fns');
  return format(date, 'yyyy-MM-dd');
}
```

## Bundle Analysis

```bash
# Vite
npx vite-bundle-visualizer

# Webpack
npx webpack-bundle-analyzer stats.json

# Next.js
ANALYZE=true npm run build
```

## Webpack Manual Chunks

```js
// webpack.config.js
optimization: {
  splitChunks: {
    chunks: 'all',
    cacheGroups: {
      vendor: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendors',
        chunks: 'all',
      },
      react: {
        test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
        name: 'react',
        chunks: 'all',
        priority: 10,
      },
    },
  },
},
```

## Vite Manual Chunks

```ts
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
        },
      },
    },
  },
});
```

## Import Cost Awareness

| Library | Full Import | Optimized |
|---------|-------------|-----------|
| lodash | ~70kb | ~2kb (per function) |
| moment | ~290kb | date-fns: ~13kb |
| Material UI | ~300kb+ | ~20kb (per component) |

## Compression

```ts
// vite.config.ts
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    viteCompression({ algorithm: 'gzip' }),
    viteCompression({ algorithm: 'brotliCompress', ext: '.br' }),
  ],
});
```

## External Dependencies (CDN)

```ts
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
});
```
