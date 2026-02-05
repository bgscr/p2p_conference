import { StateCreator } from 'zustand';

/**
 * Type-safe slice factory for Zustand stores.
 * 
 * Usage:
 * ```tsx
 * // Define your slice
 * interface TodoSlice {
 *   todos: Todo[];
 *   addTodo: (text: string) => void;
 *   toggleTodo: (id: string) => void;
 * }
 * 
 * // Create the slice
 * const createTodoSlice = createSlice<AppStore, TodoSlice>((set, get) => ({
 *   todos: [],
 *   addTodo: (text) => set((state) => ({
 *     todos: [...state.todos, { id: crypto.randomUUID(), text, done: false }]
 *   })),
 *   toggleTodo: (id) => set((state) => ({
 *     todos: state.todos.map((t) => 
 *       t.id === id ? { ...t, done: !t.done } : t
 *     )
 *   })),
 * }));
 * 
 * // Combine with other slices
 * const useStore = create<AppStore>()((...args) => ({
 *   ...createTodoSlice(...args),
 *   ...createUserSlice(...args),
 * }));
 * ```
 */
export function createSlice<Store, Slice>(
  creator: StateCreator<Store, [], [], Slice>
): StateCreator<Store, [], [], Slice> {
  return creator;
}

/**
 * Creates a resettable slice with initial state extraction.
 * 
 * Usage:
 * ```tsx
 * const { slice: createTodoSlice, getInitialState } = createResettableSlice<AppStore, TodoSlice>(
 *   { todos: [] },
 *   (set, get, initialState) => ({
 *     ...initialState,
 *     addTodo: (text) => set((state) => ({
 *       todos: [...state.todos, { id: crypto.randomUUID(), text, done: false }]
 *     })),
 *     reset: () => set(initialState),
 *   })
 * );
 * ```
 */
export function createResettableSlice<Store, Slice extends object>(
  initialState: Partial<Slice>,
  creator: (
    set: Parameters<StateCreator<Store>>[0],
    get: Parameters<StateCreator<Store>>[1],
    initialState: Partial<Slice>
  ) => Slice
): {
  slice: StateCreator<Store, [], [], Slice>;
  getInitialState: () => Partial<Slice>;
} {
  return {
    slice: (set, get, api) => creator(set, get, initialState),
    getInitialState: () => initialState,
  };
}

/**
 * Type helper for cross-slice access.
 * Allows one slice to safely access another slice's state.
 */
export type SliceGetter<Store, Slice> = () => Slice & Partial<Store>;

/**
 * Creates selectors object from store for type-safe access.
 * 
 * Usage:
 * ```tsx
 * const selectors = createSelectors(useStore);
 * const todos = selectors.todos(); // Typed!
 * const user = selectors.user();   // Typed!
 * ```
 */
export function createSelectors<Store extends object>(
  store: { getState: () => Store; <T>(selector: (state: Store) => T): T }
) {
  const selectors: { [K in keyof Store]: () => Store[K] } = {} as any;
  
  const state = store.getState();
  for (const key of Object.keys(state) as (keyof Store)[]) {
    selectors[key] = () => store((s) => s[key]);
  }
  
  return selectors;
}

/**
 * Creates action-only selectors that don't cause re-renders.
 * Useful for getting dispatch functions without subscribing to state.
 * 
 * Usage:
 * ```tsx
 * const actions = createActionSelectors(useStore, ['addTodo', 'toggleTodo', 'removeTodo']);
 * const { addTodo } = actions(); // No re-render subscription
 * ```
 */
export function createActionSelectors<
  Store extends object,
  Keys extends (keyof Store)[]
>(
  store: { getState: () => Store },
  actionKeys: Keys
): () => Pick<Store, Keys[number]> {
  return () => {
    const state = store.getState();
    const actions: Partial<Store> = {};
    
    for (const key of actionKeys) {
      if (typeof state[key] === 'function') {
        actions[key] = state[key];
      }
    }
    
    return actions as Pick<Store, Keys[number]>;
  };
}
