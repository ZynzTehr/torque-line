"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Sheet } from "@/components/ui/Sheet";
import { authClient } from "@/lib/auth/client";
import { checkNewPassword, orThrow, passwordFailureMessage } from "@/lib/auth/errors";

/** Settings button and sheet to change the password. Every other device is signed out; this one stays signed in. */
export function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const close = () => { setOpen(false); setCurrent(""); setNext(""); setConfirm(""); setError(null); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = checkNewPassword(next, confirm);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    try {
      orThrow(await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true }));
      setDone(true);
      close();
    } catch (caught) {
      console.error("Password change failed", caught);
      setError(passwordFailureMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => { setDone(false); setOpen(true); }}>
        <Icon name="lock" /><span>Change password</span>
      </button>
      {done && <p role="status" className="text-success mt-2 text-sm">Password changed. Other devices are signed out.</p>}
      <Sheet open={open} onClose={close} title="Change password"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="submit" form="change-password-form" className="btn btn-primary" disabled={pending || !current || !next || !confirm}>
            {pending ? "Saving…" : "Change password"}
          </button>
        </>}>
        <form id="change-password-form" onSubmit={submit} className="flex flex-col gap-4">
          <PasswordInput id="current-password" label="Current password" autoComplete="current-password" value={current} onChange={setCurrent} />
          <PasswordInput id="new-password" label="New password" autoComplete="new-password" value={next} onChange={setNext} />
          <PasswordInput id="confirm-password" label="Confirm new password" autoComplete="new-password" value={confirm} onChange={setConfirm} />
          <p className="text-secondary text-sm">8 to 128 characters. Other devices will be signed out.</p>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
        </form>
      </Sheet>
    </>
  );
}
