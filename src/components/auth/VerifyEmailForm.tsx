"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { codeFailureMessage, isRateLimited, orThrow } from "@/lib/auth/errors";
import { LOGIN_URL } from "@/lib/auth/routes";
import { clearVerification, markCodeSent, pendingVerificationEmail, secondsUntilResend } from "@/lib/auth/verifyHandoff";

/** Seconds between code emails. The auth service rate-limits sends too; this keeps people from hitting it. */
const RESEND_AFTER = 60;

const noSubscribe = () => () => {};

/** The verify page: the code form for the address sign-up or sign-in handed over, or a pointer to sign in. */
export function VerifyEmail() {
  // Undefined while rendering on the server, where the tab's handoff can't be read.
  const email = useSyncExternalStore(noSubscribe, pendingVerificationEmail, () => undefined);
  if (email === undefined) return <p className="text-secondary text-sm">Loading…</p>;
  if (email === null) {
    return (
      <>
        <p className="text-secondary mb-6 text-sm">Sign in first and we&apos;ll send a code to your email.</p>
        <Link className="btn btn-primary w-full" href={LOGIN_URL}>Go to sign in</Link>
      </>
    );
  }
  return <VerifyEmailForm email={email} />;
}

type SendState = "sending" | "sent" | "failed";

/**
 * Sends a 6-digit code to `email` on arrival, unless one went out in the last minute (a reload or a second
 * sign-in keeps the code the user is waiting for), and checks it. Neon Auth signs the user in when the code is
 * right (auto sign-in after verification); if that's ever turned off, the user is sent to sign in instead.
 */
function VerifyEmailForm({ email }: { email: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [arrivalWait] = useState(() => secondsUntilResend(email, RESEND_AFTER));
  const [sendState, setSendState] = useState<SendState>(arrivalWait > 0 ? "sent" : "sending");
  const [wait, setWait] = useState(arrivalWait);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Separate from sendState, which stays "sent" during a resend: a second tap mid-request would send a second code.
  const [resending, setResending] = useState(false);
  const inFlight = useRef(false);
  const sentOnArrival = useRef(false);

  const send = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setResending(true);
    setError(null);
    setSendState((s) => (s === "sent" ? s : "sending"));
    try {
      orThrow(await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" }));
      markCodeSent(email);
      setSendState("sent");
      setWait(RESEND_AFTER);
    } catch (caught) {
      console.error("Sending the verification code failed", caught);
      setError(codeFailureMessage(caught));
      // An earlier code still works; only say nothing went out when nothing has.
      setSendState((s) => (s === "sent" ? s : "failed"));
      setWait(isRateLimited(caught) ? RESEND_AFTER : 0);
    } finally {
      inFlight.current = false;
      setResending(false);
    }
  }, [email]);

  useEffect(() => {
    if (sentOnArrival.current || arrivalWait > 0) return;
    sentOnArrival.current = true;
    void send();
  }, [send, arrivalWait]);

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
      clearVerification();
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
        {sendState === "sent" && <>We sent a 6-digit code to <strong className="text-fg">{email}</strong>. It works for 5 minutes.</>}
        {sendState === "sending" && `Sending a code to ${email}…`}
        {sendState === "failed" && <>We couldn&apos;t send a code to <strong className="text-fg">{email}</strong> yet.</>}
      </p>
      <div className="form-group">
        <label className="form-label" htmlFor="code">Code</label>
        <input className="form-input font-mono tracking-widest" id="code" name="code" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      </div>
      {error && <p id="verify-error" role="alert" className="text-danger mb-4 text-sm">{error}</p>}
      <button className="btn btn-primary w-full" type="submit" disabled={pending || code.length !== 6}>{pending ? "Checking…" : "Verify email"}</button>
      <button className="btn btn-ghost mt-2 w-full" type="button" onClick={send} disabled={wait > 0 || resending}>
        {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
      </button>
      <p className="text-secondary mt-4 text-center text-sm">
        <Link className="text-accent" href={LOGIN_URL}>Back to sign in</Link>
      </p>
    </form>
  );
}
