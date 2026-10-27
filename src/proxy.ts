import type { NextRequest } from "next/server";
import { getAuth, LOGIN_URL } from "@/lib/auth/server";

/**
 * Redirects anonymous visitors away from app pages and refreshes sessions.
 * This is navigation only: every server action and route handler still checks the session itself.
 */
export function proxy(request: NextRequest) {
  return getAuth().middleware({ loginUrl: LOGIN_URL })(request);
}

export const config = {
  matcher: ["/dashboard/:path*", "/equipment/:path*", "/fuel/:path*", "/diagnostics/:path*", "/settings/:path*"],
};
