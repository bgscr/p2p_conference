import { useState, useCallback, useRef } from 'react';

type OptimisticState<T> = {
  data: T;
  pending: boolean;
  error: Error | null;
};

type OptimisticActions<T> = {
  /**
   * Execute an optimistic update.
   * Immediately applies optimistic state, then runs the async action.
   * On failure, rolls back to previous state.
   */
  execute: <R>(
    optimisticUpdate: (current: T) => T,
    action: () => Promise<R>,
    options?: {
      /** Called on success with action result */
      onSuccess?: (result: R) => void;
      /** Called on error, receives the error */
      onError?: (error: Error) => void;
      /** Optional server response to update state on success */
      serverUpdate?: (current: T, result: R) => T;
    }
  ) => Promise<R | undefined>;
  
  /** Reset error state */
  clearError: () => void;
  
  /** Manually set data (for external updates) */
  setData: (data: T | ((prev: T) => T)) => void;
};

/**
 * Hook for optimistic UI updates with automatic rollback on failure.
 * 
 * Usage:
 * ```tsx
 * function TodoList() {
 *   const { data: todos, pending, error, execute } = useOptimisticUpdate<Todo[]>([]);
 *   
 *   const handleToggle = async (id: string) => {
 *     await execute(
 *       // Optimistic update - runs immediately
 *       (todos) => todos.map(t => 
 *         t.id === id ? { ...t, done: !t.done } : t
 *       ),
 *       // Async action - runs after optimistic update
 *       () => api.toggleTodo(id),
 *       {
 *         onError: (err) => toast.error('Failed to update'),
 *         // Optional: use server response
 *         serverUpdate: (todos, result) => 
 *           todos.map(t => t.id === id ? result : t),
 *       }
 *     );
 *   };
 *   
 *   return (
 *     <ul>
 *       {todos.map(todo => (
 *         <li 
 *           key={todo.id} 
 *           onClick={() => handleToggle(todo.id)}
 *           style={{ opacity: pending ? 0.5 : 1 }}
 *         >
 *           {todo.text}
 *         </li>
 *       ))}
 *       {error && <ErrorMessage error={error} />}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useOptimisticUpdate<T>(
  initialData: T
): OptimisticState<T> & OptimisticActions<T> {
  const [state, setState] = useState<OptimisticState<T>>({
    data: initialData,
    pending: false,
    error: null,
  });
  
  // Track rollback state for nested/concurrent updates
  const rollbackRef = useRef<T | null>(null);
  const pendingCountRef = useRef(0);
  
  const execute = useCallback(async <R>(
    optimisticUpdate: (current: T) => T,
    action: () => Promise<R>,
    options?: {
      onSuccess?: (result: R) => void;
      onError?: (error: Error) => void;
      serverUpdate?: (current: T, result: R) => T;
    }
  ): Promise<R | undefined> => {
    // Store rollback state (only for first pending action)
    if (pendingCountRef.current === 0) {
      rollbackRef.current = state.data;
    }
    pendingCountRef.current++;
    
    // Apply optimistic update immediately
    setState((prev) => ({
      ...prev,
      data: optimisticUpdate(prev.data),
      pending: true,
      error: null,
    }));
    
    try {
      const result = await action();
      
      pendingCountRef.current--;
      
      setState((prev) => ({
        ...prev,
        data: options?.serverUpdate 
          ? options.serverUpdate(prev.data, result)
          : prev.data,
        pending: pendingCountRef.current > 0,
      }));
      
      // Clear rollback state if no more pending actions
      if (pendingCountRef.current === 0) {
        rollbackRef.current = null;
      }
      
      options?.onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      
      pendingCountRef.current--;
      
      // Rollback to state before any pending optimistic updates
      setState((prev) => ({
        data: rollbackRef.current ?? prev.data,
        pending: pendingCountRef.current > 0,
        error,
      }));
      
      // Clear rollback state if no more pending actions
      if (pendingCountRef.current === 0) {
        rollbackRef.current = null;
      }
      
      options?.onError?.(error);
      return undefined;
    }
  }, [state.data]);
  
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);
  
  const setData = useCallback((data: T | ((prev: T) => T)) => {
    setState((prev) => ({
      ...prev,
      data: typeof data === 'function' ? (data as (prev: T) => T)(prev.data) : data,
    }));
  }, []);
  
  return {
    ...state,
    execute,
    clearError,
    setData,
  };
}

/**
 * Simplified optimistic mutation hook for single-item updates.
 * 
 * Usage:
 * ```tsx
 * function LikeButton({ postId, initialLikes }: Props) {
 *   const { value, mutate, pending, error } = useOptimisticMutation(
 *     initialLikes,
 *     (current) => current + 1,
 *     () => api.likePost(postId)
 *   );
 *   
 *   return (
 *     <button onClick={mutate} disabled={pending}>
 *       ❤️ {value}
 *     </button>
 *   );
 * }
 * ```
 */
export function useOptimisticMutation<T, R = void>(
  initialValue: T,
  optimisticFn: (current: T) => T,
  mutateFn: () => Promise<R>,
  options?: {
    onSuccess?: (result: R) => void;
    onError?: (error: Error) => void;
    serverValue?: (current: T, result: R) => T;
  }
) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const rollbackRef = useRef<T | null>(null);
  
  const mutate = useCallback(async () => {
    rollbackRef.current = value;
    setValue(optimisticFn);
    setPending(true);
    setError(null);
    
    try {
      const result = await mutateFn();
      
      if (options?.serverValue) {
        setValue((current) => options.serverValue!(current, result));
      }
      
      options?.onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setValue(rollbackRef.current!);
      setError(error);
      options?.onError?.(error);
    } finally {
      setPending(false);
      rollbackRef.current = null;
    }
  }, [value, optimisticFn, mutateFn, options]);
  
  return { value, mutate, pending, error, setValue };
}
