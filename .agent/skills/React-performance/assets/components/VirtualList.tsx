import { memo, useState, useEffect, useRef, useMemo, useCallback, CSSProperties } from 'react';
import type { ReactNode } from 'react';

/**
 * Virtual List Component
 *
 * Efficiently renders large lists by only mounting visible items.
 * Essential for lists with 100+ items to maintain smooth 60fps scrolling.
 *
 * Features:
 * - Only renders visible items + overscan buffer
 * - Supports fixed-height items (variable height requires different approach)
 * - Exposes scrollToIndex for programmatic scrolling
 * - Keyboard navigation support
 */

const containerStyle: CSSProperties = {
  overflow: 'auto',
  position: 'relative',
};

const innerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
};

interface VirtualListProps<T> {
  /** Array of items to render */
  items: T[];
  /** Height of the container in pixels */
  height: number;
  /** Height of each item in pixels (must be consistent) */
  itemHeight: number;
  /** Number of items to render outside visible area (default: 3) */
  overscan?: number;
  /** Extract unique key from item */
  getItemKey: (item: T, index: number) => string | number;
  /** Render function for each item */
  renderItem: (item: T, index: number, style: CSSProperties) => ReactNode;
  /** Optional: Called when scroll reaches near bottom */
  onEndReached?: () => void;
  /** Optional: Threshold for onEndReached in pixels (default: 200) */
  endReachedThreshold?: number;
  /** Optional: Additional className for container */
  className?: string;
}

function VirtualListInner<T>({
  items,
  height,
  itemHeight,
  overscan = 3,
  getItemKey,
  renderItem,
  onEndReached,
  endReachedThreshold = 200,
  className,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const endReachedCalledRef = useRef(false);

  // Total height of all items
  const totalHeight = items.length * itemHeight;

  // Calculate visible range
  const { startIndex, endIndex, visibleItems } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(height / itemHeight);
    const end = Math.min(items.length - 1, start + visibleCount + overscan * 2);

    const visible: Array<{ item: T; index: number; style: CSSProperties }> = [];
    for (let i = start; i <= end; i++) {
      visible.push({
        item: items[i],
        index: i,
        style: {
          position: 'absolute',
          top: i * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight,
        },
      });
    }

    return { startIndex: start, endIndex: end, visibleItems: visible };
  }, [items, itemHeight, height, scrollTop, overscan]);

  // Handle scroll
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    setScrollTop(container.scrollTop);

    // Check for end reached
    if (onEndReached) {
      const distanceFromBottom =
        totalHeight - container.scrollTop - container.clientHeight;

      if (distanceFromBottom < endReachedThreshold) {
        if (!endReachedCalledRef.current) {
          endReachedCalledRef.current = true;
          onEndReached();
        }
      } else {
        endReachedCalledRef.current = false;
      }
    }
  }, [totalHeight, onEndReached, endReachedThreshold]);

  // Attach scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Public method to scroll to specific index
  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const container = containerRef.current;
      if (!container) return;

      const targetTop = Math.min(
        index * itemHeight,
        totalHeight - container.clientHeight
      );

      container.scrollTo({ top: targetTop, behavior });
    },
    [itemHeight, totalHeight]
  );

  // Expose scrollToIndex via ref (optional pattern)
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      (container as any).scrollToIndex = scrollToIndex;
    }
  }, [scrollToIndex]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ ...containerStyle, height }}
      role="list"
      tabIndex={0}
    >
      <div style={{ ...innerStyle, height: totalHeight }}>
        {visibleItems.map(({ item, index, style }) => (
          <div key={getItemKey(item, index)} style={style} role="listitem">
            {renderItem(item, index, style)}
          </div>
        ))}
      </div>
    </div>
  );
}

// Memoize the component
export const VirtualList = memo(VirtualListInner) as typeof VirtualListInner;

export default VirtualList;

/**
 * @example
 * interface User {
 *   id: string;
 *   name: string;
 *   email: string;
 * }
 *
 * function UserList({ users }: { users: User[] }) {
 *   return (
 *     <VirtualList
 *       items={users}
 *       height={400}
 *       itemHeight={60}
 *       overscan={5}
 *       getItemKey={(user) => user.id}
 *       renderItem={(user, index) => (
 *         <div className="user-row">
 *           <span>{user.name}</span>
 *           <span>{user.email}</span>
 *         </div>
 *       )}
 *       onEndReached={() => loadMoreUsers()}
 *     />
 *   );
 * }
 */
