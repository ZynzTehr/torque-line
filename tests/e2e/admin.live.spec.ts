import { expect, test, type Page } from "@playwright/test";
import { Pool } from "@neondatabase/serverless";

// Platform admin controls, against a real Neon branch (never production; see live.spec.ts for setup).
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const stamp = `${Date.now()}`;
const admin = { name: "Ada Admin", email: `e2e+admin${stamp}@example.com`, password: `Torque-${stamp}!` };
const member = { name: "Mo Member", email: `e2e+member${stamp}@example.com`, password: `Torque-${stamp}?` };
const shared: { admin?: string; member?: string } = {};

async function signUp(page: Page, who: typeof admin) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test("two owners sign up; one is made a platform admin by hand", async ({ browser }) => {
  for (const [who, key] of [[admin, "admin"], [member, "member"]] as const) {
    const context = await browser.newContext();
    await signUp(await context.newPage(), who);
    shared[key] = JSON.stringify(await context.storageState());
    await context.close();
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`insert into platform_admins (user_id) select id::text from neon_auth."user" where email = $1`, [admin.email]);
  await pool.end();
});

test("a regular owner gets a 404 for the admin area and sees no admin link", async ({ browser }) => {
  const context = await browser.newContext({ storageState: JSON.parse(shared.member!) });
  const page = await context.newPage();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText(`Signed in as ${member.email}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open admin" })).toHaveCount(0);
  await context.close();
});

test("the admin deactivates an account, the owner is paused, then reactivated", async ({ browser }) => {
  const adminCtx = await browser.newContext({ storageState: JSON.parse(shared.admin!) });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto("/settings");
  await adminPage.getByRole("link", { name: "Open admin" }).click();
  await expect(adminPage.getByRole("heading", { name: "Platform admin" })).toBeVisible();
  const row = adminPage.getByTestId("admin-account").filter({ hasText: member.email });
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect(adminPage.getByTestId("admin-account").filter({ hasText: admin.email }).getByRole("button", { name: "Deactivate" })).toHaveCount(0);

  await row.getByRole("button", { name: "Deactivate" }).click();
  await adminPage.getByLabel(/Reason/).fill("Payment overdue");
  await adminPage.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(row.getByText("Note: Payment overdue")).toBeVisible();

  const memberCtx = await browser.newContext({ storageState: JSON.parse(shared.member!) });
  const memberPage = await memberCtx.newPage();
  await memberPage.goto("/dashboard");
  await memberPage.waitForURL("**/account-paused");
  await expect(memberPage.getByRole("heading", { name: "Your account is paused" })).toBeVisible();
  await memberPage.goto("/equipment");
  await memberPage.waitForURL("**/account-paused");

  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await memberPage.goto("/dashboard");
  await expect(memberPage).toHaveURL(/\/dashboard$/);
  await adminCtx.close();
  await memberCtx.close();
});
