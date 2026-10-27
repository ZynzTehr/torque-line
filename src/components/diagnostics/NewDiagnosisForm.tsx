"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { startDiagnosisAction } from "@/app/(app)/ai-actions";
import { resizeImage } from "@/lib/resizeImage";

const MAX_PHOTOS = 5;

export function NewDiagnosisForm({ units }: { units: { id: string; unitNumber: string; label: string }[] }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    setError(null);
    try {
      const resized = await Promise.all([...list].slice(0, MAX_PHOTOS - photos.length).map((f) => resizeImage(f)));
      setPhotos((p) => [...p, ...resized].slice(0, MAX_PHOTOS));
    } catch {
      setError("One of those photos couldn't be read. Try a JPEG or PNG.");
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.delete("photos");
    photos.forEach((p) => form.append("photos", p));
    setPending(true);
    setError(null);
    let r: Awaited<ReturnType<typeof startDiagnosisAction>>;
    try {
      r = await startDiagnosisAction(form);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      return;
    } finally {
      setPending(false);
    }
    if (r.ok) { router.push(`/diagnostics/${r.sessionId}`); return; }
    if ("sessionId" in r && r.sessionId) { router.push(`/diagnostics/${r.sessionId}?error=${encodeURIComponent(r.message)}`); return; }
    setError(r.message);
  }

  if (!units.length) return <p className="text-secondary text-sm">Add a unit first, then describe what it’s doing.</p>;

  return (
    <form onSubmit={submit} className="card flex flex-col gap-4" aria-busy={pending}>
      <div className="form-group">
        <label className="form-label" htmlFor="dx-unit">Unit</label>
        <select id="dx-unit" name="equipmentId" className="form-select" required>
          {units.map((u) => <option key={u.id} value={u.id}>{u.unitNumber} · {u.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="dx-symptom">What is it doing?</label>
        <textarea id="dx-symptom" name="symptom" className="form-textarea" rows={4} required maxLength={4000}
          placeholder="Loses power climbing grades after 20 minutes. Check engine light on. Started after the last fuel stop." />
        <span className="text-secondary text-xs">When it happens, what changed recently, any dash codes, sounds, or smells.</span>
      </div>
      <div className="form-group">
        <span className="form-label">Photos (optional, up to {MAX_PHOTOS})</span>
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((p, i) => (
            <button key={i} type="button" className="badge badge-neutral" onClick={() => setPhotos((all) => all.filter((_, j) => j !== i))}
              aria-label={`Remove photo ${i + 1}`}>Photo {i + 1} ✕</button>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="btn btn-secondary btn-sm cursor-pointer">
              Add photo
              <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        <span className="text-secondary text-xs">Dash warning lights, leaks, worn parts, or the area that’s making noise. Video and audio aren’t supported yet.</span>
      </div>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      <button type="submit" className="btn btn-primary self-start" disabled={pending}>
        {pending ? "Working through likely causes…" : "Find probable causes"}
      </button>
      <p className="text-secondary text-xs">Suggestions come from AI and can be wrong. They don’t replace an inspection, and they never mark a unit safe to drive.</p>
    </form>
  );
}
