"use client";

import { useState, type FormEvent } from "react";
import { logServiceAction } from "@/app/(app)/actions";
import { Sheet } from "@/components/ui/Sheet";
import { formatCurrency, formatDate } from "@/domain/format";
import type { BoardEquipment, BoardSchedule } from "@/domain/workboard";

const today = () => new Date().toLocaleDateString("en-CA");

/** Log a completed service. Linking a schedule item resets its baseline; same-day duplicates ask first. */
export function LogServiceSheet({ unit, schedules, scheduleId, open, onClose }: {
  unit: BoardEquipment; schedules: BoardSchedule[]; scheduleId?: string; open: boolean; onClose: () => void;
}) {
  const [duplicate, setDuplicate] = useState<{ date: string; serviceType: string; cost: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const close = () => { setDuplicate(null); setError(null); onClose(); };
  const meter = unit.type === "trailer" ? null : unit.type === "reefer" ? "Engine hours" : "Odometer";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : undefined);
    setPending(true);
    setError(null);
    const result = await logServiceAction({
      equipmentId: unit.id,
      scheduleId: (f.get("scheduleId") as string) || undefined,
      serviceType: (f.get("serviceType") as string) || undefined,
      date: String(f.get("date")),
      reading: num("reading"),
      cost: num("cost"),
      shop: (f.get("shop") as string) || undefined,
      notes: (f.get("notes") as string) || undefined,
      confirmDuplicate: duplicate !== null,
    });
    setPending(false);
    if (result.ok) return close();
    if (result.code === "possible-duplicate") { setDuplicate(result.existing); return; }
    setError(result.message);
  }

  return (
    <Sheet open={open} onClose={close} title={`Log service · Unit ${unit.unitNumber}`}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
        <button type="submit" form="service-form" className="btn btn-primary" disabled={pending}>{duplicate ? "Save separate entry" : "Save service"}</button>
      </>}>
      <form id="service-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="form-group">
          <label className="form-label" htmlFor="svc-schedule">Schedule item</label>
          <select id="svc-schedule" name="scheduleId" className="form-select" defaultValue={scheduleId ?? ""}>
            <option value="">Not on the schedule</option>
            {schedules.filter((s) => s.equipmentId === unit.id).map((s) => <option key={s.id} value={s.id}>{s.category} · {s.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="svc-type">Service</label>
          <input id="svc-type" name="serviceType" className="form-input" placeholder="Defaults to the schedule item's name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label" htmlFor="svc-date">Date</label>
            <input id="svc-date" name="date" type="date" className="form-input" required defaultValue={today()} />
          </div>
          {meter && (
            <div className="form-group">
              <label className="form-label" htmlFor="svc-reading">{meter}</label>
              <input id="svc-reading" name="reading" className="form-input font-mono" inputMode="numeric" pattern="[0-9]*"
                defaultValue={(unit.type === "reefer" ? unit.currentHours : unit.currentMileage) ?? ""} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="svc-cost">Cost (USD)</label>
            <input id="svc-cost" name="cost" className="form-input font-mono" inputMode="decimal" pattern="[0-9]*[.]?[0-9]{0,2}" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="svc-shop">Shop</label>
            <input id="svc-shop" name="shop" className="form-input" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="svc-notes">Notes</label>
          <textarea id="svc-notes" name="notes" className="form-textarea" rows={2} />
        </div>
        {duplicate && (
          <div role="alert" className="alert-item alert-item-yellow flex-col items-start gap-1">
            <strong>A matching service is already logged for this day.</strong>
            <span className="text-sm">{duplicate.serviceType} on {formatDate(duplicate.date)}{duplicate.cost != null ? `, ${formatCurrency(duplicate.cost)}` : ""}. Save a separate entry only if both really happened.</span>
          </div>
        )}
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      </form>
    </Sheet>
  );
}
