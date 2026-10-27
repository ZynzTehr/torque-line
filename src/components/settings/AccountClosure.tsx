"use client";

import { useState, type FormEvent } from "react";
import { closeAccountAction, deleteAccountAction } from "@/app/(app)/settings/actions";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Sheet } from "@/components/ui/Sheet";
import { LOGIN_URL } from "@/lib/auth/routes";

type Step = "close" | "delete" | null;

/** Offered before either action. No `download` attribute, as on Settings: the route's headers save the zip. */
function DownloadFirst() {
  return (
    <p className="text-secondary mb-4 text-sm">
      Want a copy first? <a className="text-accent underline" href="/api/export">Download my data</a>
    </p>
  );
}

/**
 * Settings danger zone. Closing keeps everything and is undone by signing in again; deleting asks for the
 * account's email and password, then erases everything 30 days later unless the owner signs in and restores it.
 * Both sign the account out everywhere, so the next page is a full load of the sign-in page.
 */
export function AccountClosure({ email }: { email: string }) {
  const [open, setOpen] = useState<Step>(null);
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { if (pending) return; setOpen(null); setTypedEmail(""); setPassword(""); setError(null); };
  const emailMatches = typedEmail.trim().toLowerCase() === email.toLowerCase();

  async function run(action: () => ReturnType<typeof closeAccountAction>, notice: string) {
    setPending(true);
    setError(null);
    const r = await action();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load on purpose, like SignOutButton: no signed-in page may stay in the client router cache
    if (r.ok) return window.location.assign(`${LOGIN_URL}?notice=${notice}`);
    setError(r.message);
    setPending(false);
  }

  function submitDelete(event: FormEvent) {
    event.preventDefault();
    if (emailMatches && password) void run(() => deleteAccountAction({ email: typedEmail, password }), "deletion-scheduled");
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => setOpen("close")}>Close account</button>
        <button type="button" className="btn btn-danger" onClick={() => setOpen("delete")}>Delete account</button>
      </div>

      <Sheet open={open === "close"} onClose={close} title="Close your account?"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => run(closeAccountAction, "account-closed")}>
            {pending ? "Closing…" : "Close account"}
          </button>
        </>}>
        <p className="text-secondary mb-4 text-sm">
          You&apos;ll be signed out on every device. Nothing is deleted: sign in any time and choose Reopen to pick up where you left off.
        </p>
        <DownloadFirst />
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      </Sheet>

      <Sheet open={open === "delete"} onClose={close} title="Delete your account?"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="submit" form="delete-account-form" className="btn btn-danger" disabled={pending || !emailMatches || !password}>
            {pending ? "Deleting…" : "Delete account"}
          </button>
        </>}>
        <form id="delete-account-form" onSubmit={submitDelete} className="flex flex-col gap-4">
          <p className="text-secondary text-sm">
            You&apos;ll be signed out now, and in 30 days your units, records, receipts and diagnoses are erased for good.
            Sign in before then to restore everything.
          </p>
          <DownloadFirst />
          <div className="form-group">
            <label className="form-label" htmlFor="delete-email">Type your email to confirm</label>
            <input id="delete-email" className="form-input" type="email" autoComplete="off" placeholder={email}
              value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} />
          </div>
          <PasswordInput id="delete-password" label="Password" autoComplete="current-password" value={password} onChange={setPassword} />
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
        </form>
      </Sheet>
    </>
  );
}
