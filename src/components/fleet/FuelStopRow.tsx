"use client";

import { useState } from "react";
import { deleteFuelStopAction } from "@/app/(app)/actions";
import { Sheet } from "@/components/ui/Sheet";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { formatCurrency, formatDate } from "@/domain/format";
import { AddFuelStopSheet, type EditableFuelStop } from "./AddFuelStopSheet";

type UnitOption = { id: string; unitNumber: string };

/**
 * One fuel stop with Edit and Delete (swipe on phones, inline on wider screens) and its receipt.
 * `editable` is false when a unit on the stop was removed; the stop can still be deleted.
 */
export function FuelStopRow({ stop, total, editable, tractors, reefers, children }: {
  stop: EditableFuelStop; total: number; editable: boolean; tractors: UnitOption[]; reefers: UnitOption[]; children: React.ReactNode;
}) {
  const [sheet, setSheet] = useState<"edit" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const label = `Fuel stop ${formatDate(stop.date)}`;
  return (
    <>
      <SwipeRow label={label} actions={[
        ...(editable ? [{ label: "Edit", onSelect: () => setSheet("edit") }] : []),
        { label: "Delete", tone: "danger" as const, onSelect: () => setSheet("delete") },
      ]}>
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">{children}</div>
          {stop.receiptId && (
            <a href={`/api/attachments/${stop.receiptId}`} target="_blank" rel="noopener" className="shrink-0" aria-label={`Receipt for ${label}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated attachment, not an optimizable asset */}
              <img src={`/api/attachments/${stop.receiptId}`} alt="" className="h-10 w-10 rounded border border-line object-cover" loading="lazy" />
            </a>
          )}
        </div>
      </SwipeRow>
      {error && <p role="alert" className="text-danger px-2 text-xs">{error}</p>}
      {/* Keyed by content so reopening after a save starts from the saved values. */}
      {editable && <AddFuelStopSheet key={JSON.stringify(stop)} existing={stop} tractors={tractors} reefers={reefers} open={sheet === "edit"} onClose={() => setSheet(null)} />}
      <Sheet open={sheet === "delete"} onClose={() => setSheet(null)} title="Delete this fuel stop?"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setSheet(null)}>Keep it</button>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={async () => {
            setPending(true);
            const r = await deleteFuelStopAction(stop.id);
            setPending(false);
            setError(r.ok ? null : r.message);
            setSheet(null);
          }}>Delete</button>
        </>}>
        <p className="text-secondary text-sm">
          The {formatDate(stop.date)} stop{stop.station ? ` at ${stop.station}` : ""} ({formatCurrency(total)}) and its receipt photo will be removed from fuel spend.
          Meter readings already recorded stay in history. This can&apos;t be undone.
        </p>
      </Sheet>
    </>
  );
}
