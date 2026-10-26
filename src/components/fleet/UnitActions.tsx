"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyDefaultScheduleAction } from "@/app/(app)/actions";
import { SwipeRow } from "@/components/ui/SwipeRow";
import type { BoardEquipment, BoardSchedule } from "@/domain/workboard";
import { AddEquipmentSheet } from "./AddEquipmentSheet";
import { LogServiceSheet } from "./LogServiceSheet";
import { ReadingSheet } from "./ReadingSheet";

type Sheet = "reading" | "service" | null;

/** Buttons that open the reading or service sheet for one unit. */
export function UnitActions({ unit, schedules, scheduleId, show = ["reading", "service"], size = "sm" }: {
  unit: BoardEquipment; schedules: BoardSchedule[]; scheduleId?: string;
  show?: ("reading" | "service")[]; size?: "sm" | "md";
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cls = `btn btn-secondary${size === "sm" ? " btn-sm" : ""}`;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {show.includes("reading") && unit.type !== "trailer" && (
          <button type="button" className={cls} onClick={() => setSheet("reading")}>Update reading</button>
        )}
        {show.includes("service") && (
          <button type="button" className={cls} onClick={() => setSheet("service")}>Log service</button>
        )}
      </div>
      <ReadingSheet unit={unit} open={sheet === "reading"} onClose={() => setSheet(null)} />
      <LogServiceSheet unit={unit} schedules={schedules} scheduleId={scheduleId} open={sheet === "service"} onClose={() => setSheet(null)} />
    </>
  );
}

/** A unit row with swipe-to-reveal actions on phones and inline actions on wider screens. */
export function UnitRow({ unit, schedules, children }: { unit: BoardEquipment; schedules: BoardSchedule[]; children: React.ReactNode }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const actions = [
    ...(unit.type !== "trailer" ? [{ label: "Reading", onSelect: () => setSheet("reading") }] : []),
    { label: "Service", onSelect: () => setSheet("service") },
    { label: "Open", onSelect: () => router.push(`/equipment/${unit.id}`) },
  ];
  return (
    <>
      <SwipeRow label={`Unit ${unit.unitNumber}`} actions={actions}>{children}</SwipeRow>
      <ReadingSheet unit={unit} open={sheet === "reading"} onClose={() => setSheet(null)} />
      <LogServiceSheet unit={unit} schedules={schedules} open={sheet === "service"} onClose={() => setSheet(null)} />
    </>
  );
}

export function AddEquipmentButton({ label = "Add unit", primary = false }: { label?: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`btn ${primary ? "btn-primary" : "btn-ghost btn-sm"}`} onClick={() => setOpen(true)}>+ {label}</button>
      <AddEquipmentSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ApplyScheduleButton({ equipmentId }: { equipmentId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={async () => {
        setPending(true);
        const r = await applyDefaultScheduleAction(equipmentId);
        setPending(false);
        if (!r.ok) setError(r.message);
      }}>Set up schedule</button>
      {error && <span role="alert" className="text-danger text-xs">{error}</span>}
    </div>
  );
}
