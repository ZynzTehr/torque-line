"use client";

import { useState, type FormEvent } from "react";
import { recordReadingAction } from "@/app/(app)/actions";
import { Sheet } from "@/components/ui/Sheet";
import { formatMileage } from "@/domain/format";
import type { BoardEquipment } from "@/domain/workboard";

/** Enter a meter reading. A lower value is never saved without an explicit, explained confirmation. */
export function ReadingSheet({ unit, open, onClose }: { unit: BoardEquipment; open: boolean; onClose: () => void }) {
  const hours = unit.type === "reefer";
  const suffix = hours ? "hrs" : "mi";
  const current = hours ? unit.currentHours : unit.currentMileage;
  const [value, setValue] = useState("");
  const [lower, setLower] = useState<{ current: number; next: number } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reset = () => { setValue(""); setLower(null); setNote(""); setError(null); };
  const close = () => { reset(); onClose(); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await recordReadingAction({
      equipmentId: unit.id, value: Number(value),
      ...(lower ? { confirmLower: true, note } : {}),
    });
    setPending(false);
    if (result.ok) return close();
    if (result.code === "needs-confirmation") { setLower({ current: result.current, next: result.next }); return; }
    setError(result.message);
  }

  return (
    <Sheet open={open} onClose={close} title={`Update reading · Unit ${unit.unitNumber}`}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
        <button type="submit" form="reading-form" className="btn btn-primary" disabled={pending || !value || (lower !== null && !note.trim())}>
          {lower ? "Save anyway" : "Save reading"}
        </button>
      </>}>
      <form id="reading-form" onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-secondary text-sm">On file: <strong className="text-fg">{current == null ? "No reading yet" : `${formatMileage(current)} ${suffix}`}</strong></p>
        <div className="form-group">
          <label className="form-label" htmlFor="reading-value">{hours ? "Engine hours" : "Odometer"}</label>
          <input id="reading-value" className="form-input font-mono" inputMode="numeric" pattern="[0-9]*" required
            value={value} onChange={(e) => { setValue(e.target.value.replace(/\D/g, "")); setLower(null); }} />
        </div>
        {lower && (
          <div role="alert" className="alert-item alert-item-yellow flex-col items-start gap-2">
            <strong>This reading is lower than the one on file.</strong>
            <span className="text-sm">New {formatMileage(lower.next)} {suffix}, on file {formatMileage(lower.current)} {suffix}. That usually means a typo. If the odometer was replaced or rolled over, say so below.</span>
            <label className="form-label mt-1" htmlFor="reading-note">Reason</label>
            <input id="reading-note" className="form-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Odometer replaced at 482,150" />
          </div>
        )}
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      </form>
    </Sheet>
  );
}
