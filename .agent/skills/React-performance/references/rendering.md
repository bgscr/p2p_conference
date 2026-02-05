# Rendering Optimization

## When Components Re-render

A component re-renders when:
1. Its state changes
2. Its parent re-renders (unless memoized)
3. A context it consumes changes

## React.memo

Wrap components that receive the same props frequently:

```tsx
import { memo } from 'react';

interface ItemProps {
  id: string;
  title: string;
  onClick: (id: string) => void;
}

export const Item = memo(function Item({ id, title, onClick }: ItemProps) {
  return <div onClick={() => onClick(id)}>{title}</div>;
});

// With custom comparison
export const ItemCustom = memo(
  function Item({ id, title }: ItemProps) {
    return <div>{title}</div>;
  },
  (prevProps, nextProps) => prevProps.id === nextProps.id
);
```

## useMemo

Cache expensive computations:

```tsx
import { useMemo } from 'react';

function ProductList({ products, filter }: Props) {
  // ✅ Only recalculates when products or filter change
  const filteredProducts = useMemo(
    () => products.filter(p => p.category === filter).sort((a, b) => a.price - b.price),
    [products, filter]
  );

  // ✅ Stable object reference for child props
  const config = useMemo(() => ({ showPrices: true, currency: 'USD' }), []);

  return <List items={filteredProducts} config={config} />;
}
```

## useCallback

Stabilize function references:

```tsx
import { useCallback } from 'react';

function Parent({ userId }: Props) {
  // ✅ Stable reference - only changes when userId changes
  const handleClick = useCallback((itemId: string) => {
    console.log(userId, itemId);
  }, [userId]);

  return <MemoizedChild onClick={handleClick} />;
}
```

## Key Prop Best Practices

```tsx
// ✅ Unique, stable identifier
{items.map(item => <Item key={item.id} data={item} />)}

// ❌ Index causes issues with reordering/filtering
{items.map((item, i) => <Item key={i} data={item} />)}

// ❌ Random keys force remount every render
{items.map(item => <Item key={Math.random()} data={item} />)}
```

## Children Pattern

Prevent re-renders by lifting children up:

```tsx
// ❌ ExpensiveComponent re-renders when Parent's state changes
function Parent() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>{count}</button>
      <ExpensiveComponent />
    </div>
  );
}

// ✅ ExpensiveComponent doesn't re-render
function Parent({ children }: PropsWithChildren) {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>{count}</button>
      {children}
    </div>
  );
}

// Usage
<Parent>
  <ExpensiveComponent />
</Parent>
```

## Context Optimization

Split contexts to prevent unnecessary re-renders:

```tsx
// ❌ All consumers re-render when any value changes
const AppContext = createContext({ user: null, theme: 'light', locale: 'en' });

// ✅ Separate contexts for independent values
const UserContext = createContext<User | null>(null);
const ThemeContext = createContext<'light' | 'dark'>('light');
const LocaleContext = createContext('en');
```

## Profiling Re-renders

```tsx
// Development-only render tracking
if (process.env.NODE_ENV === 'development') {
  const useWhyDidYouRender = (name: string, props: object) => {
    const prevProps = useRef(props);
    useEffect(() => {
      const changes = Object.entries(props).filter(
        ([key, val]) => prevProps.current[key] !== val
      );
      if (changes.length) console.log(`${name} re-rendered:`, changes);
      prevProps.current = props;
    });
  };
}
```
