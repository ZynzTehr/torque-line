import { sql } from "drizzle-orm";
import type { AppDb } from "./fleetStore";

export type QuotaResult = { ok: true; used: number } | { ok: false; code: "quota"; limit: number };

/**
 * Count one AI request against the fleet's daily limit. The check and increment happen in a single
 * statement, so concurrent requests cannot push the count past the limit.
 */
export async function consumeAiRequest(db: AppDb, fleetId: string, day: string): Promise<QuotaResult> {
  const result = await db.execute<{ requests: number }>(sql`
    insert into ai_usage (fleet_id, day, requests)
    select ${fleetId}::uuid, ${day}::date, 1
    from fleets f where f.id = ${fleetId}::uuid and f.ai_daily_limit >= 1
    on conflict (fleet_id, day) do update
      set requests = ai_usage.requests + 1
      where ai_usage.requests < (select ai_daily_limit from fleets where id = ${fleetId}::uuid)
    returning requests`);
  const row = (result as unknown as { rows: { requests: number }[] }).rows[0];
  if (row) return { ok: true, used: Number(row.requests) };
  const limit = await db.execute<{ ai_daily_limit: number }>(sql`select ai_daily_limit from fleets where id = ${fleetId}::uuid`);
  return { ok: false, code: "quota", limit: Number((limit as unknown as { rows: { ai_daily_limit: number }[] }).rows[0]?.ai_daily_limit ?? 0) };
}
