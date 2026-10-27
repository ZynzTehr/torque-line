"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/** Browser auth client; calls are proxied through /api/auth. */
export const authClient = createAuthClient();
