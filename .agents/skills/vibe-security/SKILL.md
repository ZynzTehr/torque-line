---
name: vibe-security
description: Audits codebases for common security vulnerabilities introduced by AI coding assistants in vibe-coded applications. Checks for exposed API keys, broken access control (Supabase RLS, Firebase rules), missing server-side auth, client-side trust issues, and insecure payment flows. Use for /vibe-security, "vibe security", "audit vibe code", "check security anti-patterns", or reviewing AI-generated apps.
license: MIT
metadata:
  source: original
  status: stable
  reviewed: 2026-10-07
---

# Vibe Security

Audit code for vulnerabilities commonly introduced by AI code generation in fast-built or "vibe-coded" applications. AI assistants consistently get these patterns wrong: hardcoding secrets, skipping row-level security, trusting client-submitted prices, and storing tokens insecurely.

## The core principle

**Never trust the client.** Every price, user ID, role, subscription status, feature flag, and rate limit counter must be validated or enforced server-side. If it exists only in the browser, mobile bundle, or request body, an attacker controls it.

## Audit checklist

### 1. Secrets and environment variables
- Scan for hardcoded API keys, tokens, and database credentials.
- Check client-exposed prefix variables (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`). Never put service role keys or backend secrets in client variables.
- Ensure `.env` is listed in `.gitignore` and `.env.example` contains only placeholder names without actual keys.

### 2. Database access control (Supabase / Firebase / Convex)
- Verify Row-Level Security (RLS) is enabled on every Supabase table.
- Verify policies distinguish read and write operations; do not use `using (true)` for updates or deletes.
- In Firebase, verify security rules restrict read/write by `request.auth.uid`.
- Ensure client queries never rely on client-provided `user_id` when the server session holds the authenticated identity.

### 3. Authentication and authorization
- Enforce authentication and authorization server-side on every protected endpoint and Server Action.
- Verify JWT signatures and expirations on the backend.
- Avoid storing session secrets or refresh tokens in `localStorage`; prefer `httpOnly`, `secure`, `SameSite` cookies.

### 4. Rate limiting and abuse prevention
- Apply rate limits to public authentication routes, registration, password reset, and AI model endpoints.
- Store rate limit counters in Redis or database backends, not client-supplied request headers.

### 5. Payment security
- Never accept product prices, discounts, or plan amounts from the client request body. Look up the authoritative price server-side from Stripe or the product database.
- Always verify Stripe or webhook signatures using the raw request body before processing fulfillment events.

### 6. Mobile security (React Native / Expo)
- Never bundle private API keys in mobile JavaScript bundles (they can be extracted via reverse-engineering).
- Use platform secure storage (`expo-secure-store` or Keychain/Keystore) for tokens.
- Validate and sanitize parameters received from deep links.

### 7. AI / LLM integration
- Keep AI provider API keys on the server backend. Proxy user requests through authenticated endpoints with budget and rate limits.
- Separate system instructions from untrusted user content.
- Sanitize and escape rendered model outputs to prevent XSS.

### 8. Data access and boundary validation
- Validate all incoming payloads at the boundary using schema validators (Zod, Valibot, Pydantic).
- Use parameterized SQL queries or ORM query builders to prevent SQL injection.

## Output format

Group findings by severity: **Critical** -> **High** -> **Medium** -> **Low**.

For each finding:
1. File and line number.
2. Concrete impact (what an attacker can exploit).
3. Exact before and after remediation diff.
