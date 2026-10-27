"use client";

import { useState } from "react";
import { deleteFuelStopAction } from "@/app/(app)/actions";
import { Sheet } from "@/components/ui/Sheet";
import { SwipeRow } from "@/components/ui/SwipeRow";

export function FuelStopRow({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <SwipeRow label={label} actions={[{ label: "Delete", tone: "danger", onSelect: () => setConfirm(true) }]}>{children}</SwipeRow>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Delete this fuel stop?"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>Keep it</button>
          <button type="button" className="btn btn-danger" onClick={async () => { await deleteFuelStopAction(id); setConfirm(false); }}>Delete</button>
        </>}>
        <p className="text-secondary text-sm">This removes the stop and its product lines from fuel spend. Meter readings already recorded stay in history.</p>
      </Sheet>
    </>
  );
}
