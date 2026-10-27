"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reopenAccountAction } from "@/app/account-closed/actions";

/** Reopens a closed account or cancels a scheduled deletion, then opens the dashboard. */
export function ReopenAccountButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setPending(true);
    setError(null);
    const r = await reopenAccountAction();
    if (r.ok) return router.replace("/dashboard");
    setError(r.message);
    setPending(false);
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={reopen} disabled={pending}>{pending ? "Restoring…" : label}</button>
      {error && <p role="alert" className="text-danger mt-2 text-sm">{error}</p>}
    </>
  );
}
