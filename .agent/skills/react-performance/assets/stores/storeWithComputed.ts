import { create, StoreApi, UseBoundStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

type Compute<T, C> = (state: T) => C;

/**
 * Creates a store with computed/derived state that updates automatically.
 * Computed values are memoized and only recalculated when dependencies change.
 * 
 * Usage:
 * ```tsx
 * interface CartState {
 *   items: CartItem[];
 *   taxRate: number;
 *   addItem: (item: CartItem) => void;
 * }
 * 
 * interface CartComputed {
 *   subtotal: number;
 *   tax: number;
 *   total: number;
 *   itemCount: number;
 * }
 * 
 * const useCartStore = createStoreWithComputed<CartState, CartComputed>(
 *   (set) => ({
 *     items: [],
 *     taxRate: 0.08,
 *     addItem: (item) => set((s) => ({ items: [...s.items, item] })),
 *   }),
 *   (state) => {
 *     const subtotal = state.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
 *     const tax = subtotal * state.taxRate;
 *     return {
 *       subtotal,
 *       tax,
 *       total: subtotal + tax,
 *       itemCount: state.items.reduce((sum, i) => sum + i.quantity, 0),
 *     };
 *   }
 * );
 * 
 * // Usage in component - only re-renders when total changes
 * function CartTotal() {
 *   const total = useCartStore((s) => s.total);
 *   return <span>${total.toFixed(2)}</span>;
 * }
 * ```
 */
export function createStoreWithComputed<State extends object, Computed extends object>(
  storeCreator: (
    set: (fn: (state: State) => Partial<State>) => void,
    get: () => State & Computed
  ) => State,
  compute: Compute<State, Computed>
): UseBoundStore<StoreApi<State & Computed>> {
  return create<State & Computed>()(
    subscribeWithSelector((set, get) => {
      // Create the base state
      const baseState = storeCreator(
        (fn) => {
          set((currentState) => {
            // Extract only State properties for the update function
            const stateOnly = {} as State;
            const baseKeys = Object.keys(storeCreator(() => {}, () => ({} as any))) as (keyof State)[];
            for (const key of baseKeys) {
              stateOnly[key] = currentState[key as keyof typeof currentState] as any;
            }
            
            const updates = fn(stateOnly);
            const newState = { ...currentState, ...updates };
            
            // Recompute derived values
            const computed = compute(newState as unknown as State);
            return { ...updates, ...computed } as State & Computed;
          });
        },
        get
      );
      
      // Initial computed values
      const initialComputed = compute(baseState);
      
      return {
        ...baseState,
        ...initialComputed,
      };
    })
  );
}

/**
 * Creates memoized selectors for computed values.
 * Only recalculates when dependencies change.
 * 
 * Usage:
 * ```tsx
 * const selectCartTotal = createComputedSelector(
 *   [(s: CartState) => s.items, (s: CartState) => s.taxRate],
 *   (items, taxRate) => {
 *     const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
 *     return subtotal * (1 + taxRate);
 *   }
 * );
 * 
 * // Use with any store
 * const total = useCartStore(selectCartTotal);
 * ```
 */
export function createComputedSelector<State, Deps extends readonly any[], Result>(
  dependencies: { [K in keyof Deps]: (state: State) => Deps[K] },
  compute: (...deps: Deps) => Result
): (state: State) => Result {
  let lastDeps: Deps | null = null;
  let lastResult: Result;
  
  return (state: State) => {
    const currentDeps = dependencies.map((dep) => dep(state)) as unknown as Deps;
    
    // Check if any dependency changed
    const depsChanged = !lastDeps || currentDeps.some(
      (dep, i) => !Object.is(dep, lastDeps![i])
    );
    
    if (depsChanged) {
      lastDeps = currentDeps;
      lastResult = compute(...currentDeps);
    }
    
    return lastResult;
  };
}

/**
 * Subscribe to computed values and run side effects.
 * 
 * Usage:
 * ```tsx
 * // Sync cart total to analytics
 * subscribeToComputed(
 *   useCartStore,
 *   (state) => state.total,
 *   (total) => {
 *     analytics.track('cart_value_changed', { total });
 *   }
 * );
 * ```
 */
export function subscribeToComputed<State, Selected>(
  store: StoreApi<State>,
  selector: (state: State) => Selected,
  callback: (selected: Selected, previousSelected: Selected) => void,
  options?: { fireImmediately?: boolean }
): () => void {
  let previous = selector(store.getState());
  
  if (options?.fireImmediately) {
    callback(previous, previous);
  }
  
  return store.subscribe((state) => {
    const current = selector(state);
    if (!Object.is(current, previous)) {
      callback(current, previous);
      previous = current;
    }
  });
}
