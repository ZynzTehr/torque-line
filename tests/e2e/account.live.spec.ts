import { expect, test, type Browser, type Page } from "@playwright/test";
import { Pool } from "@neondatabase/serverless";

// Close, delete, restore and purge an account, against the e2e Neon branch only (see live.spec.ts for setup).
// The purge test calls the cron route, so the server needs CRON_SECRET in its environment.
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
const branch = process.env.NEON_BRANCH ?? "";
if (process.env.LIVE && !branch.startsWith("e2e-")) throw new Error(`Refusing to run against Neon branch "${branch}": only e2e-* branches.`);
// One test at a time per project: the auth service rate-limits sign-ins per IP, and the password check signs in too.
test.describe.configure({ mode: "default", timeout: 180_000 });

let db: Pool;
test.beforeEach(() => { db = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL }); });
test.afterEach(async () => { await db.end(); });

const RATE_WINDOW = 11_000;
const person = (tag: string, project: string) => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return { name: "Closure Tester", email: `e2e+${tag}${project}${stamp}@example.com`, password: `Torque-${stamp}!` };
};
type Person = ReturnType<typeof person>;

/** Submits the sign-in or sign-up form, resubmitting while the auth service answers 429. */
async function submitAuthForm(page: Page, button: string) {
  for (let attempt = 1; ; attempt++) {
    const [res] = await Promise.all([
      page.waitForResponse((r) => /\/api\/auth\/sign-(in|up)\/email/.test(r.url()) && r.request().method() === "POST"),
      page.getByRole("button", { name: button }).click(),
    ]);
    if (res.status() !== 429 || attempt === 6) return res.status();
    await expect(page.getByRole("button", { name: button })).toBeEnabled();
    await page.waitForTimeout(RATE_WINDOW);
  }
}

async function signUp(page: Page, who: Person) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await submitAuthForm(page, "Create account");
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

async function signIn(page: Page, who: Person) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  return submitAuthForm(page, "Sign in");
}

/** Opens Settings, fills the delete sheet and confirms; retries the server's password check while it is rate-limited. */
async function deleteAccount(page: Page, who: Person) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("link", { name: "Download my data" })).toHaveAttribute("href", "/api/export");
  const confirm = sheet.getByRole("button", { name: "Delete account" });
  const email = sheet.getByLabel("Type your email to confirm");
  const password = sheet.getByLabel("Password", { exact: true });
  await password.fill(`${who.password}x`);
  await email.fill("someone-else@example.com");
  await expect(confirm).toBeDisabled();
  await email.fill(who.email.toUpperCase()); // the match ignores case
  for (const [attempt, typed] of [[1, `${who.password}x`], [2, who.password], [3, who.password], [4, who.password], [5, who.password]] as const) {
    await password.fill(typed);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]), confirm.click()]);
    await page.waitForFunction(() => location.search.includes("notice=deletion-scheduled") || document.querySelector("[role=dialog] [role=alert]"));
    if (page.url().includes("notice=deletion-scheduled")) break;
    const said = await sheet.getByRole("alert").textContent();
    if (attempt === 1) expect(said).toMatch(/That password is wrong\.|Too many tries/);
    else expect(said).toBe("Too many tries. Wait a minute and try again.");
    if (said?.startsWith("Too many")) await page.waitForTimeout(RATE_WINDOW);
  }
  await page.waitForURL("**/auth/sign-in?notice=deletion-scheduled");
  await expect(page.getByText("Your account will be deleted in 30 days and you're signed out.")).toBeVisible();
}

async function newSignedInPage(browser: Browser, who: Person) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, who);
  return { context, page };
}

const userIdOf = async (email: string) =>
  (await db.query(`select id::text as id from neon_auth."user" where email = $1`, [email])).rows[0]?.id as string | undefined;

test("close the account, get signed out everywhere, sign in and reopen it", async ({ browser }, info) => {
  const who = person("close", info.project.name);
  const { context, page } = await newSignedInPage(browser, who);
  const otherDevice = await browser.newContext({ storageState: await context.storageState() });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Close account" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("link", { name: "Download my data" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close account" }).click();
  await page.waitForURL("**/auth/sign-in?notice=account-closed");
  await expect(page.getByText("Your account is closed and you're signed out.")).toBeVisible();

  // Every session ended: this browser and the other device are both sent to sign in.
  const other = await otherDevice.newPage();
  await other.goto("/dashboard");
  await other.waitForURL("**/auth/sign-in**");
  await page.goto("/settings");
  await page.waitForURL("**/auth/sign-in**");

  expect(await signIn(page, who)).toBe(200);
  await page.waitForURL("**/account-closed");
  await expect(page.getByRole("heading", { name: "Your account is closed" })).toBeVisible();
  await page.goto("/equipment");
  await page.waitForURL("**/account-closed");
  await page.getByRole("button", { name: "Reopen account" }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/settings");
  await expect(page.getByText(`Signed in as ${who.email}`)).toBeVisible();
  await otherDevice.close();
  await context.close();
});

test("delete the account, sign in within 30 days, download the data and restore it", async ({ browser }, info) => {
  const who = person("restore", info.project.name);
  const { context, page } = await newSignedInPage(browser, who);
  await page.getByRole("button", { name: "+ Add equipment" }).click();
  await page.getByLabel("Unit number").fill("RS-1");
  await page.getByRole("button", { name: "Add unit" }).click();
  await page.waitForURL(/\/equipment\/[0-9a-f-]{36}$/);

  await deleteAccount(page, who);
  const purgeDate = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

  expect(await signIn(page, who)).toBe(200);
  await page.waitForURL("**/account-closed");
  await expect(page.getByRole("heading", { name: "Your account will be deleted" })).toBeVisible();
  await expect(page.getByText(purgeDate)).toBeVisible();
  const zip = await page.request.get("/api/export", { maxRedirects: 0 });
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  await expect(page.getByRole("link", { name: "Download my data" })).toHaveAttribute("href", "/api/export");

  await page.getByRole("button", { name: "Restore my account" }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/equipment");
  await expect(page.getByText("RS-1").first()).toBeVisible();
  expect((await db.query(`select 1 from account_states where user_id = $1`, [await userIdOf(who.email)])).rowCount).toBe(0);
  await context.close();
});

test("after 30 days the purge erases the account: sign-in fails and the receipt is gone", async ({ browser }, info) => {
  const secret = process.env.CRON_SECRET;
  test.skip(!secret, "set CRON_SECRET for the server and the test");
  const who = person("purge", info.project.name);
  const { context, page } = await newSignedInPage(browser, who);
  await page.getByRole("button", { name: "+ Add equipment" }).click();
  await page.getByLabel("Unit number").fill("PG-1");
  await page.getByRole("button", { name: "Add unit" }).click();
  await page.waitForURL(/\/equipment\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Log service" }).click();
  const sheet = page.getByRole("dialog");
  const jpeg = Buffer.from(await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 32; c.height = 32;
    c.getContext("2d")!.fillRect(0, 0, 32, 32);
    return c.toDataURL("image/jpeg").split(",")[1];
  }), "base64");
  await sheet.locator('input[type="file"]').nth(1).setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(sheet.getByText("Saved with the record")).toBeVisible();
  await sheet.getByLabel("Service", { exact: true }).fill("Oil & Filter Change");
  await sheet.getByLabel("Cost (USD)").fill("250");
  await sheet.getByRole("button", { name: "Save service" }).click();
  await expect(sheet).toBeHidden();

  const userId = (await userIdOf(who.email))!;
  const { rows: [att] } = await db.query(
    `select a.id, a.storage_key, a.fleet_id from attachments a join memberships m on m.fleet_id = a.fleet_id where m.user_id = $1`, [userId]);
  const receiptUrl = `/api/attachments/${att.id}`;
  expect((await page.request.get(receiptUrl)).status()).toBe(200);

  await deleteAccount(page, who);
  await db.query(`update account_states set purge_after = now() - interval '1 minute' where user_id = $1`, [userId]);

  const anonymous = await browser.newContext();
  expect((await anonymous.request.get("/api/cron/purge-accounts")).status()).toBe(401);
  expect((await anonymous.request.get("/api/cron/purge-accounts", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const run = await anonymous.request.get("/api/cron/purge-accounts", { headers: { authorization: `Bearer ${secret}` }, timeout: 120_000 });
  expect(run.status()).toBe(200);
  expect(await run.json()).toMatchObject({ failed: 0, filesLeft: 0 }); // the other project's run may be the one that purges it
  // Running it again is harmless.
  expect((await anonymous.request.get("/api/cron/purge-accounts", { headers: { authorization: `Bearer ${secret}` } })).status()).toBe(200);

  expect(await userIdOf(who.email)).toBeUndefined();
  expect((await db.query(`select 1 from fleets where id = $1`, [att.fleet_id])).rowCount).toBe(0);
  expect((await db.query(`select 1 from attachments where id = $1`, [att.id])).rowCount).toBe(0);
  expect((await db.query(`select 1 from anon_service_events where service_type = 'oil and filter change' and cost = 250`)).rowCount).toBeGreaterThanOrEqual(1);
  const [{ Files }, { neon }] = await Promise.all([import("files-sdk"), import("files-sdk/neon")]);
  expect(await new Files({ adapter: neon({ bucket: "attachments" }) }).exists(att.storage_key)).toBe(false);

  // Signing in fails like any unknown account.
  const fresh = await browser.newPage();
  expect(await signIn(fresh, who)).toBe(401);
  await expect(fresh.getByText("Invalid email or password")).toBeVisible();
  await expect(fresh).toHaveURL(/\/auth\/sign-in/);
  await fresh.close();

  // The receipt URL: another signed-in owner gets a 404, a signed-out visitor or the old session a 401.
  const stranger = await newSignedInPage(browser, person("stranger", info.project.name));
  expect((await stranger.page.request.get(receiptUrl)).status()).toBe(404);
  expect((await anonymous.request.get(receiptUrl)).status()).toBe(401);
  expect((await page.request.get(receiptUrl)).status()).toBe(401);
  await stranger.context.close();
  await anonymous.close();
  await context.close();
});
