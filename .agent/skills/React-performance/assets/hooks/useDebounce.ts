import { useState, useEffect } from 'react';

/**
 * Debounce a value - returns the value only after it stops changing for the delay period.
 * Useful for search inputs, form validation, API calls triggered by user input.
 *
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 * @returns The debounced value
 *
 * @example
 * function SearchInput() {
 *   const [query, setQuery] = useState('');
 *   const debouncedQuery = useDebounce(query, 300);
 *
 *   useEffect(() => {
 *     if (debouncedQuery) searchAPI(debouncedQuery);
 *   }, [debouncedQuery]);
 *
 *   return <input value={query} onChange={e => setQuery(e.target.value)} />;
 * }
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default useDebounce;
