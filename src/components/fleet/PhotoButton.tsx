"use client";

import { useState } from "react";
import { resizeImage } from "@/lib/resizeImage";

/** Pick or take one photo, resize it, and hand it to `onPhoto`. Shows its own busy state. */
export function PhotoButton({ label, onPhoto, busyLabel = "Reading photo…" }: { label: string; busyLabel?: string; onPhoto: (file: File) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`btn btn-secondary btn-sm cursor-pointer${busy ? " pointer-events-none opacity-60" : ""}`} aria-busy={busy}>
      {busy ? busyLabel : label}
      <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try { await onPhoto(await resizeImage(file)); } finally { setBusy(false); }
        }} />
    </label>
  );
}

/** A photo held in a form until the record saves, with a local preview URL that is released when replaced. */
export function useHeldPhoto() {
  const [held, setHeld] = useState<{ file: File; preview: string } | null>(null);
  const hold = (file: File | null) => setHeld((prev) => {
    if (prev) URL.revokeObjectURL(prev.preview);
    return file ? { file, preview: URL.createObjectURL(file) } : null;
  });
  return { file: held?.file ?? null, preview: held?.preview ?? null, hold };
}

/** Thumbnail of a new photo (`preview`) or a saved one (`savedId`), with a Remove button. */
export function ReceiptPreview({ preview, savedId, onRemove }: { preview: string | null; savedId: string | null; onRemove: () => void }) {
  if (!preview && !savedId) return null;
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL or an authenticated attachment, not an optimizable asset */}
      <img src={preview ?? `/api/attachments/${savedId}`} alt="Receipt photo" className="h-16 w-16 rounded border border-line object-cover" />
      <span className="text-secondary text-sm">{preview ? "Saved with the record" : "Receipt on file"}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>Remove</button>
    </div>
  );
}
