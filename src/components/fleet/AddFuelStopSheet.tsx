"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { addFuelStopAction, attachReceiptAction, removeAttachmentAction, updateFuelStopAction } from "@/app/(app)/actions";
import { readFuelReceiptAction } from "@/app/(app)/ai-actions";
import { Sheet } from "@/components/ui/Sheet";
import { formatCurrency } from "@/domain/format";
import { PhotoButton, ReceiptPreview, useHeldPhoto } from "./PhotoButton";

type Product = "diesel" | "def" | "reefer";
type Line = { gallons: string; price: string; subtotal: string; reading: string };
const EMPTY: Line = { gallons: "", price: "", subtotal: "", reading: "" };
const LABEL: Record<Product, string> = { diesel: "Diesel", def: "DEF", reefer: "Reefer fuel" };
const today = () => new Date().toLocaleDateString("en-CA");
const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
const text = (v: number | null | undefined) => (v == null ? "" : String(v));

type UnitOption = { id: string; unitNumber: string };

/** A saved stop as the edit form needs it. */
export interface EditableFuelStop {
  id: string; date: string; station: string | null; notes: string | null; receiptId: string | null;
  lines: { equipmentId: string; product: Product; gallons: number | null; pricePerGallon: number | null; subtotal: number; odometer: number | null; hours: number | null }[];
}

function linesFrom(stop?: EditableFuelStop): Record<Product, Line> {
  const all = { diesel: EMPTY, def: EMPTY, reefer: EMPTY };
  for (const l of stop?.lines ?? []) {
    all[l.product] = { gallons: text(l.gallons), price: text(l.pricePerGallon), subtotal: l.subtotal.toFixed(2), reading: text(l.product === "reefer" ? l.hours : l.odometer) };
  }
  return all;
}

/**
 * One stop, one receipt, up to three products; unused products stay blank. With `existing` it edits that
 * stop. A receipt photo, read by the assistant or attached as is, is saved with the stop.
 */
export function AddFuelStopSheet({ open, onClose, tractors, reefers, existing }: {
  open: boolean; onClose: () => void; tractors: UnitOption[]; reefers: UnitOption[]; existing?: EditableFuelStop;
}) {
  const [lines, setLines] = useState<Record<Product, Line>>(() => linesFrom(existing));
  const [truck, setTruck] = useState(existing?.lines.find((l) => l.product !== "reefer")?.equipmentId ?? tractors[0]?.id ?? "");
  const [reefer, setReefer] = useState(existing?.lines.find((l) => l.product === "reefer")?.equipmentId ?? reefers[0]?.id ?? "");
  const [date, setDate] = useState(existing?.date ?? today());
  const [station, setStation] = useState(existing?.station ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { file: receipt, preview, hold } = useHeldPhoto();
  const [dropExisting, setDropExisting] = useState(false);
  const [savedWithoutReceipt, setSavedWithoutReceipt] = useState(false);
  const existingReceipt = existing?.receiptId && !dropExisting && !receipt ? existing.receiptId : null;
  const close = () => { hold(null); setDropExisting(false); setSavedWithoutReceipt(false); setError(null); setNote(null); onClose(); };

  const update = (p: Product, field: keyof Line, value: string) => setLines((all) => {
    const next = { ...all[p], [field]: value };
    if ((field === "gallons" || field === "price") && next.gallons && next.price) {
      next.subtotal = (Math.round(Number(next.gallons) * Number(next.price) * 100) / 100).toFixed(2);
    }
    return { ...all, [p]: next };
  });
  // Every product row shows; a row whose unit kind the fleet doesn't have explains how to enable it.
  const hasUnit = (p: Product) => (p === "reefer" ? reefers.length : tractors.length) > 0;
  const products = (Object.keys(LABEL) as Product[]).filter(hasUnit);
  const total = useMemo(() => products.reduce((sum, p) => sum + Math.round((Number(lines[p].subtotal) || 0) * 100), 0) / 100, [lines, products]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const started = products.find((p) => lines[p].subtotal.trim() === "" && (lines[p].gallons || lines[p].price || lines[p].reading));
    if (started) { setError(`Enter the ${LABEL[started]} subtotal, or clear that row.`); return; }
    const used = products.filter((p) => lines[p].subtotal.trim() !== "");
    if (!used.length) { setError("Enter the subtotal for at least one product."); return; }
    setPending(true);
    setError(null);
    const input = {
      date, station: station || undefined, notes: notes || undefined,
      lines: used.map((p) => ({
        equipmentId: p === "reefer" ? reefer : truck, product: p,
        gallons: num(lines[p].gallons), pricePerGallon: num(lines[p].price), subtotal: Number(lines[p].subtotal),
        ...(p === "reefer" ? { hours: num(lines[p].reading) } : p === "diesel" ? { odometer: num(lines[p].reading) } : {}),
      })),
    };
    const r = existing ? await updateFuelStopAction(existing.id, input) : await addFuelStopAction(input);
    if (!r.ok) { setPending(false); setError(r.message); return; }
    let receiptError: string | null = null;
    if (receipt) {
      const form = new FormData();
      form.set("kind", "fuel_receipt"); form.set("parentId", r.id); form.set("photo", receipt);
      const saved = await attachReceiptAction(form);
      if (!saved.ok) receiptError = saved.message;
    } else if (dropExisting && existing?.receiptId) {
      const removed = await removeAttachmentAction(existing.receiptId);
      if (!removed.ok) receiptError = removed.message;
    }
    setPending(false);
    if (receiptError) { setSavedWithoutReceipt(true); setError(`The fuel stop was saved, but the receipt photo wasn't: ${receiptError}`); return; }
    if (!existing) { setLines({ diesel: EMPTY, def: EMPTY, reefer: EMPTY }); setStation(""); setNotes(""); }
    close();
  }

  return (
    <Sheet open={open} onClose={close} title={existing ? "Edit fuel stop" : "Add fuel stop"}
      footer={savedWithoutReceipt ? <button type="button" className="btn btn-primary" onClick={close}>Close</button> : <>
        <span className="text-secondary mr-auto self-center text-sm">Total <strong className="text-fg font-mono">{formatCurrency(total)}</strong></span>
        <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
        <button type="submit" form="fuel-form" className="btn btn-primary" disabled={pending}>{existing ? "Save changes" : "Save stop"}</button>
      </>}>
      <form id="fuel-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
        <PhotoButton label={existing ? "Re-read a receipt photo" : "Fill from receipt photo"} onPhoto={async (photo) => {
          setError(null);
          hold(photo);
          const form = new FormData();
          form.set("photo", photo);
          const r = await readFuelReceiptAction(form);
          if (!r.ok) { setError(`${r.message} The photo will still be saved with the stop.`); return; }
          if (r.date) setDate(r.date);
          if (r.location) setStation(r.location);
          if (r.notes) setNotes(r.notes);
          setLines((all) => {
            const next = { ...all };
            for (const item of r.items) {
              if (!item.fuel_type) continue;
              next[item.fuel_type] = {
                gallons: item.gallons?.toString() ?? "", price: item.price_per_gallon?.toString() ?? "",
                subtotal: item.total_cost?.toFixed(2) ?? "", reading: item.fuel_type === "diesel" ? r.odometer?.toString() ?? "" : item.fuel_type === "reefer" ? r.hours?.toString() ?? "" : "",
              };
            }
            return next;
          });
          setNote(`Filled from the receipt (${r.confidence} confidence). Check the units and amounts before saving.`);
        }} />
        <PhotoButton label="Attach photo only" busyLabel="Preparing photo…" onPhoto={async (photo) => hold(photo)} />
        </div>
        <ReceiptPreview preview={preview} savedId={existingReceipt} onRemove={() => (receipt ? hold(null) : setDropExisting(true))} />
        {note && <p className="text-secondary text-sm" role="status">{note}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group"><label className="form-label" htmlFor="fuel-date">Date</label>
            <input id="fuel-date" type="date" className="form-input" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="fuel-station">Station</label>
            <input id="fuel-station" className="form-input" value={station} onChange={(e) => setStation(e.target.value)} placeholder="Love's #512" /></div>
          {tractors.length > 0 && <div className="form-group"><label className="form-label" htmlFor="fuel-truck">Truck (diesel, DEF)</label>
            <select id="fuel-truck" className="form-select" value={truck} onChange={(e) => setTruck(e.target.value)}>{tractors.map((t) => <option key={t.id} value={t.id}>{t.unitNumber}</option>)}</select></div>}
          {reefers.length > 0 && <div className="form-group"><label className="form-label" htmlFor="fuel-reefer">Reefer</label>
            <select id="fuel-reefer" className="form-select" value={reefer} onChange={(e) => setReefer(e.target.value)}>{reefers.map((t) => <option key={t.id} value={t.id}>{t.unitNumber}</option>)}</select></div>}
        </div>
        {(Object.keys(LABEL) as Product[]).map((p) => (
          <fieldset key={p} className="card !p-3">
            <legend className="px-1 text-sm font-semibold">{LABEL[p]}</legend>
            {!hasUnit(p) ? (
              <p className="text-secondary text-sm">
                {p === "reefer" ? "To log reefer fuel, add your reefer as a unit with type Reefer." : `To log ${LABEL[p]}, add a tractor.`}{" "}
                <Link href="/equipment" className="text-accent" onClick={onClose}>Go to equipment</Link>
              </p>
            ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input aria-label={`${LABEL[p]} gallons`} className="form-input font-mono" inputMode="decimal" placeholder="Gallons" value={lines[p].gallons} onChange={(e) => update(p, "gallons", e.target.value)} />
              <input aria-label={`${LABEL[p]} price per gallon`} className="form-input font-mono" inputMode="decimal" placeholder="$/gal" value={lines[p].price} onChange={(e) => update(p, "price", e.target.value)} />
              <input aria-label={`${LABEL[p]} subtotal`} className="form-input font-mono" inputMode="decimal" placeholder="Subtotal $" value={lines[p].subtotal} onChange={(e) => update(p, "subtotal", e.target.value)} />
              {p !== "def" && <input aria-label={p === "reefer" ? "Reefer hours" : "Odometer"} className="form-input font-mono" inputMode="numeric" placeholder={p === "reefer" ? "Hours" : "Odometer"} value={lines[p].reading} onChange={(e) => update(p, "reading", e.target.value.replace(/\D/g, ""))} />}
            </div>
            )}
          </fieldset>
        ))}
        <div className="form-group">
          <label className="form-label" htmlFor="fuel-notes">Notes</label>
          <textarea id="fuel-notes" className="form-textarea" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      </form>
    </Sheet>
  );
}

export function AddFuelStopButton(props: { tractors: { id: string; unitNumber: string }[]; reefers: { id: string; unitNumber: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!props.tractors.length && !props.reefers.length) return null;
  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>+ Fuel stop</button>
      <AddFuelStopSheet open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}
