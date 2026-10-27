import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "@neondatabase/serverless";

// Password reset, password change and email verification, against the e2e Neon branch only (see live.spec.ts for setup).
// Emails go to @example.com, so tokens and codes come from neon_auth.verification instead of an inbox.
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
const branch = process.env.NEON_BRANCH ?? "";
if (process.env.LIVE && !branch.startsWith("e2e-")) throw new Error(`Refusing to run against Neon branch "${branch}": only e2e-* branches.`);
// In file order, one test at a time per project: the auth service rate-limits sign-ins per IP, and every test shares one.
test.describe.configure({ mode: "default", timeout: 180_000 });

const authBase = process.env.NEON_AUTH_BASE_URL!;
let db: Pool;
test.beforeEach(() => { db = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL }); });
test.afterEach(async () => { await db.end(); });

const person = (tag: string) => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return { email: `e2e+${tag}${stamp}@example.com`, password: `Torque-${stamp}!`, newPassword: `Wrench-${stamp}?` };
};

const RATE_WINDOW = 11_000;

/** POSTs straight to the auth service, waiting out its rate limit. */
async function authPost(path: string, body: object, origin: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${authBase}${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    if (res.status !== 429 || attempt === 6) return res;
    await new Promise((r) => setTimeout(r, RATE_WINDOW));
  }
}

/** Creates an account straight on the auth service and marks it verified, so it signs in whatever the branch requires. */
async function createVerifiedUser(email: string, password: string, origin: string) {
  expect((await authPost("/sign-up/email", { email, password, name: "E2E Owner" }, origin)).status).toBe(200);
  await db.query(`update neon_auth."user" set "emailVerified" = true where email = $1`, [email]);
}

/** Submits the sign-in or sign-up form, resubmitting while the auth service answers 429. */
async function submitAuthForm(page: Page, button: string) {
  for (let attempt = 1; ; attempt++) {
    const [res] = await Promise.all([
      page.waitForResponse((r) => /\/api\/auth\/sign-(in|up)\/email/.test(r.url()) && r.request().method() === "POST"),
      page.getByRole("button", { name: button }).click(),
    ]);
    if (res.status() !== 429 || attempt === 6) return;
    await expect(page.getByRole("button", { name: button })).toBeEnabled();
    await page.waitForTimeout(RATE_WINDOW);
  }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await submitAuthForm(page, "Sign in");
}

/** Reset tokens are stored in the clear as identifier "reset-password:<token>", value = user id. */
async function latestResetToken(email: string): Promise<string> {
  let token = "";
  await expect.poll(async () => {
    const { rows } = await db.query(
      `select v.identifier from neon_auth.verification v join neon_auth."user" u on v.value = u.id::text
       where v.identifier like 'reset-password:%' and u.email = $1 order by v."createdAt" desc limit 1`, [email]);
    token = rows[0]?.identifier.slice("reset-password:".length) ?? "";
    return token;
  }, { timeout: 15_000 }).not.toBe("");
  return token;
}

const otpIdentifier = (email: string) => `email-verification-otp-${email}`;
async function otpRowIds(email: string): Promise<string[]> {
  const { rows } = await db.query(`select id from neon_auth.verification where identifier = $1`, [otpIdentifier(email)]);
  return rows.map((r) => String(r.id));
}

/**
 * Codes are stored hashed (base64url SHA-256, then ":<attempts>"), so the test can't read one. Instead it waits
 * for the code sent after `before`, and swaps that row's hash for the hash of a code it knows.
 */
async function plantCode(email: string, before: string[], code: string) {
  let id = "";
  await expect.poll(async () => {
    const { rows } = await db.query(
      `select id from neon_auth.verification where identifier = $1 order by "createdAt" desc limit 1`, [otpIdentifier(email)]);
    id = rows[0] ? String(rows[0].id) : "";
    return id !== "" && !before.includes(id);
  }, { timeout: 15_000 }).toBe(true);
  await db.query(`update neon_auth.verification set value = $2 where id = $1`, [id, `${createHash("sha256").update(code).digest("base64url")}:0`]);
}

test("forgot password: neutral answer, reset by the emailed link, sign in with the new password", async ({ page, baseURL }) => {
  const owner = person("reset");
  await createVerifiedUser(owner.email, owner.password, baseURL!);

  await page.goto("/auth/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL("**/auth/forgot-password");
  // An address with no account gets the same answer as a real one.
  for (const email of [`e2e+nobody${Date.now()}@example.com`, owner.email]) {
    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toHaveText(`If ${email} has an account, we sent it a link to reset the password. The link works for one hour.`);
  }

  // Follow the link the way the email does: the auth service checks the token, then redirects to our page.
  const token = await latestResetToken(owner.email);
  await page.goto(`${authBase}/reset-password/${token}?callbackURL=${encodeURIComponent(`${baseURL}/auth/reset-password`)}`);
  await page.waitForURL(`**/auth/reset-password?token=${token}`);

  await page.getByLabel("New password", { exact: true }).fill(owner.newPassword);
  await page.getByLabel("Confirm new password", { exact: true }).fill(`${owner.newPassword}x`);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("The two passwords don't match.")).toBeVisible();
  await page.getByRole("button", { name: "Show new password" }).click();
  await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByLabel("Confirm new password", { exact: true }).fill(owner.newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await page.waitForURL("**/auth/sign-in?notice=password-reset");
  await expect(page.getByRole("status")).toHaveText("Password updated. Sign in with your new password.");

  await signIn(page, owner.email, owner.password);
  await expect(page.locator("#auth-error")).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await signIn(page, owner.email, owner.newPassword);
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  // The token works once.
  await page.goto(`/auth/reset-password?token=${token}`);
  await page.getByLabel("New password", { exact: true }).fill(owner.password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("This reset link is invalid or has expired. Links work once, for one hour.")).toBeVisible();
  await page.getByRole("link", { name: "Request a new link" }).click();
  await page.waitForURL("**/auth/forgot-password");
});

test("change password in settings signs out other devices only", async ({ browser, baseURL }) => {
  const owner = person("change");
  await createVerifiedUser(owner.email, owner.password, baseURL!);
  const here = await browser.newContext();
  const elsewhere = await browser.newContext();
  const page = await here.newPage();
  const other = await elsewhere.newPage();
  for (const p of [page, other]) {
    await signIn(p, owner.email, owner.password);
    await p.waitForURL("**/dashboard", { timeout: 30_000 });
  }

  await page.goto("/settings");
  await page.getByRole("button", { name: "Change password" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Current password", { exact: true }).fill(`${owner.password}x`);
  await sheet.getByLabel("New password", { exact: true }).fill(owner.newPassword);
  await sheet.getByLabel("Confirm new password", { exact: true }).fill(owner.newPassword);
  await sheet.getByRole("button", { name: "Change password" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Your current password is wrong.");

  await sheet.getByLabel("Current password", { exact: true }).fill(owner.password);
  await sheet.getByRole("button", { name: "Change password" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Password changed. Other devices are signed out.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(`Signed in as ${owner.email}`)).toBeVisible();

  // The other device's session is revoked. Its signed session cache cookie can outlive that for a few minutes,
  // so drop the cache the way its expiry would and check the session itself.
  const kept = (await elsewhere.cookies()).filter((c) => !c.name.includes("session_data"));
  await elsewhere.clearCookies();
  await elsewhere.addCookies(kept);
  await other.goto("/dashboard");
  await other.waitForURL("**/auth/sign-in**");

  await signIn(other, owner.email, owner.newPassword);
  await other.waitForURL("**/dashboard", { timeout: 30_000 });
  await here.close();
  await elsewhere.close();
});

test.describe("email verification", () => {
  // Projects take turns holding the branch setting, so one may wait out the other's run.
  test.describe.configure({ timeout: 420_000 });
  const setRequired = (on: boolean) => execFileSync("neon", [
    "neon-auth", "config", "email-password", "update", "--branch", branch, "--require-email-verification", String(on),
  ], { stdio: "pipe" });
  let turnedOn = false;
  // Runs even when a test times out, which skips its finally block. Only the project that turned it on restores it.
  test.afterAll(() => { if (turnedOn) setRequired(false); });

  /** Turns required verification on for the e2e branch for the length of `run`, one project at a time. */
  async function withVerificationRequired(origin: string, run: () => Promise<void>) {
    const lock = await db.connect();
    await lock.query("select pg_advisory_lock(hashtext('e2e-require-email-verification'))");
    const probe = person("probe");
    try {
      // An unverified account, to tell when the setting has reached the auth service.
      await authPost("/sign-up/email", { email: probe.email, password: probe.password, name: "Probe" }, origin);
      setRequired(true);
      turnedOn = true;
      await expect.poll(async () => (await authPost("/sign-in/email", { email: probe.email, password: probe.password }, origin)).status,
        { timeout: 90_000, intervals: [4_000] }).toBe(403);
      await run();
    } finally {
      setRequired(false);
      turnedOn = false;
      await db.query(`delete from neon_auth."user" where email = $1`, [probe.email]);
      await lock.query("select pg_advisory_unlock(hashtext('e2e-require-email-verification'))");
      lock.release();
    }
  }

  test("an unverified owner enters the emailed code after sign-up or sign-in and lands in the app", async ({ page, baseURL }) => {
    const owner = person("verify");
    await withVerificationRequired(baseURL!, async () => {
      await page.goto("/auth/sign-up");
      await page.getByLabel("Your name").fill("Vera Verify");
      await page.getByLabel("Email").fill(owner.email);
      await page.getByLabel("Password").fill(owner.password);
      await submitAuthForm(page, "Create account");
      await page.waitForURL(`**/auth/verify-email?email=${encodeURIComponent(owner.email)}`);
      await expect(page.getByRole("status")).toContainText(`We sent a 6-digit code to ${owner.email}`);
      await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
      await page.getByLabel("Code").fill("000000");
      await page.getByRole("button", { name: "Verify email" }).click();
      await expect(page.getByText("That code is wrong. Check the email and try again.")).toBeVisible();

      // Leave, then sign in: the unverified account is sent back to enter a fresh code.
      let before = await otpRowIds(owner.email);
      await signIn(page, owner.email, owner.password);
      await page.waitForURL("**/auth/verify-email?**");
      await expect(page.getByRole("status")).toContainText("We sent a 6-digit code");

      // Resend after the cooldown; the newest code is the one that works.
      await plantCode(owner.email, before, "111111");
      before = await otpRowIds(owner.email);
      const resend = page.getByRole("button", { name: "Send a new code" });
      await expect(resend).toBeEnabled({ timeout: 75_000 });
      await resend.click();
      await plantCode(owner.email, before, "424242");
      await page.getByLabel("Code").fill("424242");
      await page.getByRole("button", { name: "Verify email" }).click();
      await page.waitForURL("**/dashboard", { timeout: 30_000 });
      await page.goto("/settings");
      await expect(page.getByText(`Signed in as ${owner.email}`)).toBeVisible();
    });
  });
});
