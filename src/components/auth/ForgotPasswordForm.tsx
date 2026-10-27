"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { orThrow, passwordFailureMessage } from "@/lib/auth/errors";
import { LOGIN_URL, RESET_PASSWORD_URL } from "@/lib/auth/routes";

/**
 * Asks Neon Auth to email a reset link. The service answers the same way whether or not the address has an
 * account, and so does this form, so it can't be used to find out who has one.
 */
export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      // Absolute: the emailed link is opened on the auth service's domain and redirects back here.
      orThrow(await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}${RESET_PASSWORD_URL}` }));
      setSentTo(email);
    } catch (caught) {
      console.error("Password reset request failed", caught);
      setError(passwordFailureMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <>
        <p role="status" className="mb-6 text-sm">
          If <strong>{sentTo}</strong> has an account, we sent it a link to reset the password. The link works for one hour.
        </p>
        <Link className="btn btn-secondary w-full" href={LOGIN_URL}>Back to sign in</Link>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-describedby={error ? "forgot-error" : undefined}>
      <div className="form-group">
        <label className="form-label" htmlFor="email">Email</label>
        <input className="form-input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {error && <p id="forgot-error" role="alert" className="text-danger mb-4 text-sm">{error}</p>}
      <button className="btn btn-primary w-full" type="submit" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
      <p className="text-secondary mt-4 text-center text-sm">
        <Link className="text-accent" href={LOGIN_URL}>Back to sign in</Link>
      </p>
    </form>
  );
}
