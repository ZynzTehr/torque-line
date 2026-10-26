"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createEquipmentAction } from "@/app/(app)/actions";
import { Sheet } from "@/components/ui/Sheet";

/** Add a unit; the default PM schedule for its type is applied automatically. */
export function AddEquipmentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<"tractor" | "trailer" | "reefer">("tractor");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => (f.get(k) as string) || undefined;
    setPending(true);
    setError(null);
    const result = await createEquipmentAction({
      unitNumber: String(f.get("unitNumber") ?? ""), type,
      year: text("year"), make: text("make"), model: text("model"), engineSize: text("engineSize"), vin: text("vin"),
    });
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
    <Sheet open={open} onClose={onClose} title="Add equipment"
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="equipment-form" className="btn btn-primary" disabled={pending}>Add unit</button>
      </>}>
      <form id="equipment-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label" htmlFor="eq-unit">Unit number</label>
            <input id="eq-unit" name="unitNumber" className="form-input" required maxLength={32} placeholder="101" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="eq-type">Type</label>
            <select id="eq-type" className="form-select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="tractor">Tractor</option>
              <option value="trailer">Trailer</option>
              <option value="reefer">Reefer unit</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="eq-year">Year</label>
            <input id="eq-year" name="year" className="form-input" inputMode="numeric" maxLength={4} placeholder="2021" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="eq-make">Make</label>
            <input id="eq-make" name="make" className="form-input" placeholder={placeholders.make} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="eq-model">Model</label>
            <input id="eq-model" name="model" className="form-input" placeholder={placeholders.model} />
          </div>
          {type === "tractor" && (
            <div className="form-group">
              <label className="form-label" htmlFor="eq-engine">Engine</label>
              <input id="eq-engine" name="engineSize" className="form-input" placeholder={placeholders.engine} />
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="eq-vin">VIN (optional)</label>
          <input id="eq-vin" name="vin" className="form-input font-mono uppercase" maxLength={17} />
        </div>
        <p className="text-secondary text-xs">The standard PM-A, PM-B, PM-C, and annual schedule for this type is added automatically. You can edit it after.</p>
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      </form>
    </Sheet>
  );
}
