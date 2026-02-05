---
name: react-performance
description: |
  Expert guidance for high-performance React apps with reusable assets. Use when: creating/optimizing 
  components, performance patterns (memoization, code splitting, lazy loading), debugging re-renders or 
  bundle size, working with Next.js App Router/RSC/Remix/Vite, virtual lists, Zustand state management, 
  or integrating React Router v6, Axios/fetch, Tailwind CSS, shadcn/ui. Triggers: React, component, 
  useState, useEffect, memo, useMemo, useCallback, re-render, bundle size, lazy load, virtual list, 
  Next.js, App Router, RSC, Zustand, React Router, Tailwind, shadcn, fetch, Axios.
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
| Zustand | Slices, computed state, persistence, TypeScript | `references/zustand.md` |
| Server Components | RSC patterns, Next.js App Router, streaming | `references/server-components.md` |
| Integrations | Router, data fetching, styling, UI libraries | `references/integrations.md` |

## Core Principles

1. **Measure first** - Use React DevTools Profiler before optimizing
2. **Optimize bottlenecks** - Focus on actual problems, not premature optimization
3. **Minimize re-renders** - Prevent unnecessary component updates
4. **Reduce bundle size** - Ship less JavaScript to users
5. **Defer non-critical work** - Load and execute only what's needed
6. **Server-first** - Prefer Server Components for static/data-fetching code

## Workflow

### For New Components

1. Start with `assets/components/OptimizedComponent.tsx` template
2. Apply rendering patterns from `references/rendering.md`
3. Use hooks from `assets/hooks/` for common performance patterns

### For State Management

1. Review `references/zustand.md` for Zustand patterns
2. Use slice pattern from `assets/stores/` for feature modules
3. Apply computed/derived state for expensive calculations

### For Next.js App Router

1. Consult `references/server-components.md` for RSC patterns
2. Default to Server Components, add `'use client'` only when needed
3. Use streaming and Suspense for progressive loading

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
- `useOptimisticUpdate.ts` - Optimistic UI updates with rollback

### Stores (`assets/stores/`)

- `createSlice.ts` - Zustand slice factory with TypeScript
- `storeWithComputed.ts` - Derived/computed state pattern
- `persistedStore.ts` - Hydration and persistence patterns

### Components (`assets/components/`)

- `OptimizedComponent.tsx` - Base template with performance best practices
- `VirtualList.tsx` - Windowed list for large datasets
- `LazyImage.tsx` - Intersection observer image loading
- `StreamingBoundary.tsx` - RSC streaming with fallback

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

// ❌ Using 'use client' unnecessarily in Next.js
// Only add when component uses hooks, event handlers, or browser APIs
```
