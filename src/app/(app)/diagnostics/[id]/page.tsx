import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { diagnosisSchema } from "@/ai/diagnosis";
import { CauseCard } from "@/components/diagnostics/CauseCard";
import { RefinePanel } from "@/components/diagnostics/RefinePanel";
import { getSession } from "@/server/diagnosticsStore";
import { listAttachments } from "@/server/attachmentsStore";
import { getEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";

export const metadata: Metadata = { title: "Diagnosis" };

export default function DiagnosisPage(props: PageProps<"/diagnostics/[id]">) {
  return (
    <div className="page-body flex max-w-3xl flex-col gap-5">
      <Link href="/diagnostics" className="text-secondary text-sm">← All diagnoses</Link>
      <Suspense fallback={<p className="text-secondary">Loading diagnosis…</p>}><Diagnosis {...props} /></Suspense>
    </div>
  );
}

/** Follow-up questions from the latest model turn; tolerant of older or malformed stored turns. */
function latestQuestions(turns: { role: string; content: unknown }[]): string[] {
  const last = [...turns].reverse().find((t) => t.role === "assistant");
  try {
    const text = (last?.content as { text?: string }[])?.[0]?.text;
    const parsed = diagnosisSchema.safeParse(text ? JSON.parse(text) : null);
    return parsed.success ? parsed.data.follow_up_questions.slice(0, 3) : [];
  } catch { return []; }
}

async function Diagnosis({ params, searchParams }: PageProps<"/diagnostics/[id]">) {
  const { id } = await params;
  const { error } = await searchParams;
  const { fleetId } = await requireFleet();
  const db = getDb();
  const view = await getSession(db, fleetId, id);
  if (!view) notFound();
  const [unit, photos] = await Promise.all([
    getEquipment(db, fleetId, view.session.equipmentId),
    listAttachments(db, fleetId, "diagnostic_photo", view.session.id),
  ]);
  const open = view.causes.filter((c) => !c.ruledOut);
  const stop = open.some((c) => c.safetyCritical);
  const resolved = view.session.status === "resolved";

  return (
    <>
      <header>
        <span className="section-eyebrow">Unit {unit?.unitNumber}</span>
        <h1 className="text-xl">{view.session.symptom}</h1>
        {resolved && <p className="badge badge-green mt-2">Fixed: {view.session.resolutionNote ?? "resolved"}</p>}
      </header>
      {photos.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto" aria-label="Photos" data-no-swipe>
          {photos.map((p, i) => (
            <li key={p.id} className="shrink-0">
              <a href={`/api/attachments/${p.id}`} target="_blank" rel="noopener">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated bytes; not optimizable */}
                <img src={`/api/attachments/${p.id}`} alt={`Photo ${i + 1} of the problem`} className="size-24 rounded-[var(--radius-md)] object-cover" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {typeof error === "string" && <p role="alert" className="alert-item alert-item-yellow">{error}</p>}
      {stop && (
        <p role="alert" className="alert-item alert-item-red">
          <strong>Stop and inspect before driving.</strong> At least one likely cause involves a safety system. Have the unit inspected before it goes back on the road.
        </p>
      )}
      {view.causes.length === 0 ? (
        <p className="text-secondary text-sm">No causes yet. {resolved ? "" : "Try updating with more detail."}</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Probable causes, most likely first">
          {view.causes.map((c) => <CauseCard key={c.id} cause={c} disabled={resolved} />)}
        </ol>
      )}
      {!resolved && <RefinePanel sessionId={view.session.id} marked={view.causes.filter((c) => c.tried || c.ruledOut).length} questions={latestQuestions(view.turns)} />}
      <p className="text-secondary text-xs">AI suggestions can be wrong. They don’t replace an inspection, and nothing here certifies a unit is safe to operate.</p>
    </>
  );
}
