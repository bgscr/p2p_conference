import { useState, useEffect, useRef, useMemo, useCallback, RefObject } from 'react';

interface UseVirtualListOptions<T> {
  items: T[];
  itemHeight: number;
  overscan?: number;
  getItemKey?: (item: T, index: number) => string | number;
}

interface VirtualItem<T> {
  item: T;
  index: number;
  offsetTop: number;
}

interface UseVirtualListReturn<T> {
  containerRef: RefObject<HTMLDivElement>;
  virtualItems: VirtualItem<T>[];
  totalHeight: number;
  scrollToIndex: (index: number) => void;
}

/**
 * Virtualize large lists by rendering only visible items.
 * Essential for lists with 100+ items to maintain 60fps scrolling.
 *
 * @param options - Configuration including items, itemHeight, and overscan
 * @returns Object with containerRef, virtualItems, totalHeight, and scrollToIndex
 *
 * @example
 * function LargeList({ items }: { items: Item[] }) {
 *   const { containerRef, virtualItems, totalHeight } = useVirtualList({
 *     items,
 *     itemHeight: 50,
 *     overscan: 5,
 *   });
 *
 *   return (
 *     <div ref={containerRef} style={{ height: 400, overflow: 'auto' }}>
 *       <div style={{ height: totalHeight, position: 'relative' }}>
 *         {virtualItems.map(({ item, index, offsetTop }) => (
 *           <div
 *             key={item.id}
 *             style={{ position: 'absolute', top: offsetTop, height: 50, width: '100%' }}
 *           >
 *             {item.name}
 *           </div>
 *         ))}
 *       </div>
 *     </div>
 *   );
 * }
 */
export function useVirtualList<T>({
  items,
  itemHeight,
  overscan = 3,
  getItemKey,
}: UseVirtualListOptions<T>): UseVirtualListReturn<T> {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Handle scroll events
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };

    // Initial measurement
    setContainerHeight(container.clientHeight);
    setScrollTop(container.scrollTop);

    container.addEventListener('scroll', handleScroll, { passive: true });

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

  // Calculate total height
  const totalHeight = items.length * itemHeight;

  // Calculate visible range with overscan
  const virtualItems = useMemo(() => {
    if (containerHeight === 0) return [];

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );

    const result: VirtualItem<T>[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      result.push({
        item: items[i],
        index: i,
        offsetTop: i * itemHeight,
      });
    }

    return result;
  }, [items, itemHeight, scrollTop, containerHeight, overscan]);

  // Scroll to specific index
  const scrollToIndex = useCallback(
    (index: number) => {
      const container = containerRef.current;
      if (!container) return;

      const targetOffset = index * itemHeight;
      container.scrollTo({ top: targetOffset, behavior: 'smooth' });
    },
    [itemHeight]
  );

  return {
    containerRef,
    virtualItems,
    totalHeight,
    scrollToIndex,
  };
}

export default useVirtualList;
