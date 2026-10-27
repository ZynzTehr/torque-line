"use client";

import { useState } from "react";
import { deleteScheduleAction, updateScheduleAction } from "@/app/(app)/actions";
import { Sheet } from "@/components/ui/Sheet";
import { SwipeRow } from "@/components/ui/SwipeRow";
import type { BoardEquipment, BoardSchedule } from "@/domain/workboard";
import { LogServiceSheet } from "./LogServiceSheet";

/** One schedule line: log it, pause or resume it, or remove it (with confirmation). */
export function ScheduleItemRow({ unit, schedules, item, children }: {
  unit: BoardEquipment; schedules: BoardSchedule[]; item: BoardSchedule; children: React.ReactNode;
}) {
  const [sheet, setSheet] = useState<"service" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    const r = await updateScheduleAction(item.id, { enabled: !item.enabled });
    if (!r.ok) setError(r.message);
  };
  return (
    <>
      <SwipeRow label={item.name} actions={[
        { label: "Log", onSelect: () => setSheet("service") },
        { label: item.enabled ? "Pause" : "Resume", onSelect: toggle },
        { label: "Remove", tone: "danger", onSelect: () => setSheet("delete") },
      ]}>{children}</SwipeRow>
      {error && <p role="alert" className="text-danger px-2 text-xs">{error}</p>}
      <LogServiceSheet unit={unit} schedules={schedules} scheduleId={item.id} open={sheet === "service"} onClose={() => setSheet(null)} />
      <Sheet open={sheet === "delete"} onClose={() => setSheet(null)} title="Remove schedule item?"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setSheet(null)}>Keep it</button>
          <button type="button" className="btn btn-danger" onClick={async () => {
            const r = await deleteScheduleAction(item.id);
            if (!r.ok) setError(r.message);
            setSheet(null);
          }}>Remove</button>
        </>}>
        <p className="text-secondary text-sm">{item.name} will stop appearing on the workboard. Service records already logged stay in the history.</p>
      </Sheet>
    </>
  );
}
