import { memo, useState, useEffect, useRef, CSSProperties } from 'react';

/**
 * Lazy Loading Image Component
 *
 * Uses Intersection Observer to defer image loading until visible.
 * Reduces initial page load time and bandwidth for pages with many images.
 *
 * Features:
 * - Lazy loads images when they enter viewport
 * - Optional blur placeholder during loading
 * - Error state handling with fallback
 * - Native loading="lazy" fallback for older browsers
 * - Supports srcSet for responsive images
 */

const imageContainerStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  backgroundColor: '#f0f0f0',
};

const imageStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transition: 'opacity 0.3s ease-in-out, filter 0.3s ease-in-out',
};

const placeholderStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#e0e0e0',
};

interface LazyImageProps {
  /** Image source URL */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Optional srcSet for responsive images */
  srcSet?: string;
  /** Optional sizes attribute for responsive images */
  sizes?: string;
  /** Optional width (for aspect ratio) */
  width?: number;
  /** Optional height (for aspect ratio) */
  height?: number;
  /** Optional CSS class */
  className?: string;
  /** Optional inline styles */
  style?: CSSProperties;
  /** Optional low-quality placeholder image */
  placeholderSrc?: string;
  /** Optional fallback image on error */
  fallbackSrc?: string;
  /** Root margin for intersection observer (default: '100px') */
  rootMargin?: string;
  /** Threshold for intersection observer (default: 0.1) */
  threshold?: number;
  /** Called when image loads successfully */
  onLoad?: () => void;
  /** Called when image fails to load */
  onError?: () => void;
}

export const LazyImage = memo(function LazyImage({
  src,
  alt,
  srcSet,
  sizes,
  width,
  height,
  className,
  style,
  placeholderSrc,
  fallbackSrc,
  rootMargin = '100px',
  threshold = 0.1,
  onLoad,
  onError,
}: LazyImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Intersection Observer to detect when image enters viewport
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // Check for native support
    if (!('IntersectionObserver' in window)) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    setHasError(true);
    onError?.();
  };

  // Compute aspect ratio padding if dimensions provided
  const aspectRatioPadding =
    width && height ? `${(height / width) * 100}%` : undefined;

  // Determine which src to use
  const imageSrc = hasError && fallbackSrc ? fallbackSrc : src;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        ...imageContainerStyle,
        paddingBottom: aspectRatioPadding,
        ...style,
      }}
    >
      {/* Placeholder */}
      {!isLoaded && (
        <div style={placeholderStyle}>
          {placeholderSrc ? (
            <img
              src={placeholderSrc}
              alt=""
              style={{
                ...imageStyle,
                filter: 'blur(10px)',
                transform: 'scale(1.1)',
              }}
            />
          ) : (
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#999"
              strokeWidth="1"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          )}
        </div>
      )}

      {/* Actual image - only rendered when in view */}
      {isInView && (
        <img
          src={imageSrc}
          srcSet={hasError ? undefined : srcSet}
          sizes={sizes}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          style={{
            ...imageStyle,
            opacity: isLoaded ? 1 : 0,
            position: aspectRatioPadding ? 'absolute' : 'relative',
            inset: aspectRatioPadding ? 0 : undefined,
          }}
        />
      )}
    </div>
  );
});

export default LazyImage;

/**
 * @example
 * // Basic usage
 * <LazyImage
 *   src="/images/hero.jpg"
 *   alt="Hero image"
 *   width={1200}
 *   height={600}
 * />
 *
 * @example
 * // With responsive srcSet
 * <LazyImage
 *   src="/images/photo-800.jpg"
 *   srcSet="/images/photo-400.jpg 400w, /images/photo-800.jpg 800w, /images/photo-1200.jpg 1200w"
 *   sizes="(max-width: 600px) 400px, (max-width: 1000px) 800px, 1200px"
 *   alt="Responsive photo"
 * />
 *
 * @example
 * // With placeholder and fallback
 * <LazyImage
 *   src="/images/product.jpg"
 *   placeholderSrc="/images/product-tiny.jpg"
 *   fallbackSrc="/images/placeholder.jpg"
 *   alt="Product image"
 *   onLoad={() => console.log('Loaded!')}
 * />
 */
