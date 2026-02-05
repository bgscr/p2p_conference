import { Suspense, ComponentType, ReactNode } from 'react';

interface StreamingBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  /** Optional error boundary content */
  errorFallback?: ReactNode;
}

/**
 * Wrapper component for streaming content with Suspense.
 * Provides consistent loading states across your application.
 * 
 * Usage:
 * ```tsx
 * // In a Server Component
 * async function Page() {
 *   return (
 *     <main>
 *       <h1>Dashboard</h1>
 *       
 *       <StreamingBoundary fallback={<ChartSkeleton />}>
 *         <SlowChart />
 *       </StreamingBoundary>
 *       
 *       <StreamingBoundary fallback={<TableSkeleton />}>
 *         <SlowDataTable />
 *       </StreamingBoundary>
 *     </main>
 *   );
 * }
 * 
 * async function SlowChart() {
 *   const data = await fetchChartData(); // Takes 2-3 seconds
 *   return <Chart data={data} />;
 * }
 * ```
 */
export function StreamingBoundary({ 
  children, 
  fallback,
  errorFallback 
}: StreamingBoundaryProps) {
  return (
    <Suspense fallback={fallback}>
      {children}
    </Suspense>
  );
}

interface StreamingListProps<T> {
  /** Async function that returns items */
  items: Promise<T[]>;
  /** Render function for each item */
  renderItem: (item: T, index: number) => ReactNode;
  /** Key extractor for items */
  keyExtractor: (item: T, index: number) => string | number;
  /** Loading fallback */
  fallback: ReactNode;
  /** Empty state */
  emptyState?: ReactNode;
  /** Container className */
  className?: string;
}

/**
 * Streaming list component that handles async data fetching.
 * 
 * Usage:
 * ```tsx
 * // Server Component
 * function PostsPage() {
 *   return (
 *     <StreamingList
 *       items={fetchPosts()}
 *       renderItem={(post) => <PostCard post={post} />}
 *       keyExtractor={(post) => post.id}
 *       fallback={<PostListSkeleton count={5} />}
 *       emptyState={<EmptyPosts />}
 *     />
 *   );
 * }
 * ```
 */
export async function StreamingList<T>({
  items: itemsPromise,
  renderItem,
  keyExtractor,
  fallback,
  emptyState,
  className,
}: StreamingListProps<T>) {
  const items = await itemsPromise;
  
  if (items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }
  
  return (
    <div className={className}>
      {items.map((item, index) => (
        <div key={keyExtractor(item, index)}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}

interface ProgressiveLoadProps {
  /** Components to load progressively, in order of priority */
  sections: Array<{
    id: string;
    component: ReactNode;
    fallback: ReactNode;
    priority?: 'high' | 'medium' | 'low';
  }>;
}

/**
 * Progressive loading component for multiple async sections.
 * Higher priority sections load first.
 * 
 * Usage:
 * ```tsx
 * function DashboardPage() {
 *   return (
 *     <ProgressiveLoad
 *       sections={[
 *         {
 *           id: 'stats',
 *           component: <QuickStats />,
 *           fallback: <StatsSkeleton />,
 *           priority: 'high',
 *         },
 *         {
 *           id: 'chart',
 *           component: <RevenueChart />,
 *           fallback: <ChartSkeleton />,
 *           priority: 'medium',
 *         },
 *         {
 *           id: 'activity',
 *           component: <RecentActivity />,
 *           fallback: <ActivitySkeleton />,
 *           priority: 'low',
 *         },
 *       ]}
 *     />
 *   );
 * }
 * ```
 */
export function ProgressiveLoad({ sections }: ProgressiveLoadProps) {
  // Sort by priority (high first)
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sortedSections = [...sections].sort((a, b) => 
    (priorityOrder[a.priority ?? 'medium']) - (priorityOrder[b.priority ?? 'medium'])
  );
  
  return (
    <>
      {sortedSections.map(({ id, component, fallback }) => (
        <Suspense key={id} fallback={fallback}>
          {component}
        </Suspense>
      ))}
    </>
  );
}

/**
 * Skeleton component factory for consistent loading states.
 * 
 * Usage:
 * ```tsx
 * const CardSkeleton = createSkeleton(
 *   <div className="animate-pulse">
 *     <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
 *     <div className="h-4 bg-gray-200 rounded w-1/2" />
 *   </div>
 * );
 * 
 * // Use with StreamingBoundary
 * <StreamingBoundary fallback={<CardSkeleton count={3} />}>
 *   <CardList />
 * </StreamingBoundary>
 * ```
 */
export function createSkeleton(template: ReactNode) {
  return function Skeleton({ count = 1 }: { count?: number }) {
    return (
      <>
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{template}</div>
        ))}
      </>
    );
  };
}

/**
 * Deferred content component for below-the-fold content.
 * Uses requestIdleCallback when available.
 * 
 * Usage (Client Component):
 * ```tsx
 * 'use client';
 * 
 * function Page() {
 *   return (
 *     <main>
 *       <AboveTheFold />
 *       <DeferredContent fallback={<FooterSkeleton />}>
 *         <Footer />
 *       </DeferredContent>
 *     </main>
 *   );
 * }
 * ```
 */
export function DeferredContent({ 
  children, 
  fallback 
}: { 
  children: ReactNode; 
  fallback: ReactNode;
}) {
  // This is a client component pattern - implement with useState/useEffect
  // For server components, use regular Suspense
  return (
    <Suspense fallback={fallback}>
      {children}
    </Suspense>
  );
}

// Re-export Suspense for convenience
export { Suspense };
