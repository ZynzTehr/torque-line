"use client";

import { useState } from "react";
import { deleteServiceRecordAction } from "@/app/(app)/actions";
import { Sheet } from "@/components/ui/Sheet";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { formatCurrency, formatDate } from "@/domain/format";
import type { BoardEquipment, BoardSchedule } from "@/domain/workboard";
import { LogServiceSheet, type EditableServiceRecord } from "./LogServiceSheet";

/**
 * One service record with Edit and Delete (swipe on phones, inline on wider screens) and its receipt.
 * `unit` is null when the unit was removed: its history can still be deleted but not edited.
 */
export function ServiceRecordItem({ record, unit, schedules, children }: {
  record: EditableServiceRecord; unit: BoardEquipment | null; schedules: BoardSchedule[]; children: React.ReactNode;
}) {
  const [sheet, setSheet] = useState<"edit" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const actions = [
    ...(unit ? [{ label: "Edit", onSelect: () => setSheet("edit") }] : []),
    { label: "Delete", tone: "danger" as const, onSelect: () => setSheet("delete") },
  ];
  return (
    <>
      <SwipeRow label={record.serviceType} actions={actions}>
        <div className="flex min-w-0 items-start gap-3 px-1">
          <div className="min-w-0 flex-1">{children}</div>
          {record.receiptId && (
            <a href={`/api/attachments/${record.receiptId}`} target="_blank" rel="noopener" className="shrink-0" aria-label={`Receipt for ${record.serviceType}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated attachment, not an optimizable asset */}
              <img src={`/api/attachments/${record.receiptId}`} alt="" className="h-10 w-10 rounded border border-line object-cover" loading="lazy" />
            </a>
          )}
        </div>
      </SwipeRow>
      {error && <p role="alert" className="text-danger px-2 text-xs">{error}</p>}
      {unit && <LogServiceSheet unit={unit} schedules={schedules} record={record} open={sheet === "edit"} onClose={() => setSheet(null)} />}
      <Sheet open={sheet === "delete"} onClose={() => setSheet(null)} title="Delete this service record?"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setSheet(null)}>Keep it</button>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={async () => {
            setPending(true);
            const r = await deleteServiceRecordAction(record.id);
            setPending(false);
            setError(r.ok ? null : r.message);
            setSheet(null);
          }}>Delete</button>
        </>}>
        <p className="text-secondary text-sm">
          {record.serviceType} on {formatDate(record.date)}{record.cost != null ? `, ${formatCurrency(record.cost)}` : ""} will be removed, with its receipt photo. This can&apos;t be undone.
          {record.scheduleId && " The schedule item it completed goes back to its previous logged service."}
        </p>
      </Sheet>
    </>
  );
}
