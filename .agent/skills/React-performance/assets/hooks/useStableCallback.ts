import { useRef, useCallback, useLayoutEffect } from 'react';

/**
 * Create a callback with a stable reference that always calls the latest function.
 * Unlike useCallback, this never requires dependencies and never causes re-renders
 * when passed to memoized children.
 *
 * Useful when you need a stable callback reference but the callback uses
 * values that change frequently.
 *
 * @param callback - The callback function
 * @returns A stable function reference that always calls the latest callback
 *
 * @example
 * function Parent() {
 *   const [items, setItems] = useState<Item[]>([]);
 *   const [filter, setFilter] = useState('');
 *
 *   // This callback references `items` and `filter`, which change often.
 *   // With useCallback, we'd need both as dependencies, causing re-renders.
 *   // With useStableCallback, the reference stays stable.
 *   const handleItemClick = useStableCallback((id: string) => {
 *     const item = items.find(i => i.id === id);
 *     if (item && item.category === filter) {
 *       doSomething(item);
 *     }
 *   });
 *
 *   return <MemoizedList onItemClick={handleItemClick} />;
 * }
 *
 * @example
 * // Event handler that always has latest state
 * function ChatInput() {
 *   const [message, setMessage] = useState('');
 *   const [roomId, setRoomId] = useState('general');
 *
 *   const sendMessage = useStableCallback(() => {
 *     sendToRoom(roomId, message);
 *     setMessage('');
 *   });
 *
 *   return (
 *     <form onSubmit={e => { e.preventDefault(); sendMessage(); }}>
 *       <input value={message} onChange={e => setMessage(e.target.value)} />
 *       <MemoizedSendButton onClick={sendMessage} />
 *     </form>
 *   );
 * }
 */
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useRef<T>(callback);

  // Use useLayoutEffect to update synchronously before any event handlers fire
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  // Return a stable function that delegates to the latest callback
  const stableCallback = useCallback(
    ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    []
  );

  return stableCallback;
}

export default useStableCallback;
