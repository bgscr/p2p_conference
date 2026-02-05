---
name: react-performance
description: |
  Expert guidance for building high-performance React applications with reusable code assets. 
  Use this skill when: (1) Creating or optimizing React components, (2) Discussing React performance 
  patterns like memoization, code splitting, or lazy loading, (3) Debugging re-render issues or 
  bundle size problems, (4) Building with React-related terms (hooks, state, context, props), 
  (5) Working with React frameworks (Next.js, Remix, Vite, CRA), (6) Implementing virtual lists, 
  intersection observers, or runtime optimizations, (7) Configuring bundlers or linters for React projects.
  Triggers: "React", "component", "useState", "useEffect", "memo", "useMemo", "useCallback", 
  "re-render", "bundle size", "lazy load", "code split", "virtual list", "Next.js", "Remix", "Vite".
---

# React Performance Skill

Build high-performance React applications with proven patterns and reusable assets.

## Quick Reference

| Performance Area | Key Techniques | Reference File |
|-----------------|----------------|----------------|
| Rendering | memo, useMemo, useCallback, keys | `references/rendering.md` |
| Bundle Size | Code splitting, lazy loading, tree shaking | `references/bundle.md` |
| Runtime | Virtual lists, debounce, intersection observer | `references/runtime.md` |
| State | Colocation, selectors, normalized state | `references/state.md` |

## Core Principles

1. **Measure first** - Use React DevTools Profiler before optimizing
2. **Optimize bottlenecks** - Focus on actual problems, not premature optimization
3. **Minimize re-renders** - Prevent unnecessary component updates
4. **Reduce bundle size** - Ship less JavaScript to users
5. **Defer non-critical work** - Load and execute only what's needed

## Workflow

### For New Components

1. Start with `assets/components/OptimizedComponent.tsx` template
2. Apply rendering patterns from `references/rendering.md`
3. Use hooks from `assets/hooks/` for common performance patterns

### For Optimization Tasks

1. Run `scripts/perf-audit.sh` to identify issues
2. Consult relevant reference file based on issue type
3. Apply appropriate patterns and hooks

### For Bundle Analysis

1. Use `scripts/bundle-analyze.js` configuration
2. Review `references/bundle.md` for reduction strategies
3. Apply code splitting with lazy loading patterns

## Reusable Assets

### Hooks (`assets/hooks/`)

- `useDebounce.ts` - Debounce rapidly changing values
- `useThrottle.ts` - Throttle frequent updates
- `useIntersectionObserver.ts` - Lazy load on visibility
- `useVirtualList.ts` - Efficiently render large lists
- `usePrevious.ts` - Track previous values for comparison
- `useStableCallback.ts` - Stable function references

### Components (`assets/components/`)

- `OptimizedComponent.tsx` - Base template with performance best practices
- `VirtualList.tsx` - Windowed list for large datasets
- `LazyImage.tsx` - Intersection observer image loading

### Configs (`assets/configs/`)

- `eslint-perf.json` - ESLint rules catching performance issues
- `vite.perf.config.ts` - Vite optimizations
- `webpack.perf.config.js` - Webpack optimizations

## Anti-Patterns to Avoid

```tsx
// ❌ Inline objects/arrays create new references every render
<Child style={{ color: 'red' }} items={[1, 2, 3]} />

// ❌ Inline functions create new references every render
<Child onClick={() => handleClick(id)} />

// ❌ Spreading props prevents memoization benefits
<Child {...props} />

// ❌ Index as key causes issues with list reordering
{items.map((item, index) => <Item key={index} />)}
```

## Framework-Specific Notes

### Next.js
- Use `next/dynamic` for code splitting
- Leverage `next/image` for automatic image optimization
- Use React Server Components for reduced client bundle

### Remix
- Loaders run server-side, reducing client JS
- Use `useFetcher` for non-navigation data loading
- Leverage nested routes for code splitting

### Vite
- Automatic code splitting on dynamic imports
- Use `vite-plugin-compression` for gzip/brotli
- Configure `manualChunks` for vendor splitting
