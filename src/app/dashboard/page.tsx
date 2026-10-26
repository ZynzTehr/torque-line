import { Suspense } from "react";
import type { Metadata } from "next";
import { requireFleet } from "@/server/fleet";

export const metadata: Metadata = { title: "Dashboard" };

/** The shell prerenders instantly; fleet data streams in behind the boundary at request time. */
export default function DashboardPage() {
  return (
    <main id="main-content" className="mx-auto max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-secondary">Loading your fleet…</p>}>
        <FleetHeader />
      </Suspense>
    </main>
  );
}

async function FleetHeader() {
  const { fleetName, user } = await requireFleet();
  return (
    <header>
      <span className="section-eyebrow">Signed in as {user.email}</span>
      <h1>{fleetName}</h1>
    </header>
  );
}
