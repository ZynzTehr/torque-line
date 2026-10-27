import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { purgeDueAccounts } from "@/server/accountPurge";
import { neonObjectStore } from "@/server/objectStore";

export const maxDuration = 300;

/** Constant-time comparison of the Authorization header with "Bearer <CRON_SECRET>". */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily Vercel Cron (vercel.json): purges every account whose 30 days are up. Vercel sends
 * "Authorization: Bearer $CRON_SECRET" when that env var is set; without it the route refuses everyone.
 * Safe to call again at any time: an account that was purged, restored or isn't due yet is left alone.
 */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const summary = await purgeDueAccounts(getDb(), await neonObjectStore());
  console.log(`account purge: ${summary.purged} purged, ${summary.failed} failed, ${summary.filesDeleted} files deleted, ${summary.filesLeft} left`);
  return Response.json(summary, { status: summary.failed ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
