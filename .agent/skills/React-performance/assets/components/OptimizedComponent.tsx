import { memo, useMemo, useCallback } from 'react';
import type { ReactNode, CSSProperties } from 'react';

/**
 * Performance-Optimized Component Template
 *
 * This template demonstrates best practices for building performant React components.
 * Copy and adapt this pattern for your own components.
 *
 * Key Performance Patterns Used:
 * 1. memo() wrapper - prevents re-renders when props haven't changed
 * 2. useMemo() - caches computed values and object references
 * 3. useCallback() - stabilizes function references
 * 4. Extracted constants - styles/configs outside component to avoid recreation
 * 5. Proper TypeScript types - enables better prop comparison
 */

// ✅ Define styles outside component - never recreated
const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '16px',
};

// ✅ Define constants outside component
const DEFAULT_PAGE_SIZE = 10;

// ✅ Define types explicitly for better prop comparison
interface OptimizedComponentProps {
  /** Unique identifier for the item */
  id: string;
  /** Display title */
  title: string;
  /** Optional description text */
  description?: string;
  /** Array of items to display */
  items: ReadonlyArray<{ id: string; label: string; value: number }>;
  /** Filter criteria */
  filter?: string;
  /** Called when an item is selected */
  onItemSelect: (itemId: string) => void;
  /** Called when the component needs more items */
  onLoadMore?: () => void;
  /** Optional children */
  children?: ReactNode;
}

/**
 * Example optimized component following all performance best practices.
 */
export const OptimizedComponent = memo(function OptimizedComponent({
  id,
  title,
  description,
  items,
  filter = '',
  onItemSelect,
  onLoadMore,
  children,
}: OptimizedComponentProps) {
  // ✅ useMemo for expensive computations
  // Only recalculates when items or filter change
  const filteredItems = useMemo(() => {
    if (!filter) return items;
    const lowerFilter = filter.toLowerCase();
    return items.filter((item) =>
      item.label.toLowerCase().includes(lowerFilter)
    );
  }, [items, filter]);

  // ✅ useMemo for derived data
  const totalValue = useMemo(
    () => filteredItems.reduce((sum, item) => sum + item.value, 0),
    [filteredItems]
  );

  // ✅ useMemo for object props passed to children
  const summaryData = useMemo(
    () => ({
      count: filteredItems.length,
      total: totalValue,
      hasMore: items.length >= DEFAULT_PAGE_SIZE,
    }),
    [filteredItems.length, totalValue, items.length]
  );

  // ✅ useCallback for event handlers passed to children
  // Only recreated when id or onItemSelect changes
  const handleItemClick = useCallback(
    (itemId: string) => {
      onItemSelect(itemId);
    },
    [onItemSelect]
  );

  // ✅ useCallback with stable dependencies
  const handleLoadMore = useCallback(() => {
    onLoadMore?.();
  }, [onLoadMore]);

  return (
    <div style={containerStyle} data-testid={`component-${id}`}>
      {/* ✅ Static content doesn't need memoization */}
      <header>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>

      {/* ✅ Summary with memoized data */}
      <div>
        Showing {summaryData.count} items (Total: {summaryData.total})
      </div>

      {/* ✅ List with proper keys and memoized handler */}
      <ul>
        {filteredItems.map((item) => (
          // ✅ Use stable, unique ID as key - never index
          <li key={item.id}>
            <button
              type="button"
              onClick={() => handleItemClick(item.id)}
            >
              {item.label}: {item.value}
            </button>
          </li>
        ))}
      </ul>

      {/* ✅ Conditional rendering with memoized handler */}
      {summaryData.hasMore && onLoadMore && (
        <button type="button" onClick={handleLoadMore}>
          Load More
        </button>
      )}

      {/* ✅ Children passed through without modification */}
      {children}
    </div>
  );
});

// ✅ Named export for tree-shaking
export default OptimizedComponent;
