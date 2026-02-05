import { useRef, useEffect } from 'react';

/**
 * Track the previous value of a variable across renders.
 * Useful for comparing previous and current props/state, animations, transitions.
 *
 * @param value - The value to track
 * @returns The value from the previous render (undefined on first render)
 *
 * @example
 * function Counter({ count }: { count: number }) {
 *   const prevCount = usePrevious(count);
 *
 *   return (
 *     <div>
 *       <p>Current: {count}</p>
 *       <p>Previous: {prevCount ?? 'N/A'}</p>
 *       <p>Direction: {count > (prevCount ?? 0) ? '↑' : '↓'}</p>
 *     </div>
 *   );
 * }
 *
 * @example
 * // Detect prop changes for debugging
 * function MyComponent(props: Props) {
 *   const prevProps = usePrevious(props);
 *
 *   useEffect(() => {
 *     if (prevProps) {
 *       const changes = Object.entries(props).filter(
 *         ([key, val]) => prevProps[key] !== val
 *       );
 *       if (changes.length) console.log('Props changed:', changes);
 *     }
 *   });
 * }
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

export default usePrevious;
