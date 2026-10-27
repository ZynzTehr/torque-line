"use client";

import { useState } from "react";
import { refineDiagnosisAction, resolveDiagnosisAction } from "@/app/(app)/ai-actions";
import { Sheet } from "@/components/ui/Sheet";

export function RefinePanel({ sessionId, marked, questions }: { sessionId: string; marked: number; questions: string[] }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution] = useState("");

  const refine = async () => {
    setPending(true);
    setMessage(null);
    const r = await refineDiagnosisAction(sessionId, note);
    setPending(false);
    if (r.ok) setNote(""); else setMessage(r.message);
  };

  return (
    <section className="card flex flex-col gap-3" aria-labelledby="refine-title">
      <h3 id="refine-title" className="text-base">Narrow it down</h3>
      {questions.length > 0 && (
        <ul className="text-secondary list-disc pl-5 text-sm">{questions.map((q) => <li key={q}>{q}</li>)}</ul>
      )}
      <label className="form-label" htmlFor="refine-note">Anything new? Answers, codes, what you checked</label>
      <textarea id="refine-note" className="form-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={pending || (!note.trim() && marked === 0)} onClick={refine}>
          {pending ? "Re-ranking…" : "Update causes"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setResolveOpen(true)}>Mark fixed</button>
      </div>
      <p className="text-secondary text-xs">Mark causes as tried or ruled out (swipe right or left on a card), add what you learned, then update.</p>
      {message && <p role="alert" className="text-danger text-sm">{message}</p>}
      <Sheet open={resolveOpen} onClose={() => setResolveOpen(false)} title="What fixed it?"
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setResolveOpen(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={async () => {
            const r = await resolveDiagnosisAction(sessionId, resolution);
            if (r.ok) setResolveOpen(false); else setMessage(r.message);
          }}>Save</button>
        </>}>
        <label className="form-label" htmlFor="resolution">Fix and notes</label>
        <textarea id="resolution" className="form-textarea" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Replaced lift pump; power back to normal." />
        <p className="text-secondary text-xs">Log the repair as a service record on the unit page so it counts toward its history and spend.</p>
      </Sheet>
    </section>
  );
}
