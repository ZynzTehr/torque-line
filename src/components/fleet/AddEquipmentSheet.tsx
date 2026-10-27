"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createEquipmentAction, updateEquipmentAction } from "@/app/(app)/actions";
import { Sheet } from "@/components/ui/Sheet";

type UnitType = "tractor" | "trailer" | "reefer";

/** A saved unit's editable details. */
export interface EditableUnit {
  id: string; unitNumber: string; type: UnitType;
  year: string | null; make: string | null; model: string | null; engineSize: string | null; vin: string | null; notes: string | null;
}

/**
 * Add a unit, applying the default PM schedule for its type, or edit one (`existing`). The type is fixed
 * once a unit exists, because its schedule and history depend on it.
 */
export function AddEquipmentSheet({ open, onClose, existing }: { open: boolean; onClose: () => void; existing?: EditableUnit }) {
  const router = useRouter();
  const [type, setType] = useState<UnitType>(existing?.type ?? "tractor");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // Blank fields become null on edit so a cleared value is actually cleared.
    const text = (k: string) => (f.get(k) as string) || (existing ? null : undefined);
    const details = {
      unitNumber: String(f.get("unitNumber") ?? ""),
      year: text("year"), make: text("make"), model: text("model"), engineSize: text("engineSize"), vin: text("vin"), notes: text("notes"),
    };
    setPending(true);
    setError(null);
    if (existing) {
      const result = await updateEquipmentAction(existing.id, details);
      setPending(false);
      if (!result.ok) { setError(result.message); return; }
      onClose();
      return;
    }
    const result = await createEquipmentAction({ ...details, type });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    onClose();
    router.push(`/equipment/${result.id}`);
  }

  const placeholders = {
    tractor: { make: "Freightliner", model: "Cascadia", engine: "Detroit DD15" },
    trailer: { make: "Great Dane", model: "53' dry van", engine: "" },
    reefer: { make: "Thermo King", model: "Precedent S-700", engine: "" },
  }[type];

  return (
    <Sheet open={open} onClose={onClose} title={existing ? `Edit unit ${existing.unitNumber}` : "Add equipment"}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="equipment-form" className="btn btn-primary" disabled={pending}>{existing ? "Save changes" : "Add unit"}</button>
      </>}>
      <form id="equipment-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label" htmlFor="eq-unit">Unit number</label>
            <input id="eq-unit" name="unitNumber" className="form-input" required maxLength={32} placeholder="101" defaultValue={existing?.unitNumber} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="eq-type">Type</label>
            <select id="eq-type" className="form-select" value={type} disabled={!!existing} aria-describedby={existing ? "eq-type-fixed" : undefined}
              onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="tractor">Tractor</option>
              <option value="trailer">Trailer</option>
              <option value="reefer">Reefer (refrigerated trailer)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="eq-year">Year</label>
            <input id="eq-year" name="year" className="form-input" inputMode="numeric" maxLength={4} placeholder="2021" defaultValue={existing?.year ?? undefined} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="eq-make">Make</label>
            <input id="eq-make" name="make" className="form-input" placeholder={placeholders.make} defaultValue={existing?.make ?? undefined} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="eq-model">Model</label>
            <input id="eq-model" name="model" className="form-input" placeholder={placeholders.model} defaultValue={existing?.model ?? undefined} />
          </div>
          {type === "tractor" && (
            <div className="form-group">
              <label className="form-label" htmlFor="eq-engine">Engine</label>
              <input id="eq-engine" name="engineSize" className="form-input" placeholder={placeholders.engine} defaultValue={existing?.engineSize ?? undefined} />
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="eq-vin">VIN (optional)</label>
          <input id="eq-vin" name="vin" className="form-input font-mono uppercase" maxLength={17} defaultValue={existing?.vin ?? undefined} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="eq-notes">Notes (optional)</label>
          <textarea id="eq-notes" name="notes" className="form-textarea" rows={2} maxLength={2000} defaultValue={existing?.notes ?? undefined} />
        </div>
        {existing
          ? <p id="eq-type-fixed" className="text-secondary text-xs">The type can&apos;t change once a unit exists; its schedule and history depend on it.</p>
          : <p className="text-secondary text-xs">The standard PM-A, PM-B, PM-C, and annual schedule for this type is added automatically. You can edit it after.</p>}
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      </form>
    </Sheet>
  );
}
