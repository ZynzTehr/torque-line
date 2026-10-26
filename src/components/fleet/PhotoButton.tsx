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
