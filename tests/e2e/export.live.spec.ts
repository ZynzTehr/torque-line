import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "@neondatabase/serverless";
import { strFromU8, unzipSync } from "fflate";

// "Download my data" against a real Neon branch and bucket, never production (see live.spec.ts for setup).
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`; // desktop and phone run at once: the same millisecond must not mean the same email

async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 48;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1e293b"; g.fillRect(0, 0, 64, 48);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

test("the owner downloads one zip with their records and receipt photos, and only theirs", async ({ page, browser }, info) => {
  const owner = { name: "Ed Export", email: `e2e+x${info.project.name}${stamp}@example.com`, password: `Torque-${stamp}!` };
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  await page.getByRole("button", { name: "+ Add equipment" }).click();
  await page.getByLabel("Unit number").fill("301");
  await page.getByRole("button", { name: "Add unit" }).click();
  await page.waitForURL(/\/equipment\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Log service" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator('input[type="file"]').nth(1).setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: await jpeg(page) });
  await expect(sheet.getByText("Saved with the record")).toBeVisible();
  await sheet.getByLabel("Service", { exact: true }).fill("Brake adjustment");
  await sheet.getByLabel("Date").fill("2026-10-14");
  await sheet.getByLabel("Cost (USD)").fill("150");
  await sheet.getByLabel("Shop").fill("Joe's, Exit 12");
  await sheet.getByLabel("Notes").fill("=1+1");
  await sheet.getByRole("button", { name: "Save service" }).click();
  await expect(sheet).toBeHidden();

  // A removed unit, straight in the branch database: the export must still list it, marked.
  const db = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL });
  const { rows: [{ fleet_id: fleetId }] } = await db.query(
    `select m.fleet_id from memberships m join neon_auth."user" u on u.id::text = m.user_id where u.email = $1`, [owner.email]);
  await db.query(`insert into equipment (fleet_id, unit_number, normalized_unit_number, type, archived_at) values ($1, 'T-OLD', 'T-OLD', 'trailer', now())`, [fleetId]);
  // A second receipt row whose object was never in the bucket: the real store must report it missing, not fail the zip.
  await db.query(
    `insert into attachments (fleet_id, kind, parent_id, storage_key, content_type, byte_size, created_by, created_at)
     select fleet_id, 'service_receipt', id, 'fleets/' || fleet_id || '/service_receipt/' || id || '/' || gen_random_uuid() || '.jpg', 'image/jpeg', 100, created_by, now() + interval '1 minute'
     from service_records where fleet_id = $1`, [fleetId]);

  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download my data" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^torqueline-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));

  const photo = "receipts/2026-10-14 301 brake adjustment.jpg";
  expect(Object.keys(files).sort()).toEqual([
    "diagnostic-causes.csv", "diagnostics.csv", "fleet.json", "fuel.csv", "readings.csv", photo, "schedule.csv", "service-records.csv", "units.csv",
  ]);
  expect([...files[photo].subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  const units = strFromU8(files["units.csv"]);
  expect(units).toMatch(/,301,tractor,.*,active,,/);
  expect(units).toMatch(/,T-OLD,trailer,.*,removed,\d{4}-/);
  const service = strFromU8(files["service-records.csv"]);
  expect(service).toContain(`2026-10-14,`);
  expect(service).toContain(`,Brake adjustment,`);
  expect(service).toContain(`,150.00,"Joe's, Exit 12",'=1+1,${photo},`);
  const json = JSON.parse(strFromU8(files["fleet.json"]));
  expect(json).toMatchObject({ formatVersion: 1, fleet: { id: fleetId }, missingFiles: ["receipts/2026-10-14 301 brake adjustment (2).jpg"], unreadableFiles: [], skippedFiles: [] });
  expect(json.photos).toEqual([
    expect.objectContaining({ file: photo, inZip: true, kind: "service_receipt", contentType: "image/jpeg", byteSize: files[photo].byteLength }),
    expect.objectContaining({ file: "receipts/2026-10-14 301 brake adjustment (2).jpg", inZip: false }),
  ]);
  expect(json.serviceRecords).toEqual([expect.objectContaining({ serviceType: "Brake adjustment", cost: "150.00", receiptFiles: [photo] })]);
  expect(json.units.map((u: { unitNumber: string }) => u.unitNumber)).toEqual(["301", "T-OLD"]);

  // Paused accounts can't export; signed-out visitors are sent to sign in. Clicking the real link must show
  // those pages, not save them as a download.
  await db.query(`update fleets set status = 'inactive' where id = $1`, [fleetId]);
  try {
    const paused = await page.request.get("/api/export", { maxRedirects: 0 });
    expect(paused.status()).toBe(307);
    expect(paused.headers().location).toContain("/account-paused");
    await page.getByRole("link", { name: "Download my data" }).click();
    await page.waitForURL("**/account-paused");
  } finally {
    await db.query(`update fleets set status = 'active' where id = $1`, [fleetId]);
    await db.end();
  }
  await page.goto("/settings");
  await page.context().clearCookies();
  await page.getByRole("link", { name: "Download my data" }).click();
  await page.waitForURL("**/auth/sign-in**");
  const anonymous = await browser.newContext();
  const signedOut = await anonymous.request.get("/api/export", { maxRedirects: 0 });
  expect(signedOut.status()).toBe(307);
  expect(signedOut.headers().location).toContain("/auth/sign-in");
  await anonymous.close();
});
