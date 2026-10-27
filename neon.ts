import { defineConfig } from "@neon/config/v1";

/**
 * Services every branch of this project gets. Apply with `neon deploy`.
 * - auth: Managed Better Auth (email and password sign-in).
 * - attachments: private bucket for diagnostic photos and receipts; keys are prefixed with the fleet id.
 * Not declared: aiGateway (needs a paid Neon plan; the app calls Claude directly), functions and
 * realtime (no feature uses them yet).
 */
export default defineConfig({
  auth: true,
  buckets: {
    attachments: { access: "private" },
  },
});
