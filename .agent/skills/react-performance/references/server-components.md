# React Server Components & Next.js App Router

## Server vs Client Components

### Decision Framework

| Use Server Component When | Use Client Component When |
|---------------------------|---------------------------|
| Fetching data | Using hooks (useState, useEffect, etc.) |
| Accessing backend resources | Adding event listeners (onClick, onChange) |
| Keeping sensitive info server-side | Using browser-only APIs |
| Large dependencies (keep off client bundle) | Using custom hooks with state/effects |
| Static content rendering | Real-time interactivity needed |

### Default to Server Components

```tsx
// app/page.tsx - Server Component by default
async function Page() {
  // Direct database/API access
  const data = await db.query('SELECT * FROM posts');
  
  return (
    <main>
      <h1>Posts</h1>
      {/* Pass data to client components as props */}
      <PostList posts={data} />
    </main>
  );
}
```

### Marking Client Components

```tsx
'use client'; // Must be at the top of the file

import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Count: {count}
    </button>
  );
}
```

## Component Composition Patterns

### Server Parent, Client Children

```tsx
// app/dashboard/page.tsx (Server)
import { Sidebar } from './sidebar'; // Server
import { InteractiveChart } from './chart'; // Client

async function Dashboard() {
  const data = await fetchDashboardData();
  
  return (
    <div className="flex">
      <Sidebar items={data.navItems} />
      <main>
        {/* Pass serializable data to client */}
        <InteractiveChart data={data.chartData} />
      </main>
    </div>
  );
}
```

### Client Boundary with Server Children

```tsx
// components/modal.tsx (Client)
'use client';

import { useState } from 'react';

export function Modal({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <dialog open>
          {children} {/* Server components can be passed as children */}
          <button onClick={() => setOpen(false)}>Close</button>
        </dialog>
      )}
    </>
  );
}

// app/page.tsx (Server)
import { Modal } from '@/components/modal';
import { ServerContent } from './server-content';

function Page() {
  return (
    <Modal>
      <ServerContent /> {/* Renders on server, passed through client */}
    </Modal>
  );
}
```

### Extracting Client Logic

```tsx
// ❌ Entire component becomes client
'use client';
export function ProductPage({ id }: { id: string }) {
  const [quantity, setQuantity] = useState(1);
  const product = useProduct(id); // Forces client fetch
  return <div>...</div>;
}

// ✅ Minimal client boundary
// app/products/[id]/page.tsx (Server)
async function ProductPage({ params }: { params: { id: string } }) {
  const product = await fetchProduct(params.id);
  
  return (
    <div>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <AddToCartButton product={product} /> {/* Only interactive part is client */}
    </div>
  );
}

// components/add-to-cart.tsx (Client)
'use client';
export function AddToCartButton({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1);
  return (
    <div>
      <input type="number" value={quantity} onChange={e => setQuantity(+e.target.value)} />
      <button onClick={() => addToCart(product.id, quantity)}>Add to Cart</button>
    </div>
  );
}
```

## Data Fetching Patterns

### Parallel Data Fetching

```tsx
// ✅ Parallel fetches - faster
async function Dashboard() {
  // Initiate all fetches simultaneously
  const [user, posts, analytics] = await Promise.all([
    fetchUser(),
    fetchPosts(),
    fetchAnalytics(),
  ]);
  
  return <DashboardContent user={user} posts={posts} analytics={analytics} />;
}

// ❌ Sequential fetches - slower (waterfall)
async function Dashboard() {
  const user = await fetchUser();
  const posts = await fetchPosts();
  const analytics = await fetchAnalytics();
  // ...
}
```

### Streaming with Suspense

```tsx
// app/page.tsx
import { Suspense } from 'react';

async function Page() {
  return (
    <main>
      <h1>Dashboard</h1>
      
      {/* Fast content renders immediately */}
      <QuickStats />
      
      {/* Slow content streams in */}
      <Suspense fallback={<ChartSkeleton />}>
        <SlowChart />
      </Suspense>
      
      <Suspense fallback={<TableSkeleton />}>
        <SlowDataTable />
      </Suspense>
    </main>
  );
}

async function SlowChart() {
  const data = await fetchSlowData(); // 2s delay
  return <Chart data={data} />;
}
```

### Nested Suspense Boundaries

```tsx
function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Header />
      <main>
        <Suspense fallback={<SidebarSkeleton />}>
          <Sidebar />
        </Suspense>
        <Suspense fallback={<ContentSkeleton />}>
          <MainContent />
        </Suspense>
      </main>
    </Suspense>
  );
}
```

## Server Actions

### Form Actions

```tsx
// app/actions.ts
'use server';

import { revalidatePath } from 'next/cache';

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string;
  const content = formData.get('content') as string;
  
  await db.post.create({ data: { title, content } });
  
  revalidatePath('/posts');
}

// app/posts/new/page.tsx
import { createPost } from '../actions';

function NewPostPage() {
  return (
    <form action={createPost}>
      <input name="title" required />
      <textarea name="content" required />
      <button type="submit">Create Post</button>
    </form>
  );
}
```

### Actions with Client Components

```tsx
// app/actions.ts
'use server';

export async function updateUser(userId: string, data: Partial<User>) {
  await db.user.update({ where: { id: userId }, data });
  revalidatePath('/profile');
}

// components/profile-form.tsx
'use client';

import { updateUser } from '@/app/actions';
import { useTransition } from 'react';

export function ProfileForm({ user }: { user: User }) {
  const [isPending, startTransition] = useTransition();
  
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    startTransition(async () => {
      await updateUser(user.id, {
        name: formData.get('name') as string,
      });
    });
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input name="name" defaultValue={user.name} disabled={isPending} />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
```

### Optimistic Updates

```tsx
'use client';

import { useOptimistic } from 'react';
import { likePost } from '@/app/actions';

export function LikeButton({ post }: { post: Post }) {
  const [optimisticLikes, addOptimisticLike] = useOptimistic(
    post.likes,
    (current, increment: number) => current + increment
  );
  
  return (
    <form action={async () => {
      addOptimisticLike(1);
      await likePost(post.id);
    }}>
      <button type="submit">
        ❤️ {optimisticLikes}
      </button>
    </form>
  );
}
```

## Caching Strategies

### Request Memoization

```tsx
// This function is automatically memoized per request
async function getUser(id: string) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}

// Both calls share the same request
async function Page() {
  const user = await getUser('1'); // Fetches
  return <Profile user={user} />;
}

async function Profile({ user }: { user: User }) {
  const sameUser = await getUser('1'); // Reuses cached result
  return <div>{sameUser.name}</div>;
}
```

### Data Cache Control

```tsx
// Cache indefinitely (default)
fetch('/api/data');

// Revalidate every 60 seconds
fetch('/api/data', { next: { revalidate: 60 } });

// No cache
fetch('/api/data', { cache: 'no-store' });

// Using unstable_cache for non-fetch data
import { unstable_cache } from 'next/cache';

const getCachedUser = unstable_cache(
  async (id: string) => db.user.findUnique({ where: { id } }),
  ['user'],
  { revalidate: 3600, tags: ['user'] }
);
```

### On-Demand Revalidation

```tsx
'use server';

import { revalidatePath, revalidateTag } from 'next/cache';

export async function updatePost(id: string, data: PostData) {
  await db.post.update({ where: { id }, data });
  
  // Revalidate specific path
  revalidatePath(`/posts/${id}`);
  
  // Or revalidate by tag
  revalidateTag('posts');
}
```

## Performance Patterns

### Partial Prerendering (PPR)

```tsx
// next.config.js
module.exports = {
  experimental: {
    ppr: true,
  },
};

// app/page.tsx - Static shell with dynamic holes
export default function Page() {
  return (
    <main>
      <StaticHeader /> {/* Prerendered */}
      
      <Suspense fallback={<ProductSkeleton />}>
        <DynamicProducts /> {/* Streams in */}
      </Suspense>
      
      <StaticFooter /> {/* Prerendered */}
    </main>
  );
}
```

### Preloading Data

```tsx
// lib/data.ts
import { cache } from 'react';

export const getUser = cache(async (id: string) => {
  return db.user.findUnique({ where: { id } });
});

export const preloadUser = (id: string) => {
  void getUser(id);
};

// app/user/[id]/page.tsx
import { preloadUser, getUser } from '@/lib/data';

export default async function UserPage({ params }: { params: { id: string } }) {
  // Start fetching early
  preloadUser(params.id);
  
  // Do other work...
  const otherData = await fetchOtherData();
  
  // Data is likely already cached
  const user = await getUser(params.id);
  
  return <Profile user={user} otherData={otherData} />;
}
```

### Route Segment Config

```tsx
// app/dashboard/layout.tsx
export const dynamic = 'force-dynamic'; // Always dynamic
export const revalidate = 60; // Revalidate every 60s
export const fetchCache = 'force-no-store'; // No caching

// app/blog/[slug]/page.tsx
export const dynamic = 'force-static'; // Always static
export const dynamicParams = true; // Generate on-demand if not in generateStaticParams
```

## Common Pitfalls

```tsx
// ❌ Importing client component in server without boundary
import { ClientForm } from './client-form';
// This works but the entire subtree becomes client-rendered

// ✅ Pass server data as props instead
<ClientForm initialData={await getData()} />

// ❌ Trying to pass functions to client components
<ClientButton onClick={serverFunction} /> // Functions aren't serializable!

// ✅ Use server actions instead
<ClientButton action={serverAction} />

// ❌ Using hooks in server components
export default function Page() {
  const [state, setState] = useState(); // Error!
}

// ❌ Accessing request-time data in client components
'use client';
import { cookies } from 'next/headers'; // Won't work!

// ✅ Pass from server parent
// page.tsx (server)
const session = cookies().get('session');
return <ClientComponent session={session} />;
```
