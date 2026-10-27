import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/db";
import { exportFleet } from "@/server/exportStore";
import { requireFleet } from "@/server/fleet";
import { neonObjectStore } from "@/server/objectStore";

/**
 * "Download my data": the signed-in owner's whole fleet as one zip, streamed as it is built. Streamed
 * function responses are not subject to Vercel's 4.5 MB body limit, so nothing is staged in storage.
 * Signed-out visitors go to sign in and paused accounts to the paused page (requireFleet).
 */
export async function GET() {
  const fleet = await requireFleet();
  try {
    const body = await exportFleet(getDb(), await neonObjectStore(), fleet.fleetId);
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="torqueline-export-${new Date().toISOString().slice(0, 10)}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    const e = error as { name?: string; code?: string };
    console.error(`export failed: ${e?.name ?? typeof error}${e?.code ? ` (${e.code})` : ""}`);
    return new Response("We couldn't build your export. Please try again.", { status: 500 });
  }
}
