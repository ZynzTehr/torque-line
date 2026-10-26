"use client";

import { useState } from "react";
import { acceptIntervalsAction, lookupIntervalsAction } from "@/app/(app)/ai-actions";
import { Sheet } from "@/components/ui/Sheet";
import { formatMileage } from "@/domain/format";

type Item = {
  name: string; category: "PM-A" | "PM-B" | "PM-C" | "Annual"; mileageInterval: number | null; timeInterval: number | null;
  description: string; source: string; confidence: string; source_detail: string; warnings: string[];
};

/** AI-suggested PM intervals. Nothing is saved until the owner selects items and confirms. */
export function SuggestIntervals({ equipmentId }: { equipmentId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setOpen(true); setPending(true); setMessage(null); setItems([]);
    const r = await lookupIntervalsAction(equipmentId);
    setPending(false);
    if (!r.ok) { setMessage(r.message); return; }
    setItems(r.items as Item[]);
    setWarnings(r.globalWarnings);
    setPicked(new Set(r.items.map((it, i) => (it.warnings.length ? -1 : i)).filter((i) => i >= 0)));
  };
  const save = async () => {
    setPending(true);
    const chosen = items.filter((_, i) => picked.has(i)).map((it) => ({
      name: it.name, category: it.category, mileageInterval: it.mileageInterval, timeInterval: it.timeInterval,
      description: it.description, sourceDetail: `${it.source}: ${it.source_detail}`.slice(0, 500),
    }));
    const r = await acceptIntervalsAction(equipmentId, chosen);
    setPending(false);
    if (r.ok) { setOpen(false); setItems([]); }
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={load}>Suggest intervals with AI</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Suggested PM intervals"
        footer={items.length > 0 && <>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={pending || picked.size === 0} onClick={save}>Add {picked.size} to schedule</button>
        </>}>
        {pending && items.length === 0 && <p className="text-secondary text-sm" role="status">Looking up intervals for this unit…</p>}
        {message && <p role="alert" className="text-danger text-sm">{message}</p>}
        {warnings.map((w) => <p key={w} className="alert-item alert-item-yellow text-sm">{w}</p>)}
        {items.length > 0 && (
          <ul className="flex flex-col gap-2">
            {items.map((it, i) => (
              <li key={`${it.name}-${i}`}>
                <label className="card flex cursor-pointer items-start gap-3 !p-3">
                  <input type="checkbox" className="mt-1" checked={picked.has(i)}
                    onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                  <span className="min-w-0 flex-1 text-sm">
                    <strong>{it.category} · {it.name}</strong>
                    <span className="text-secondary block text-xs">
                      Every {[it.mileageInterval && `${formatMileage(it.mileageInterval)} mi`, it.timeInterval && `${it.timeInterval} days`].filter(Boolean).join(" or ")} · {it.source.replace("_", " ")} · {it.confidence} confidence
                    </span>
                    {it.warnings.map((w) => <span key={w} className="text-warn block text-xs">{w}</span>)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-secondary text-xs">Confirm intervals against your equipment documentation and operating conditions. Items with warnings start unchecked.</p>
      </Sheet>
    </>
  );
}
