"use client";

import { useMemo, useState, type FormEvent } from "react";
import { addFuelStopAction } from "@/app/(app)/actions";
import { readFuelReceiptAction } from "@/app/(app)/ai-actions";
import { Sheet } from "@/components/ui/Sheet";
import { formatCurrency } from "@/domain/format";
import { PhotoButton } from "./PhotoButton";

type Product = "diesel" | "def" | "reefer";
type Line = { gallons: string; price: string; subtotal: string; reading: string };
const EMPTY: Line = { gallons: "", price: "", subtotal: "", reading: "" };
const LABEL: Record<Product, string> = { diesel: "Diesel", def: "DEF", reefer: "Reefer fuel" };
const today = () => new Date().toLocaleDateString("en-CA");
const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

/** One stop, one receipt, up to three products. Unused products stay blank. */
export function AddFuelStopSheet({ open, onClose, tractors, reefers }: {
  open: boolean; onClose: () => void; tractors: { id: string; unitNumber: string }[]; reefers: { id: string; unitNumber: string }[];
}) {
  const [lines, setLines] = useState<Record<Product, Line>>({ diesel: EMPTY, def: EMPTY, reefer: EMPTY });
  const [truck, setTruck] = useState(tractors[0]?.id ?? "");
  const [reefer, setReefer] = useState(reefers[0]?.id ?? "");
  const [date, setDate] = useState(today());
  const [station, setStation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (p: Product, field: keyof Line, value: string) => setLines((all) => {
    const next = { ...all[p], [field]: value };
    if ((field === "gallons" || field === "price") && next.gallons && next.price) {
      next.subtotal = (Math.round(Number(next.gallons) * Number(next.price) * 100) / 100).toFixed(2);
    }
    return { ...all, [p]: next };
  });
  const products = (Object.keys(LABEL) as Product[]).filter((p) => (p === "reefer" ? reefers.length : tractors.length));
  const total = useMemo(() => products.reduce((sum, p) => sum + Math.round((Number(lines[p].subtotal) || 0) * 100), 0) / 100, [lines, products]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const used = products.filter((p) => lines[p].subtotal.trim() !== "");
    setPending(true);
    setError(null);
    const r = await addFuelStopAction({
      date, station: station || undefined,
      lines: used.map((p) => ({
        equipmentId: p === "reefer" ? reefer : truck, product: p,
        gallons: num(lines[p].gallons), pricePerGallon: num(lines[p].price), subtotal: Number(lines[p].subtotal),
        ...(p === "reefer" ? { hours: num(lines[p].reading) } : p === "diesel" ? { odometer: num(lines[p].reading) } : {}),
      })),
    });
    setPending(false);
    if (!r.ok) { setError(r.message); return; }
    setLines({ diesel: EMPTY, def: EMPTY, reefer: EMPTY }); setStation(""); setNote(null); onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add fuel stop"
      footer={<>
        <span className="text-secondary mr-auto self-center text-sm">Total <strong className="text-fg font-mono">{formatCurrency(total)}</strong></span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="fuel-form" className="btn btn-primary" disabled={pending || total <= 0}>Save stop</button>
      </>}>
      <form id="fuel-form" onSubmit={submit} className="flex flex-col gap-4">
        <PhotoButton label="Fill from receipt photo" onPhoto={async (photo) => {
          setError(null);
          const form = new FormData();
          form.set("photo", photo);
          const r = await readFuelReceiptAction(form);
          if (!r.ok) { setError(r.message); return; }
          if (r.date) setDate(r.date);
          if (r.location) setStation(r.location);
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
        {products.map((p) => (
          <fieldset key={p} className="card !p-3">
            <legend className="px-1 text-sm font-semibold">{LABEL[p]}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input aria-label={`${LABEL[p]} gallons`} className="form-input font-mono" inputMode="decimal" placeholder="Gallons" value={lines[p].gallons} onChange={(e) => update(p, "gallons", e.target.value)} />
              <input aria-label={`${LABEL[p]} price per gallon`} className="form-input font-mono" inputMode="decimal" placeholder="$/gal" value={lines[p].price} onChange={(e) => update(p, "price", e.target.value)} />
              <input aria-label={`${LABEL[p]} subtotal`} className="form-input font-mono" inputMode="decimal" placeholder="Subtotal $" value={lines[p].subtotal} onChange={(e) => update(p, "subtotal", e.target.value)} />
              {p !== "def" && <input aria-label={p === "reefer" ? "Reefer hours" : "Odometer"} className="form-input font-mono" inputMode="numeric" placeholder={p === "reefer" ? "Hours" : "Odometer"} value={lines[p].reading} onChange={(e) => update(p, "reading", e.target.value.replace(/\D/g, ""))} />}
            </div>
          </fieldset>
        ))}
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
