"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PasswordInput } from "./PasswordInput";
import { resetPasswordAction } from "@/app/auth/actions";
import { checkNewPassword, NETWORK_MESSAGE } from "@/lib/auth/errors";
import { FORGOT_PASSWORD_URL, LOGIN_URL } from "@/lib/auth/routes";

/**
 * Sets a new password with the token from the emailed link, which also signs the account out on every device.
 * `token` is null when the link was already rejected.
 */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [linkInvalid, setLinkInvalid] = useState(token === null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = checkNewPassword(password, confirm);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    try {
      const result = await resetPasswordAction(token!, password);
      if (result.ok) return router.push(`${LOGIN_URL}?notice=password-reset`);
      if (result.code === "invalid-link") return setLinkInvalid(true);
      setError(result.message);
    } catch (caught) {
      console.error("Password reset failed", caught);
      setError(NETWORK_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  if (linkInvalid) {
    return (
      <>
        <p role="alert" className="mb-6 text-sm">This reset link is invalid or has expired. Links work once, for one hour.</p>
        <Link className="btn btn-primary w-full" href={FORGOT_PASSWORD_URL}>Request a new link</Link>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-describedby={error ? "reset-error" : undefined}>
      <PasswordInput id="new-password" label="New password" autoComplete="new-password" value={password} onChange={setPassword} />
      <PasswordInput id="confirm-password" label="Confirm new password" autoComplete="new-password" value={confirm} onChange={setConfirm} />
      <p className="text-secondary mb-4 text-sm">8 to 128 characters.</p>
      {error && <p id="reset-error" role="alert" className="text-danger mb-4 text-sm">{error}</p>}
      <button className="btn btn-primary w-full" type="submit" disabled={pending}>{pending ? "Saving…" : "Save new password"}</button>
    </form>
  );
}
