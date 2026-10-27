#!/usr/bin/env node
// Checks each Neon service the app uses against the linked branch, without the app.
// Usage: node --env-file=.env.local scripts/smoke-neon.mjs
import { neon } from "@neondatabase/serverless";
import { Files } from "files-sdk";
import { neon as neonStorage } from "files-sdk/neon";

const results = [];
const check = async (name, fn) => {
  try { results.push([name, "ok", await fn()]); } catch (e) { results.push([name, "FAIL", e?.message ?? String(e)]); }
};

await check("postgres", async () => {
  const sql = neon(process.env.DATABASE_URL);
  const [{ n }] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
  const migrations = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
  return `${n} app tables, ${migrations[0].n} migrations applied`;
});

await check("auth", async () => {
  const res = await fetch(`${process.env.NEON_AUTH_BASE_URL}/ok`);
  const jwks = await fetch(process.env.NEON_AUTH_JWKS_URL);
  if (!jwks.ok) throw new Error(`JWKS ${jwks.status}`);
  return `GET /ok ${res.status}, JWKS ${jwks.status} with ${(await jwks.json()).keys?.length ?? 0} key(s)`;
});

await check("object storage", async () => {
  const files = new Files({ adapter: neonStorage({ bucket: "attachments" }) });
  const key = `smoke/${crypto.randomUUID()}.txt`;
  const body = `torqueline smoke ${new Date().toISOString()}`;
  await files.upload(key, body, { contentType: "text/plain" });
  const roundTrip = await (await files.download(key)).text();
  await files.delete(key);
  const gone = !(await files.exists(key));
  if (roundTrip !== body || !gone) throw new Error("round trip mismatch");
  return `upload, download, delete round trip on bucket "attachments"`;
});

for (const [name, status, detail] of results) console.log(`${status.padEnd(4)} ${name.padEnd(15)} ${detail}`);
process.exit(results.some(([, s]) => s !== "ok") ? 1 : 0);
