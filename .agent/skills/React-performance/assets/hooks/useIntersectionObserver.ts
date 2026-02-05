import { useState, useEffect, useRef, useCallback, RefObject } from 'react';

interface UseIntersectionObserverOptions {
  threshold?: number | number[];
  root?: Element | null;
  rootMargin?: string;
  freezeOnceVisible?: boolean;
}

interface UseIntersectionObserverReturn {
  ref: RefObject<HTMLDivElement>;
  isIntersecting: boolean;
  hasIntersected: boolean;
  entry: IntersectionObserverEntry | null;
}

/**
 * Observe element visibility using Intersection Observer API.
 * Useful for lazy loading, infinite scroll, analytics tracking, animations on scroll.
 *
 * @param options - IntersectionObserver options plus freezeOnceVisible
 * @returns Object with ref, isIntersecting, hasIntersected, and entry
 *
 * @example
 * function LazyImage({ src, alt }: Props) {
 *   const { ref, hasIntersected } = useIntersectionObserver({
 *     threshold: 0.1,
 *     rootMargin: '100px',
 *     freezeOnceVisible: true,
 *   });
 *
 *   return (
 *     <div ref={ref}>
 *       {hasIntersected ? (
 *         <img src={src} alt={alt} />
 *       ) : (
 *         <div className="placeholder" />
 *       )}
 *     </div>
 *   );
 * }
 */
export function useIntersectionObserver({
  threshold = 0,
  root = null,
  rootMargin = '0px',
  freezeOnceVisible = false,
}: UseIntersectionObserverOptions = {}): UseIntersectionObserverReturn {
  const ref = useRef<HTMLDivElement>(null);
  const [entry, setEntry] = useState<IntersectionObserverEntry | null>(null);
  const [hasIntersected, setHasIntersected] = useState(false);

  const frozen = freezeOnceVisible && hasIntersected;

  const updateEntry = useCallback(([entry]: IntersectionObserverEntry[]) => {
    setEntry(entry);
    if (entry.isIntersecting) {
      setHasIntersected(true);
    }
  }, []);

  useEffect(() => {
    const node = ref.current;
    const hasIOSupport = !!window.IntersectionObserver;

    if (!hasIOSupport || frozen || !node) return;

    const observerParams = { threshold, root, rootMargin };
    const observer = new IntersectionObserver(updateEntry, observerParams);

    observer.observe(node);

    return () => observer.disconnect();
  }, [threshold, root, rootMargin, frozen, updateEntry]);

  return {
    ref,
    isIntersecting: entry?.isIntersecting ?? false,
    hasIntersected,
    entry,
  };
}

export default useIntersectionObserver;
