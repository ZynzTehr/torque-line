"use client";

import { useState } from "react";
import { setFleetStatusAction } from "@/app/(app)/admin/actions";
import { Sheet } from "@/components/ui/Sheet";
import type { FleetStatus } from "@/server/fleetStore";

/** Reactivating is one tap; deactivating asks for confirmation and an optional note, such as the payment reason. */
export function FleetStatusControl({ fleetId, email, status }: { fleetId: string; email: string; status: FleetStatus }) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: FleetStatus) {
    setPending(true);
    setError(null);
    const r = await setFleetStatusAction(fleetId, next, next === "inactive" ? note : undefined);
    setPending(false);
    if (!r.ok) { setError(r.message); return; }
    setConfirming(false);
    setNote("");
  }

  if (status === "inactive") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => apply("active")}>
          {pending ? "Saving…" : "Reactivate"}
        </button>
        {error && <p role="alert" className="text-danger text-xs">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(true)}>Deactivate</button>
      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Deactivate account?"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn btn-danger" disabled={pending} onClick={() => apply("inactive")}>
              {pending ? "Deactivating…" : "Deactivate"}
            </button>
          </div>
        }>
        <p className="text-secondary mb-4 text-sm">
          <strong className="text-fg">{email}</strong> won&apos;t be able to use Torqueline until you reactivate the account. Their data stays as it is.
        </p>
        <label className="form-label" htmlFor={`note-${fleetId}`}>Reason (optional, only admins see it)</label>
        <input id={`note-${fleetId}`} className="form-input" value={note} maxLength={500} placeholder="Payment overdue"
          onChange={(e) => setNote(e.target.value)} />
        {error && <p role="alert" className="text-danger mt-2 text-sm">{error}</p>}
      </Sheet>
    </>
  );
}
