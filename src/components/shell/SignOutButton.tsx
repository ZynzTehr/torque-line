"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { authClient } from "@/lib/auth/client";
import { authFailureMessage } from "@/lib/auth/errors";
import { LOGIN_URL } from "@/lib/auth/routes";

/**
 * Ends the session, then loads the sign-in page with a full navigation so no signed-in page
 * stays in the client router cache.
 */
export function SignOutButton({ className }: { className: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      await authClient.signOut();
      window.location.assign(LOGIN_URL);
    } catch (caught) {
      console.error("Sign-out failed", caught);
      setError(authFailureMessage(caught));
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={signOut} disabled={pending}>
        <Icon name="logout" /><span>{pending ? "Signing out…" : "Sign out"}</span>
      </button>
      {error && <p role="alert" className="text-danger mt-2 text-sm">{error}</p>}
    </>
  );
}
