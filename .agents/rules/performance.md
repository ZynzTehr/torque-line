---
trigger: model_decision
description: "Apply when measuring or improving latency, throughput, memory use, loading time, or bundle size."
---

# Performance

Performance is measured, not guessed. Profile before optimizing. One change at a time. Measure after each.

## Frontend performance

### Bundle size
- Set a budget and enforce it. Track total JS shipped to the client per route.
- Tree-shake aggressively. Named imports (`import { x } from`) over namespace imports (`import * as`).
- Lazy-load routes and heavy components. The initial bundle should contain only what the first screen needs.
- Audit dependencies with bundlephobia or `npm pack`. A 300KB library for one utility function is a performance bug.

### Loading
- Prioritize above-the-fold content. Use `fetchpriority="high"` on the hero image, `loading="lazy"` on everything below the fold.
- Preload critical resources: fonts, hero images, key data fetches. Use `<link rel="preload">` or `<link rel="preconnect">`.
- Inline critical CSS for the first paint. Defer non-critical stylesheets.
- Serve images in modern formats (WebP, AVIF) with appropriate sizing. Never serve a 4000px image in a 400px container.

### Runtime
- Avoid layout thrashing. Batch DOM reads before DOM writes.
- Debounce scroll and resize handlers. Use `requestAnimationFrame` for animation, `IntersectionObserver` for visibility.
- Virtualize long lists (100+ items). Render only what is visible.
- `will-change` is a hint, not a magic fix. Use it on the specific property, remove it after the animation completes.

### Core Web Vitals
- **LCP** (Largest Contentful Paint): < 2.5s. Optimize the hero element: preload, proper sizing, no render-blocking resources.
- **INP** (Interaction to Next Paint): < 200ms. Keep event handlers fast. Offload heavy computation to web workers.
- **CLS** (Cumulative Layout Shift): < 0.1. Set explicit dimensions on images and embeds. Reserve space for dynamic content.

## Backend performance

### Database
- Index columns used in WHERE, ORDER BY, and JOIN clauses.
- Use EXPLAIN/ANALYZE on slow queries before optimizing. Read the query plan.
- Avoid N+1 queries. Fetch related data in one query or use batch loading.
- Paginate result sets. Never return unbounded collections.

### API
- Set appropriate Cache-Control headers. Static assets get long TTLs with content hashing. API responses get short TTLs or no-cache where freshness matters.
- Compress responses (gzip/brotli). Most frameworks do this by default; verify it is enabled.
- Set timeouts on all outbound requests. A missing timeout is a resource leak waiting to happen.
- Use connection pooling for database connections. Do not open a new connection per request.

### Caching
- Cache at the right layer: CDN for static assets, in-memory for hot data, database query cache for expensive computations.
- Every cache needs an invalidation strategy. A cache without expiration or eviction is a stale data bug.
- Cache the computation, not the raw data. If you repeatedly transform the same data, cache the result.

## Process

1. **Measure first.** Identify the actual bottleneck. Do not optimize what you have not measured.
2. **Set a target.** "Faster" is not a goal. "LCP under 2s on 3G" is a goal.
3. **Change one thing.** Measure again with the same method. Attribute the improvement.
4. **Stop when the target is met.** Over-optimization is a maintenance cost with no user benefit.
