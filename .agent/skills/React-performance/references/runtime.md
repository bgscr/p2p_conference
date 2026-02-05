# Runtime Performance

## Virtual Lists

For lists with 100+ items, virtualize to render only visible items:

```tsx
// See assets/components/VirtualList.tsx for complete implementation
// Or use libraries: react-window, @tanstack/react-virtual

import { useVirtualList } from '../hooks/useVirtualList';

function LargeList({ items }: { items: Item[] }) {
  const { containerRef, virtualItems, totalHeight } = useVirtualList({
    items,
    itemHeight: 50,
    overscan: 5,
  });

  return (
    <div ref={containerRef} style={{ height: 400, overflow: 'auto' }}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        {virtualItems.map(({ item, index, offsetTop }) => (
          <div
            key={item.id}
            style={{ position: 'absolute', top: offsetTop, height: 50 }}
          >
            {item.name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Debouncing

Delay expensive operations until input settles:

```tsx
import { useDebounce } from '../hooks/useDebounce';

function SearchInput() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery) {
      searchAPI(debouncedQuery);
    }
  }, [debouncedQuery]);

  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}
```

## Throttling

Limit execution frequency for continuous events:

```tsx
import { useThrottle } from '../hooks/useThrottle';

function ScrollTracker() {
  const [scrollY, setScrollY] = useState(0);
  const throttledScrollY = useThrottle(scrollY, 100);

  useEffect(() => {
    const handler = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  // Analytics only fires at most every 100ms
  useEffect(() => {
    trackScrollDepth(throttledScrollY);
  }, [throttledScrollY]);
}
```

## Intersection Observer (Lazy Loading)

```tsx
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';

function LazyComponent({ children }: PropsWithChildren) {
  const { ref, isIntersecting, hasIntersected } = useIntersectionObserver({
    threshold: 0.1,
    rootMargin: '100px',
  });

  return (
    <div ref={ref}>
      {hasIntersected ? children : <Placeholder />}
    </div>
  );
}
```

## Passive Event Listeners

```tsx
useEffect(() => {
  const handler = (e: WheelEvent) => {
    // Handle scroll
  };

  // ✅ Passive listeners improve scroll performance
  window.addEventListener('wheel', handler, { passive: true });
  window.addEventListener('touchstart', handler, { passive: true });

  return () => {
    window.removeEventListener('wheel', handler);
    window.removeEventListener('touchstart', handler);
  };
}, []);
```

## requestAnimationFrame for Animations

```tsx
function AnimatedComponent() {
  const [position, setPosition] = useState(0);
  const rafRef = useRef<number>();

  const animate = useCallback(() => {
    setPosition(prev => (prev + 1) % 360);
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [animate]);

  return <div style={{ transform: `rotate(${position}deg)` }} />;
}
```

## Web Workers for Heavy Computation

```tsx
// worker.ts
self.onmessage = (e: MessageEvent<number[]>) => {
  const result = e.data.reduce((sum, n) => sum + n, 0);
  self.postMessage(result);
};

// Component
function HeavyComputation({ data }: { data: number[] }) {
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url));
    worker.onmessage = (e) => setResult(e.data);
    worker.postMessage(data);
    return () => worker.terminate();
  }, [data]);

  return <div>{result ?? 'Computing...'}</div>;
}
```

## Concurrent Features (React 18+)

```tsx
import { useTransition, useDeferredValue } from 'react';

function SearchResults({ query }: { query: string }) {
  // Defer expensive renders
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <div style={{ opacity: isStale ? 0.7 : 1 }}>
      <ExpensiveList filter={deferredQuery} />
    </div>
  );
}

function TabContainer() {
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState('home');

  const selectTab = (nextTab: string) => {
    startTransition(() => {
      setTab(nextTab);
    });
  };

  return (
    <>
      <TabButtons onSelect={selectTab} />
      {isPending && <Spinner />}
      <TabContent tab={tab} />
    </>
  );
}
```

## Image Optimization

```tsx
// Native lazy loading
<img src="image.jpg" loading="lazy" decoding="async" />

// Responsive images
<img
  src="image-800.jpg"
  srcSet="image-400.jpg 400w, image-800.jpg 800w, image-1200.jpg 1200w"
  sizes="(max-width: 600px) 400px, (max-width: 1000px) 800px, 1200px"
  loading="lazy"
/>
```
