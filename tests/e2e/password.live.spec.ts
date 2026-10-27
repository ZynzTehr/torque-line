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

test("forgot password: neutral answer, reset by the emailed link, every device signed out, sign in with the new password", async ({ page, browser, baseURL }) => {
  const owner = person("reset");
  await createVerifiedUser(owner.email, owner.password, baseURL!);
  // Someone already signed in with the old password, e.g. whoever it leaked to.
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await signIn(other, owner.email, owner.password);
  await other.waitForURL("**/dashboard", { timeout: 30_000 });

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
  await expect(page.getByRole("status")).toHaveText("Password updated and all devices signed out. Sign in with your new password.");

  // The reset ended the other device's session, on its very next request: its session cache cookie is still fresh.
  expect((await elsewhere.cookies()).some((c) => c.name.includes("session_data"))).toBe(true);
  await other.goto("/dashboard");
  await other.waitForURL("**/auth/sign-in**");
  await elsewhere.close();

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
  // With both session cache cookies still fresh, this device stays signed in…
  await page.reload();
  await expect(page.getByText(`Signed in as ${owner.email}`)).toBeVisible();

  // …and the other one is signed out on its next request.
  expect((await elsewhere.cookies()).some((c) => c.name.includes("session_data"))).toBe(true);
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

  test("an unverified owner enters the emailed code after sign-up or sign-in and lands in the app", async ({ page, browser, baseURL }) => {
    const owner = person("verify");
    let sends = 0;
    page.on("request", (r) => { if (r.url().includes("/email-otp/send-verification-otp")) sends++; });
    await withVerificationRequired(baseURL!, async () => {
      await page.goto("/auth/sign-up");
      await page.getByLabel("Your name").fill("Vera Verify");
      await page.getByLabel("Email").fill(owner.email);
      await page.getByLabel("Password").fill(owner.password);
      await submitAuthForm(page, "Create account");
      // The address is handed over in the tab, never in the URL.
      await page.waitForURL((url) => url.pathname === "/auth/verify-email" && url.search === "");
      await expect(page.getByRole("status")).toContainText(`We sent a 6-digit code to ${owner.email}`);
      await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
      expect(sends).toBe(1);
      await page.getByLabel("Code").fill("000000");
      await page.getByRole("button", { name: "Verify email" }).click();
      await expect(page.getByText("That code is wrong. Check the email and try again.")).toBeVisible();

      // A reload keeps the code already on its way instead of sending (and invalidating it with) another.
      await page.reload();
      await expect(page.getByRole("status")).toContainText(`We sent a 6-digit code to ${owner.email}`);
      await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
      expect(sends).toBe(1);

      // A cold link to the page can't send anyone a code.
      const stranger = await browser.newContext();
      const cold = await stranger.newPage();
      let coldSends = 0;
      cold.on("request", (r) => { if (r.url().includes("/email-otp/send-verification-otp")) coldSends++; });
      await cold.goto("/auth/verify-email");
      await expect(cold.getByText("Sign in first and we'll send a code to your email.")).toBeVisible();
      expect(coldSends).toBe(0);
      await stranger.close();

      // Leave, then sign in: the unverified account is sent back to enter a fresh code.
      await signIn(page, owner.email, owner.password);
      await page.waitForURL("**/auth/verify-email");
      await expect(page.getByRole("status")).toContainText("We sent a 6-digit code");

      // Resend after the cooldown; the newest code is the one that works. A double tap on a slow connection sends one.
      const before = await otpRowIds(owner.email);
      const resend = page.getByRole("button", { name: "Send a new code" });
      await expect(resend).toBeEnabled({ timeout: 75_000 });
      await page.route("**/email-otp/send-verification-otp", async (route) => {
        await new Promise((r) => setTimeout(r, 1_500));
        await route.continue();
      });
      const sendsBefore = sends;
      await resend.dblclick();
      await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled({ timeout: 15_000 });
      await page.unroute("**/email-otp/send-verification-otp");
      expect(sends - sendsBefore).toBe(1);
      await plantCode(owner.email, before, "424242");
      await page.getByLabel("Code").fill("424242");
      await page.getByRole("button", { name: "Verify email" }).click();
      await page.waitForURL("**/dashboard", { timeout: 30_000 });
      await page.goto("/settings");
      await expect(page.getByText(`Signed in as ${owner.email}`)).toBeVisible();
    });
  });
});
