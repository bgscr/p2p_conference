import { useState, useEffect, useRef } from 'react';

/**
 * Throttle a value - updates at most once per interval.
 * Useful for scroll/resize handlers, real-time analytics, continuous user actions.
 *
 * @param value - The value to throttle
 * @param interval - Minimum interval between updates in milliseconds (default: 100ms)
 * @returns The throttled value
 *
 * @example
 * function ScrollTracker() {
 *   const [scrollY, setScrollY] = useState(0);
 *   const throttledScrollY = useThrottle(scrollY, 100);
 *
 *   useEffect(() => {
 *     const handler = () => setScrollY(window.scrollY);
 *     window.addEventListener('scroll', handler, { passive: true });
 *     return () => window.removeEventListener('scroll', handler);
 *   }, []);
 *
 *   useEffect(() => {
 *     trackScrollDepth(throttledScrollY);
 *   }, [throttledScrollY]);
 * }
 */
export function useThrottle<T>(value: T, interval = 100): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastUpdated = useRef<number>(Date.now());

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdated.current;

    if (timeSinceLastUpdate >= interval) {
      lastUpdated.current = now;
      setThrottledValue(value);
    } else {
      const timer = setTimeout(() => {
        lastUpdated.current = Date.now();
        setThrottledValue(value);
      }, interval - timeSinceLastUpdate);

      return () => clearTimeout(timer);
    }
  }, [value, interval]);

  return throttledValue;
}

export default useThrottle;
