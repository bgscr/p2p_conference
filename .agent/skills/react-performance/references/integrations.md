# Library Integration Patterns

## React Router v6

### Basic Setup with Lazy Loading

```tsx
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { lazy, Suspense } from 'react';

// Lazy load route components
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const UserProfile = lazy(() => import('./pages/UserProfile'));

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <ErrorBoundary />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <Dashboard />
          </Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <Settings />
          </Suspense>
        ),
      },
      {
        path: 'users/:userId',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <UserProfile />
          </Suspense>
        ),
        loader: userLoader,
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}
```

### Data Loading with Loaders

```tsx
import { useLoaderData, defer, Await } from 'react-router-dom';

// Loader function
export async function userLoader({ params }: LoaderFunctionArgs) {
  const userId = params.userId!;
  
  // Critical data - blocks render
  const user = await fetchUser(userId);
  
  // Non-critical data - streams in
  const postsPromise = fetchUserPosts(userId);
  const statsPromise = fetchUserStats(userId);
  
  return defer({
    user,
    posts: postsPromise,
    stats: statsPromise,
  });
}

// Component
function UserProfile() {
  const { user, posts, stats } = useLoaderData() as UserLoaderData;
  
  return (
    <div>
      <h1>{user.name}</h1>
      
      <Suspense fallback={<PostsSkeleton />}>
        <Await resolve={posts} errorElement={<PostsError />}>
          {(resolvedPosts) => <PostsList posts={resolvedPosts} />}
        </Await>
      </Suspense>
      
      <Suspense fallback={<StatsSkeleton />}>
        <Await resolve={stats}>
          {(resolvedStats) => <StatsPanel stats={resolvedStats} />}
        </Await>
      </Suspense>
    </div>
  );
}
```

### Mutations with Actions

```tsx
import { Form, useActionData, useNavigation } from 'react-router-dom';

// Action function
export async function updateUserAction({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const updates = Object.fromEntries(formData);
  
  try {
    await updateUser(params.userId!, updates);
    return redirect(`/users/${params.userId}`);
  } catch (error) {
    return { error: 'Failed to update user' };
  }
}

// Component with optimistic UI
function EditUserForm({ user }: { user: User }) {
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  
  return (
    <Form method="post">
      {actionData?.error && <Alert>{actionData.error}</Alert>}
      
      <input name="name" defaultValue={user.name} disabled={isSubmitting} />
      <input name="email" defaultValue={user.email} disabled={isSubmitting} />
      
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : 'Save'}
      </button>
    </Form>
  );
}
```

### Protected Routes

```tsx
import { redirect } from 'react-router-dom';

// Auth loader
export async function protectedLoader() {
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return redirect('/login?redirect=' + encodeURIComponent(window.location.pathname));
  }
  
  return { user };
}

// Route config
{
  path: 'dashboard',
  loader: protectedLoader,
  element: <Dashboard />,
}
```

## Axios / Fetch Patterns

### Typed API Client with Axios

```tsx
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

// Types
interface ApiResponse<T> {
  data: T;
  message: string;
}

interface ApiError {
  message: string;
  code: string;
}

// Create configured instance
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401) {
      clearAuthToken();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Typed request functions
export const userApi = {
  getUser: (id: string) => 
    api.get<ApiResponse<User>>(`/users/${id}`).then(r => r.data.data),
  
  updateUser: (id: string, data: Partial<User>) =>
    api.patch<ApiResponse<User>>(`/users/${id}`, data).then(r => r.data.data),
  
  deleteUser: (id: string) =>
    api.delete(`/users/${id}`),
};
```

### Fetch with Request Deduplication

```tsx
// Simple request cache
const requestCache = new Map<string, Promise<any>>();

async function fetchWithCache<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const key = `${options?.method || 'GET'}:${url}`;
  
  // Return existing promise if in-flight
  if (requestCache.has(key)) {
    return requestCache.get(key)!;
  }
  
  const promise = fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      return res.json();
    })
    .finally(() => {
      requestCache.delete(key);
    });
  
  requestCache.set(key, promise);
  return promise;
}
```

### SWR-style Hooks (without library)

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';

interface UseFetchResult<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isValidating: boolean;
  mutate: (data?: T) => void;
}

function useFetch<T>(
  url: string,
  options?: RequestInit & { revalidateOnFocus?: boolean }
): UseFetchResult<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [isLoading, setIsLoading] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const mountedRef = useRef(true);
  
  const fetchData = useCallback(async (isRevalidation = false) => {
    if (isRevalidation) {
      setIsValidating(true);
    } else {
      setIsLoading(true);
    }
    
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) {
        setData(json);
        setError(undefined);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err as Error);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsValidating(false);
      }
    }
  }, [url]);
  
  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);
  
  // Revalidate on focus
  useEffect(() => {
    if (!options?.revalidateOnFocus) return;
    
    const handleFocus = () => fetchData(true);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchData, options?.revalidateOnFocus]);
  
  const mutate = useCallback((newData?: T) => {
    if (newData !== undefined) {
      setData(newData);
    } else {
      fetchData(true);
    }
  }, [fetchData]);
  
  return { data, error, isLoading, isValidating, mutate };
}
```

### Abort Controller Pattern

```tsx
function useAbortableFetch<T>(url: string) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const abortControllerRef = useRef<AbortController>();
  
  useEffect(() => {
    // Abort previous request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    
    setLoading(true);
    
    fetch(url, { signal: abortControllerRef.current.signal })
      .then(res => res.json())
      .then(setData)
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error(err);
        }
      })
      .finally(() => setLoading(false));
    
    return () => abortControllerRef.current?.abort();
  }, [url]);
  
  return { data, loading };
}
```

## Tailwind CSS Integration

### Performance-Optimized Class Composition

```tsx
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for merging Tailwind classes safely
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Usage
function Button({ 
  variant = 'primary',
  size = 'md',
  className,
  ...props 
}: ButtonProps) {
  return (
    <button
      className={cn(
        // Base styles
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2',
        // Variants
        {
          'bg-primary text-white hover:bg-primary/90': variant === 'primary',
          'bg-secondary text-secondary-foreground hover:bg-secondary/80': variant === 'secondary',
          'border border-input bg-background hover:bg-accent': variant === 'outline',
        },
        // Sizes
        {
          'h-8 px-3 text-sm': size === 'sm',
          'h-10 px-4': size === 'md',
          'h-12 px-6 text-lg': size === 'lg',
        },
        // Custom classes override
        className
      )}
      {...props}
    />
  );
}
```

### CSS Variables for Theming

```tsx
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        // ... more semantic colors
      },
    },
  },
};

// globals.css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
  }
  
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
  }
}
```

### Responsive Component Pattern

```tsx
// Avoid inline responsive utilities when reused
const containerStyles = 'mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl';
const headingStyles = 'text-2xl sm:text-3xl lg:text-4xl font-bold';

// Component with responsive defaults
function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 sm:p-6',
        'shadow-sm hover:shadow-md transition-shadow',
        className
      )}
      {...props}
    />
  );
}
```

## shadcn/ui Integration

### Component Installation Pattern

```bash
# Install specific components
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
npx shadcn@latest add form
```

### Extending shadcn Components

```tsx
// components/ui/button.tsx (generated by shadcn)
// Extend with additional variants

import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        // Custom variants
        success: 'bg-green-600 text-white hover:bg-green-700',
        warning: 'bg-yellow-500 text-black hover:bg-yellow-600',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
        // Custom sizes
        xl: 'h-14 rounded-lg px-10 text-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);
```

### Form Integration with React Hook Form

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const formSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormValues = z.infer<typeof formSchema>;

export function LoginForm() {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });
  
  async function onSubmit(values: FormValues) {
    // Handle submission
  }
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder="email@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormDescription>
                Must be at least 8 characters.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </Form>
  );
}
```

### Data Table with Tanstack Table

```tsx
'use client';

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

export function DataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  
  return (
    <div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
```

### Dialog with Server Action

```tsx
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { deleteItem } from '@/app/actions';

export function DeleteDialog({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  
  async function handleDelete() {
    setPending(true);
    try {
      await deleteItem(itemId);
      setOpen(false);
    } finally {
      setPending(false);
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">Delete</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
