# State Management Performance

## State Colocation

Keep state as close to where it's used as possible:

```tsx
// ❌ State too high - entire tree re-renders
function App() {
  const [inputValue, setInputValue] = useState('');
  return (
    <Layout>
      <Sidebar />
      <Main>
        <SearchInput value={inputValue} onChange={setInputValue} />
        <Results />
      </Main>
    </Layout>
  );
}

// ✅ State colocated - only SearchInput re-renders
function App() {
  return (
    <Layout>
      <Sidebar />
      <Main>
        <SearchInput /> {/* manages its own state */}
        <Results />
      </Main>
    </Layout>
  );
}
```

## Lifting State Efficiently

When state must be shared, lift only what's necessary:

```tsx
// ✅ Lift minimal shared state
function Parent() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <>
      <List onSelect={setSelectedId} />
      <Detail id={selectedId} />
    </>
  );
}
```

## Context Performance Patterns

### Split Read/Write Contexts

```tsx
const CountContext = createContext(0);
const CountDispatchContext = createContext<Dispatch<Action>>(() => {});

function CountProvider({ children }: PropsWithChildren) {
  const [count, dispatch] = useReducer(reducer, 0);

  return (
    <CountContext.Provider value={count}>
      <CountDispatchContext.Provider value={dispatch}>
        {children}
      </CountDispatchContext.Provider>
    </CountContext.Provider>
  );
}

// Components that only dispatch don't re-render on count change
function IncrementButton() {
  const dispatch = useContext(CountDispatchContext);
  return <button onClick={() => dispatch({ type: 'inc' })}>+</button>;
}
```

### Selective Subscriptions

```tsx
// Store with selectors
const StoreContext = createContext<Store | null>(null);

function useSelector<T>(selector: (state: State) => T): T {
  const store = useContext(StoreContext)!;
  const [value, setValue] = useState(() => selector(store.getState()));

  useEffect(() => {
    return store.subscribe(() => {
      const newValue = selector(store.getState());
      setValue(prev => Object.is(prev, newValue) ? prev : newValue);
    });
  }, [store, selector]);

  return value;
}

// Only re-renders when selected value changes
function UserName() {
  const name = useSelector(state => state.user.name);
  return <span>{name}</span>;
}
```

## Normalized State

```tsx
// ❌ Nested/denormalized - updating one item re-processes entire tree
interface State {
  posts: Array<{
    id: string;
    author: { id: string; name: string };
    comments: Array<{ id: string; author: { id: string; name: string } }>;
  }>;
}

// ✅ Normalized - efficient lookups and updates
interface NormalizedState {
  users: Record<string, User>;
  posts: Record<string, Post>;
  comments: Record<string, Comment>;
  postIds: string[];
}

// Update single entity without affecting others
function updateUser(state: NormalizedState, user: User): NormalizedState {
  return {
    ...state,
    users: { ...state.users, [user.id]: user },
  };
}
```

## Immutable Updates

```tsx
// ✅ Shallow copies for changed paths only
function updateNestedItem(state: State, itemId: string, value: string): State {
  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...state.items[itemId],
        value,
      },
    },
  };
}

// Consider Immer for complex updates
import { produce } from 'immer';

const nextState = produce(state, draft => {
  draft.items[itemId].value = value;
  draft.items[itemId].nested.deep.property = 'updated';
});
```

## useReducer vs useState

```tsx
// ✅ useReducer for complex state logic
// - Predictable updates via actions
// - Dispatch is stable (no useCallback needed)
// - Easier to test

const [state, dispatch] = useReducer(formReducer, initialState);

// Pass stable dispatch to children
<Form onSubmit={data => dispatch({ type: 'submit', data })} />
```

## Batching Updates

React 18 automatically batches updates, but be aware:

```tsx
// React 18: Both updates batched into single render
function handleClick() {
  setCount(c => c + 1);
  setFlag(f => !f);
}

// Force synchronous update when needed (rare)
import { flushSync } from 'react-dom';

function handleScroll() {
  flushSync(() => setScrollPosition(pos));
  // DOM is updated here
  measureElement();
}
```

## External Store Integration

```tsx
import { useSyncExternalStore } from 'react';

function useWindowWidth() {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener('resize', callback);
      return () => window.removeEventListener('resize', callback);
    },
    () => window.innerWidth,
    () => 1024 // SSR fallback
  );
}
```

## Zustand Pattern (Lightweight)

```tsx
import { create } from 'zustand';

interface BearStore {
  bears: number;
  increase: () => void;
}

const useBearStore = create<BearStore>((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
}));

// Component only re-renders when bears changes
function BearCount() {
  const bears = useBearStore((state) => state.bears);
  return <span>{bears}</span>;
}
```
