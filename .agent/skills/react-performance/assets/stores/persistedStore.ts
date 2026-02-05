import { create, StateCreator } from 'zustand';
import { persist, createJSONStorage, PersistOptions } from 'zustand/middleware';
import { useEffect, useState, useRef } from 'react';

/**
 * Creates a persisted store with proper SSR hydration handling.
 * Prevents hydration mismatch errors in Next.js/SSR environments.
 * 
 * Usage:
 * ```tsx
 * interface UserPreferences {
 *   theme: 'light' | 'dark';
 *   language: string;
 *   setTheme: (theme: 'light' | 'dark') => void;
 * }
 * 
 * const usePreferencesStore = createPersistedStore<UserPreferences>(
 *   (set) => ({
 *     theme: 'light',
 *     language: 'en',
 *     setTheme: (theme) => set({ theme }),
 *   }),
 *   {
 *     name: 'user-preferences',
 *     version: 1,
 *   }
 * );
 * 
 * // In component - handles hydration automatically
 * function ThemeToggle() {
 *   const theme = useHydratedStore(usePreferencesStore, (s) => s.theme);
 *   const setTheme = usePreferencesStore((s) => s.setTheme);
 *   
 *   if (theme === null) return <Skeleton />; // Loading
 *   return <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} />;
 * }
 * ```
 */
export function createPersistedStore<State extends object>(
  initializer: StateCreator<State & { _hasHydrated: boolean }, [], []>,
  options: {
    name: string;
    version?: number;
    migrate?: (persistedState: unknown, version: number) => State;
    partialize?: (state: State) => Partial<State>;
    storage?: 'localStorage' | 'sessionStorage';
  }
) {
  type StoreWithHydration = State & {
    _hasHydrated: boolean;
    _setHasHydrated: (state: boolean) => void;
  };

  return create<StoreWithHydration>()(
    persist(
      (set, get, api) => ({
        ...initializer(set as any, get as any, api as any),
        _hasHydrated: false,
        _setHasHydrated: (state) => set({ _hasHydrated: state } as Partial<StoreWithHydration>),
      }),
      {
        name: options.name,
        version: options.version,
        storage: createJSONStorage(() => 
          options.storage === 'sessionStorage' ? sessionStorage : localStorage
        ),
        migrate: options.migrate as any,
        partialize: options.partialize 
          ? (state) => {
              const { _hasHydrated, _setHasHydrated, ...rest } = state;
              return options.partialize!(rest as unknown as State);
            }
          : undefined,
        onRehydrateStorage: () => (state) => {
          state?._setHasHydrated(true);
        },
      }
    )
  );
}

/**
 * Hook that returns null until the store has hydrated.
 * Prevents hydration mismatch by not rendering persisted state on server.
 * 
 * Usage:
 * ```tsx
 * function CartCount() {
 *   const count = useHydratedStore(useCartStore, (s) => s.items.length);
 *   
 *   if (count === null) return <span>-</span>;
 *   return <span>{count}</span>;
 * }
 * ```
 */
export function useHydratedStore<State extends { _hasHydrated: boolean }, Selected>(
  useStore: {
    (selector: (state: State) => Selected): Selected;
    persist: { hasHydrated: () => boolean };
  },
  selector: (state: State) => Selected
): Selected | null {
  const [hydrated, setHydrated] = useState(false);
  const value = useStore(selector);
  const hasHydrated = useStore((s) => s._hasHydrated);
  
  useEffect(() => {
    // Check if already hydrated
    if (hasHydrated) {
      setHydrated(true);
      return;
    }
    
    // Wait for hydration
    const unsubscribe = useStore.persist.onFinishHydration?.(() => {
      setHydrated(true);
    });
    
    return unsubscribe;
  }, [hasHydrated]);
  
  return hydrated ? value : null;
}

/**
 * Hook to wait for hydration before rendering.
 * Useful for layouts or pages that depend on persisted state.
 * 
 * Usage:
 * ```tsx
 * function App() {
 *   const isHydrated = useStoreHydration(useUserStore);
 *   
 *   if (!isHydrated) {
 *     return <LoadingScreen />;
 *   }
 *   
 *   return <MainApp />;
 * }
 * ```
 */
export function useStoreHydration<State extends { _hasHydrated: boolean }>(
  useStore: (selector: (state: State) => boolean) => boolean
): boolean {
  const hasHydrated = useStore((s) => s._hasHydrated);
  const [hydrated, setHydrated] = useState(hasHydrated);
  
  useEffect(() => {
    if (hasHydrated && !hydrated) {
      setHydrated(true);
    }
  }, [hasHydrated, hydrated]);
  
  return hydrated;
}

/**
 * Initializes store with server data on first render.
 * Useful for hydrating client stores with SSR data.
 * 
 * Usage:
 * ```tsx
 * // Server Component
 * async function Page() {
 *   const user = await fetchUser();
 *   return <ClientPage initialUser={user} />;
 * }
 * 
 * // Client Component
 * 'use client';
 * function ClientPage({ initialUser }: { initialUser: User }) {
 *   useServerHydration(useUserStore, { user: initialUser });
 *   return <UserProfile />;
 * }
 * ```
 */
export function useServerHydration<State extends object>(
  store: { setState: (state: Partial<State>) => void },
  initialState: Partial<State>
): void {
  const initialized = useRef(false);
  
  // Use layout effect to run before paint
  if (typeof window !== 'undefined' && !initialized.current) {
    initialized.current = true;
    store.setState(initialState);
  }
}

/**
 * Creates a store reset function that preserves hydration state.
 * 
 * Usage:
 * ```tsx
 * const initialState = { count: 0, items: [] };
 * 
 * const useStore = create(persist(
 *   (set) => ({
 *     ...initialState,
 *     increment: () => set((s) => ({ count: s.count + 1 })),
 *   }),
 *   { name: 'store' }
 * ));
 * 
 * const resetStore = createStoreReset(useStore, initialState);
 * 
 * // Usage
 * function LogoutButton() {
 *   return <button onClick={resetStore}>Logout</button>;
 * }
 * ```
 */
export function createStoreReset<State extends object>(
  store: { setState: (state: Partial<State>) => void; persist?: { clearStorage: () => void } },
  initialState: Partial<State>,
  options?: { clearStorage?: boolean }
): () => void {
  return () => {
    store.setState(initialState);
    if (options?.clearStorage && store.persist) {
      store.persist.clearStorage();
    }
  };
}

/**
 * Syncs store state across browser tabs.
 * 
 * Usage:
 * ```tsx
 * // In your app initialization
 * useEffect(() => {
 *   return syncStoreAcrossTabs(useCartStore, 'cart-sync');
 * }, []);
 * ```
 */
export function syncStoreAcrossTabs<State extends object>(
  store: { 
    getState: () => State; 
    setState: (state: Partial<State>) => void;
    subscribe: (listener: (state: State) => void) => () => void;
  },
  channelName: string
): () => void {
  if (typeof window === 'undefined') return () => {};
  
  const channel = new BroadcastChannel(channelName);
  let isReceiving = false;
  
  // Listen for updates from other tabs
  channel.onmessage = (event) => {
    isReceiving = true;
    store.setState(event.data);
    isReceiving = false;
  };
  
  // Broadcast updates to other tabs
  const unsubscribe = store.subscribe((state) => {
    if (!isReceiving) {
      channel.postMessage(state);
    }
  });
  
  return () => {
    unsubscribe();
    channel.close();
  };
}
