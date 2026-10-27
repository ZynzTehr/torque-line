"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { codeFailureMessage, orThrow } from "@/lib/auth/errors";
import { LOGIN_URL } from "@/lib/auth/routes";

/** Seconds between code emails. The auth service rate-limits sends too; this keeps people from hitting it. */
const RESEND_AFTER = 60;

/**
 * Sends a 6-digit code to `email` on arrival and checks it. Neon Auth signs the user in when the code is right
 * (auto sign-in after verification); if that's ever turned off, the user is sent to sign in instead.
 */
export function VerifyEmailForm({ email }: { email: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sentOnArrival = useRef(false);

  const send = useCallback(async () => {
    setError(null);
    setWait(RESEND_AFTER);
    try {
      orThrow(await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" }));
      setSent(true);
    } catch (caught) {
      console.error("Sending the verification code failed", caught);
      setError(codeFailureMessage(caught));
    }
  }, [email]);

  useEffect(() => {
    if (sentOnArrival.current) return;
    sentOnArrival.current = true;
    void send();
  }, [send]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = orThrow(await authClient.emailOtp.verifyEmail({ email, otp: code }));
      if (!data?.token) {
        router.push(`${LOGIN_URL}?notice=verified`);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      console.error("Email code check failed", caught);
      setError(codeFailureMessage(caught));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-describedby={error ? "verify-error" : undefined}>
      <p role="status" className="text-secondary mb-4 text-sm">
        {sent ? <>We sent a 6-digit code to <strong className="text-fg">{email}</strong>. It works for 5 minutes.</> : `Sending a code to ${email}…`}
      </p>
      <div className="form-group">
        <label className="form-label" htmlFor="code">Code</label>
        <input className="form-input font-mono tracking-widest" id="code" name="code" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      </div>
      {error && <p id="verify-error" role="alert" className="text-danger mb-4 text-sm">{error}</p>}
      <button className="btn btn-primary w-full" type="submit" disabled={pending || code.length !== 6}>{pending ? "Checking…" : "Verify email"}</button>
      <button className="btn btn-ghost mt-2 w-full" type="button" onClick={send} disabled={wait > 0}>
        {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
      </button>
      <p className="text-secondary mt-4 text-center text-sm">
        <Link className="text-accent" href={LOGIN_URL}>Back to sign in</Link>
      </p>
    </form>
  );
}
