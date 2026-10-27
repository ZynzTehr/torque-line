"use client";

import { useRef, useState, type FormEvent } from "react";
import { attachReceiptAction, logServiceAction, removeAttachmentAction, updateServiceRecordAction } from "@/app/(app)/actions";
import { readServiceReceiptAction } from "@/app/(app)/ai-actions";
import { PhotoButton } from "./PhotoButton";
import { Sheet } from "@/components/ui/Sheet";
import { formatCurrency, formatDate, formatMileage } from "@/domain/format";
import type { BoardEquipment, BoardSchedule } from "@/domain/workboard";

const today = () => new Date().toLocaleDateString("en-CA");

/** The editable fields of a saved service record, plus its receipt photo if it has one. */
export interface EditableServiceRecord {
  id: string; scheduleId: string | null; date: string; serviceType: string;
  mileage: number | null; hours: number | null; cost: number | null; shop: string | null; notes: string | null;
  receiptId: string | null;
}

/**
 * Log a completed service, or edit one (`record`). Linking a schedule item resets its baseline; same-day
 * duplicates ask first. A receipt photo, read by the assistant or attached as is, is saved with the record.
 */
export function LogServiceSheet({ unit, schedules, scheduleId, record, open, onClose }: {
  unit: BoardEquipment; schedules: BoardSchedule[]; scheduleId?: string; record?: EditableServiceRecord; open: boolean; onClose: () => void;
}) {
  const [duplicate, setDuplicate] = useState<{ date: string; serviceType: string; cost: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dropExisting, setDropExisting] = useState(false);
  const [savedWithoutReceipt, setSavedWithoutReceipt] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const editing = record != null;
  const existingReceipt = record?.receiptId && !dropExisting && !receipt ? record.receiptId : null;
  const meter = unit.type === "trailer" ? null : unit.type === "reefer" ? "Engine hours" : "Odometer";
  const recordReading = unit.type === "reefer" ? record?.hours : record?.mileage;

  const holdReceipt = (file: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setReceipt(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  };

  const close = () => {
    setDuplicate(null); setError(null); setAiNote(null); holdReceipt(null);
    setDropExisting(false); setSavedWithoutReceipt(false); onClose();
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : undefined);
    const fields = {
      serviceType: (f.get("serviceType") as string) || undefined,
      date: String(f.get("date")),
      reading: num("reading"),
      cost: num("cost"),
      shop: (f.get("shop") as string) || undefined,
      notes: (f.get("notes") as string) || undefined,
      confirmDuplicate: duplicate !== null,
    };
    const schedule = (f.get("scheduleId") as string) || undefined;
    setPending(true);
    setError(null);
    const result = editing
      ? await updateServiceRecordAction(record.id, { ...fields, scheduleId: schedule ?? null })
      : await logServiceAction({ ...fields, equipmentId: unit.id, scheduleId: schedule });
    if (!result.ok) {
      setPending(false);
      if (result.code === "possible-duplicate") { setDuplicate(result.existing); return; }
      setError(result.message);
      return;
    }
    let receiptError: string | null = null;
    if (receipt) {
      const form = new FormData();
      form.set("kind", "service_receipt"); form.set("parentId", result.id); form.set("photo", receipt);
      const saved = await attachReceiptAction(form);
      if (!saved.ok) receiptError = saved.message;
    } else if (dropExisting && record?.receiptId) {
      const removed = await removeAttachmentAction(record.receiptId);
      if (!removed.ok) receiptError = removed.message;
    }
    setPending(false);
    if (!receiptError) return close();
    setSavedWithoutReceipt(true);
    setError(`The service was saved, but the receipt photo wasn't: ${receiptError}`);
  }

  return (
    <Sheet open={open} onClose={close} title={`${editing ? "Edit service" : "Log service"} · Unit ${unit.unitNumber}`}
      footer={savedWithoutReceipt
        ? <button type="button" className="btn btn-primary" onClick={close}>Close</button>
        : <>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="submit" form="service-form" className="btn btn-primary" disabled={pending}>
            {duplicate ? "Save separate entry" : editing ? "Save changes" : "Save service"}
          </button>
        </>}>
      <form id="service-form" ref={formRef} onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <PhotoButton label={editing ? "Re-read a receipt photo" : "Fill from receipt photo"} onPhoto={async (photo) => {
            setError(null);
            holdReceipt(photo);
            const form = new FormData();
            form.set("photo", photo);
            const r = await readServiceReceiptAction(form);
            if (!r.ok) { setError(`${r.message} The photo will still be saved with the record.`); return; }
            const set = (name: string, v: string | number | null) => {
              const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
              if (el && v != null && v !== "") el.value = String(v);
            };
            set("serviceType", r.serviceType); set("date", r.date); set("cost", r.cost); set("shop", r.shop); set("notes", r.notes);
            if (unit.type === "tractor") set("reading", r.mileage);
            setAiNote(`Filled from the receipt (${r.confidence} confidence). Review every field before saving.`);
          }} />
          <PhotoButton label="Attach photo only" busyLabel="Preparing photo…" onPhoto={async (photo) => holdReceipt(photo)} />
        </div>
        {aiNote && <p className="text-secondary text-sm" role="status">{aiNote}</p>}
        {(preview || existingReceipt) && (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL or an authenticated attachment, not an optimizable asset */}
            <img src={preview ?? `/api/attachments/${existingReceipt}`} alt="Receipt photo" className="h-16 w-16 rounded border border-line object-cover" />
            <span className="text-secondary text-sm">{preview ? "Saved with the record" : "Receipt on file"}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => (receipt ? holdReceipt(null) : setDropExisting(true))}>
              Remove
            </button>
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="svc-schedule">Schedule item</label>
          <select id="svc-schedule" name="scheduleId" className="form-select" defaultValue={record ? record.scheduleId ?? "" : scheduleId ?? ""}>
            <option value="">Not on the schedule</option>
            {schedules.filter((s) => s.equipmentId === unit.id).map((s) => <option key={s.id} value={s.id}>{s.category} · {s.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="svc-type">Service</label>
          <input id="svc-type" name="serviceType" className="form-input" defaultValue={record?.serviceType} placeholder="Defaults to the schedule item's name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label" htmlFor="svc-date">Date</label>
            <input id="svc-date" name="date" type="date" className="form-input" required defaultValue={record?.date ?? today()} />
          </div>
          {meter && (
            <div className="form-group">
              <label className="form-label" htmlFor="svc-reading">{meter}</label>
              {/* Blank when logging on purpose: a prefilled value can be stale and would re-assert an old reading. */}
              <input id="svc-reading" name="reading" className="form-input font-mono" inputMode="numeric" pattern="[0-9]*"
                defaultValue={recordReading ?? undefined}
                placeholder={(() => { const c = unit.type === "reefer" ? unit.currentHours : unit.currentMileage; return c != null ? `On file: ${formatMileage(c)}` : "From the invoice"; })()} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="svc-cost">Cost (USD)</label>
            <input id="svc-cost" name="cost" className="form-input font-mono" inputMode="decimal" pattern="[0-9]*[.]?[0-9]{0,2}" defaultValue={record?.cost ?? undefined} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="svc-shop">Shop</label>
            <input id="svc-shop" name="shop" className="form-input" defaultValue={record?.shop ?? undefined} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="svc-notes">Notes</label>
          <textarea id="svc-notes" name="notes" className="form-textarea" rows={2} defaultValue={record?.notes ?? undefined} />
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
