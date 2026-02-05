# Zustand Performance Patterns

## Slice Pattern (Feature Modules)

Organize large stores into feature-based slices for maintainability and type safety:

```tsx
import { create, StateCreator } from 'zustand';

// Define slice types
interface UserSlice {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => void;
}

interface CartSlice {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
}

interface UISlice {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

// Combined store type
type AppStore = UserSlice & CartSlice & UISlice;

// Create slices with proper typing
const createUserSlice: StateCreator<AppStore, [], [], UserSlice> = (set) => ({
  user: null,
  setUser: (user) => set({ user }),
  logout: () => set({ user: null }),
});

const createCartSlice: StateCreator<AppStore, [], [], CartSlice> = (set) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  removeItem: (id) => set((state) => ({ 
    items: state.items.filter((i) => i.id !== id) 
  })),
  clearCart: () => set({ items: [] }),
});

const createUISlice: StateCreator<AppStore, [], [], UISlice> = (set) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  theme: 'light',
  setTheme: (theme) => set({ theme }),
});

// Combine slices
export const useAppStore = create<AppStore>()((...args) => ({
  ...createUserSlice(...args),
  ...createCartSlice(...args),
  ...createUISlice(...args),
}));
```

### Slice File Organization

```
stores/
├── index.ts           # Combined store export
├── types.ts           # Shared types
├── slices/
│   ├── userSlice.ts
│   ├── cartSlice.ts
│   └── uiSlice.ts
└── selectors.ts       # Memoized selectors
```

## Computed/Derived State

### Using Selectors for Derived Values

```tsx
import { create } from 'zustand';
import { shallow } from 'zustand/shallow';

interface CartStore {
  items: CartItem[];
  addItem: (item: CartItem) => void;
}

const useCartStore = create<CartStore>((set) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
}));

// Memoized selectors - computed outside store
export const selectCartTotal = (state: CartStore) =>
  state.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

export const selectCartCount = (state: CartStore) =>
  state.items.reduce((sum, item) => sum + item.quantity, 0);

export const selectItemsByCategory = (category: string) => (state: CartStore) =>
  state.items.filter((item) => item.category === category);

// Usage - only re-renders when derived value changes
function CartSummary() {
  const total = useCartStore(selectCartTotal);
  const count = useCartStore(selectCartCount);
  return <div>{count} items: ${total.toFixed(2)}</div>;
}
```

### Complex Computed State with Reselect

```tsx
import { createSelector } from 'reselect';

const selectItems = (state: CartStore) => state.items;
const selectTaxRate = (state: CartStore) => state.taxRate;

// Memoized complex computation
export const selectCartWithTax = createSelector(
  [selectItems, selectTaxRate],
  (items, taxRate) => {
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const tax = subtotal * taxRate;
    return { subtotal, tax, total: subtotal + tax };
  }
);
```

### Subscriptions for Side Effects

```tsx
// Subscribe to specific state changes
const unsubscribe = useCartStore.subscribe(
  (state) => state.items,
  (items, prevItems) => {
    // Only runs when items change
    localStorage.setItem('cart', JSON.stringify(items));
  },
  { equalityFn: shallow }
);
```

## Reset/Hydration Patterns

### Store Reset

```tsx
interface ResettableStore {
  // State
  count: number;
  user: User | null;
  // Actions
  increment: () => void;
  setUser: (user: User) => void;
  // Reset
  reset: () => void;
}

// Extract initial state
const initialState = {
  count: 0,
  user: null,
};

const useStore = create<ResettableStore>((set) => ({
  ...initialState,
  increment: () => set((state) => ({ count: state.count + 1 })),
  setUser: (user) => set({ user }),
  reset: () => set(initialState),
}));

// Partial reset
const useStore = create<Store>((set, get) => ({
  ...initialState,
  resetCart: () => set({ items: [], total: 0 }),
  resetUser: () => set({ user: null, preferences: defaultPreferences }),
  resetAll: () => set(initialState),
}));
```

### Hydration from Server/Storage

```tsx
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface HydratableStore {
  items: Item[];
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

const useStore = create<HydratableStore>()(
  persist(
    (set) => ({
      items: [],
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'app-storage',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// Wait for hydration in components
function App() {
  const hasHydrated = useStore((state) => state._hasHydrated);
  
  if (!hasHydrated) {
    return <LoadingSpinner />;
  }
  
  return <MainContent />;
}

// Or use hook pattern
export const useHydration = () => {
  const [hydrated, setHydrated] = useState(false);
  
  useEffect(() => {
    const unsubscribe = useStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    return unsubscribe;
  }, []);
  
  return hydrated;
};
```

### Server State Hydration (Next.js)

```tsx
// Server Component
async function Page() {
  const initialData = await fetchData();
  return <ClientComponent initialData={initialData} />;
}

// Client Component
'use client';
function ClientComponent({ initialData }: { initialData: Data }) {
  const initialized = useRef(false);
  
  useEffect(() => {
    if (!initialized.current) {
      useStore.setState({ data: initialData });
      initialized.current = true;
    }
  }, [initialData]);
  
  return <Content />;
}
```

## TypeScript Strict Patterns

### Strict Store Typing

```tsx
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// Strict action types
type Actions = {
  addTodo: (text: string) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
};

// Strict state types
type State = {
  todos: readonly Todo[];
  filter: 'all' | 'active' | 'completed';
};

type Store = State & Actions;

// Type-safe store with middleware
const useTodoStore = create<Store>()(
  devtools(
    persist(
      immer((set) => ({
        todos: [],
        filter: 'all',
        addTodo: (text) =>
          set((state) => {
            state.todos.push({ id: crypto.randomUUID(), text, done: false });
          }),
        toggleTodo: (id) =>
          set((state) => {
            const todo = state.todos.find((t) => t.id === id);
            if (todo) todo.done = !todo.done;
          }),
        removeTodo: (id) =>
          set((state) => {
            const index = state.todos.findIndex((t) => t.id === id);
            if (index !== -1) state.todos.splice(index, 1);
          }),
      })),
      { name: 'todo-storage' }
    ),
    { name: 'TodoStore' }
  )
);
```

### Generic Slice Factory

```tsx
type EntitySlice<T extends { id: string }> = {
  entities: Record<string, T>;
  ids: string[];
  addEntity: (entity: T) => void;
  updateEntity: (id: string, updates: Partial<T>) => void;
  removeEntity: (id: string) => void;
  selectById: (id: string) => T | undefined;
  selectAll: () => T[];
};

function createEntitySlice<T extends { id: string }>(
  name: string
): StateCreator<EntitySlice<T>> {
  return (set, get) => ({
    entities: {},
    ids: [],
    addEntity: (entity) =>
      set((state) => ({
        entities: { ...state.entities, [entity.id]: entity },
        ids: [...state.ids, entity.id],
      })),
    updateEntity: (id, updates) =>
      set((state) => ({
        entities: {
          ...state.entities,
          [id]: { ...state.entities[id], ...updates },
        },
      })),
    removeEntity: (id) =>
      set((state) => {
        const { [id]: removed, ...entities } = state.entities;
        return {
          entities,
          ids: state.ids.filter((i) => i !== id),
        };
      }),
    selectById: (id) => get().entities[id],
    selectAll: () => get().ids.map((id) => get().entities[id]),
  });
}

// Usage
const useUserStore = create(createEntitySlice<User>('users'));
const usePostStore = create(createEntitySlice<Post>('posts'));
```

### Type-Safe Selectors with Auto-Complete

```tsx
// Selector creator with type inference
function createSelectors<S extends object>(store: StoreApi<S>) {
  const selectors: { [K in keyof S]: () => S[K] } = {} as any;
  
  for (const key of Object.keys(store.getState()) as (keyof S)[]) {
    selectors[key] = () => store((state) => state[key]);
  }
  
  return selectors;
}

// Usage
const useStore = create<Store>()((set) => ({
  count: 0,
  name: '',
  increment: () => set((s) => ({ count: s.count + 1 })),
}));

const selectors = createSelectors(useStore);

// Auto-complete works!
const count = selectors.count(); // number
const name = selectors.name();   // string
```

## Store Composition

### Multiple Stores Pattern

```tsx
// Separate concerns into focused stores
const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  login: async (credentials) => { /* ... */ },
  logout: () => set({ user: null, token: null }),
}));

const useCartStore = create<CartStore>((set) => ({
  items: [],
  // Can read from other stores
  checkout: async () => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Not authenticated');
    // Process checkout
  },
}));

// Cross-store subscriptions
useAuthStore.subscribe(
  (state) => state.user,
  (user) => {
    if (!user) {
      useCartStore.getState().clearCart();
    }
  }
);
```

### Combining Stores for Complex Features

```tsx
// Create a combined hook for features needing multiple stores
function useCheckout() {
  const user = useAuthStore((s) => s.user);
  const items = useCartStore((s) => s.items);
  const total = useCartStore(selectCartTotal);
  const addresses = useAddressStore((s) => s.addresses);
  
  const canCheckout = useMemo(
    () => !!user && items.length > 0 && addresses.length > 0,
    [user, items.length, addresses.length]
  );
  
  return { user, items, total, addresses, canCheckout };
}
```

### Store with Middleware Composition

```tsx
import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// Compose multiple middleware
const useStore = create<Store>()(
  subscribeWithSelector(
    devtools(
      persist(
        immer((set, get) => ({
          // Store implementation
        })),
        { name: 'store' }
      ),
      { name: 'MyStore', enabled: process.env.NODE_ENV === 'development' }
    )
  )
);
```

## Performance Best Practices

```tsx
// ✅ Select only what you need
const count = useStore((state) => state.count);

// ❌ Selecting entire state causes re-renders on any change
const state = useStore();

// ✅ Use shallow for object/array selections
import { shallow } from 'zustand/shallow';
const { name, email } = useStore(
  (state) => ({ name: state.name, email: state.email }),
  shallow
);

// ✅ Memoize selectors for computed values
const selectExpensiveValue = useMemo(
  () => (state: Store) => expensiveComputation(state.data),
  []
);

// ✅ Use subscribeWithSelector for fine-grained subscriptions
const unsubscribe = useStore.subscribe(
  (state) => state.specificValue,
  (value) => console.log('Value changed:', value)
);
```
