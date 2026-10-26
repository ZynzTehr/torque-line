import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { formatDate } from "@/domain/format";
import { NewDiagnosisForm } from "@/components/diagnostics/NewDiagnosisForm";
import { listSessions } from "@/server/diagnosticsStore";
import { listEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";

export const metadata: Metadata = { title: "Diagnostics" };

export default function DiagnosticsPage() {
  return (
    <>
      <header className="page-header"><h2>Diagnostics</h2></header>
      <div className="page-body flex max-w-3xl flex-col gap-6">
        <Suspense fallback={<p className="text-secondary">Loading…</p>}><Diagnostics /></Suspense>
      </div>
    </>
  );
}

async function Diagnostics() {
  const { fleetId } = await requireFleet();
  const db = getDb();
  const [units, sessions] = await Promise.all([listEquipment(db, fleetId), listSessions(db, fleetId)]);
  return (
    <>
      <section aria-labelledby="new-dx">
        <span className="section-eyebrow">New diagnosis</span>
        <h3 id="new-dx" className="mb-3">Describe the problem</h3>
        <NewDiagnosisForm units={units.map((u) => ({ id: u.id, unitNumber: u.unitNumber, label: [u.year, u.make, u.model].filter(Boolean).join(" ") || u.type }))} />
      </section>
      {sessions.length > 0 && (
        <section aria-labelledby="past-dx">
          <span className="section-eyebrow">History</span>
          <h3 id="past-dx" className="mb-3">Recent diagnoses</h3>
          <ul className="attention-list">
            {sessions.map((s) => (
              <li key={s.id} className="border-b border-line last:border-b-0">
                <Link href={`/diagnostics/${s.id}`} className="flex items-center gap-3 px-4 py-3">
                  <span className="font-mono text-sm font-bold">{s.unitNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{s.symptom}</span>
                  <span className={`badge ${s.status === "resolved" ? "badge-green" : "badge-neutral"}`}>{s.status === "resolved" ? "Fixed" : "Open"}</span>
                  <span className="text-secondary hidden text-xs sm:inline">{formatDate(s.createdAt.toISOString())}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
