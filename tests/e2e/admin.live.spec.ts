import { expect, test, type Page } from "@playwright/test";
import { Pool } from "@neondatabase/serverless";

// Platform admin controls, against a real Neon branch (never production; see live.spec.ts for setup).
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`; // desktop and phone run at once: the same millisecond must not mean the same email
const admin = { name: "Ada Admin", email: `e2e+admin${stamp}@example.com`, password: `Torque-${stamp}!` };
const member = { name: "Mo Member", email: `e2e+member${stamp}@example.com`, password: `Torque-${stamp}?` };
const shared: { admin?: string; member?: string } = {};

/** Runs one statement on the test branch (DATABASE_URL is the e2e branch; see live.spec.ts). */
async function query(text: string, values: unknown[]) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query(text, values); } finally { await pool.end(); }
}

// Whatever happened, neither user of this run stays an admin on the shared test branch.
test.afterAll(async () => {
  await query(`delete from platform_admins where user_id in (select id::text from neon_auth."user" where email in ($1, $2))`, [admin.email, member.email]);
});

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
  await query(`insert into platform_admins (user_id) select id::text from neon_auth."user" where email = $1`, [admin.email]);
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

test("a super admin adds a support admin, who sees accounts but can't manage admins", async ({ browser }) => {
  const adminCtx = await browser.newContext({ storageState: JSON.parse(shared.admin!) });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto("/admin");
  const admins = adminPage.getByRole("list", { name: "Admins" });
  const self = admins.getByTestId("platform-admin").filter({ hasText: admin.email });
  await expect(self.getByText("You", { exact: true })).toBeVisible();
  await expect(self.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(self.getByRole("combobox")).toHaveCount(0);

  await adminPage.getByLabel("Email").fill(`nobody${stamp}@example.com`);
  await adminPage.getByRole("button", { name: "Add admin" }).click();
  await expect(adminPage.getByRole("alert").filter({ hasText: "No Torqueline account uses that email. They need to sign up first." })).toBeVisible();

  // Sign-up doesn't prove the address, so an unverified account can't be made an admin.
  await adminPage.getByLabel("Email").fill(member.email.toUpperCase());
  await expect(adminPage.getByLabel("Role", { exact: true })).toHaveValue("support");
  await adminPage.getByRole("button", { name: "Add admin" }).click();
  await expect(adminPage.getByRole("alert").filter({ hasText: "That account hasn't verified its email yet. Only verified accounts can be admins." })).toBeVisible();
  await query(`update neon_auth."user" set "emailVerified" = true where email = $1`, [member.email]);
  await adminPage.getByRole("button", { name: "Add admin" }).click();
  const memberRow = admins.getByTestId("platform-admin").filter({ hasText: member.email });
  await expect(memberRow.getByLabel(`Role for ${member.email}`)).toHaveValue("support");
  await expect(adminPage.getByLabel("Email")).toHaveValue("");

  const memberCtx = await browser.newContext({ storageState: JSON.parse(shared.member!) });
  const memberPage = await memberCtx.newPage();
  await memberPage.goto("/settings");
  await memberPage.getByRole("link", { name: "Open admin" }).click();
  await expect(memberPage.getByRole("heading", { name: "Platform admin" })).toBeVisible();
  await expect(memberPage.getByTestId("admin-account").filter({ hasText: admin.email })).toBeVisible();
  await expect(memberPage.getByRole("heading", { name: "Admins" })).toHaveCount(0);
  await expect(memberPage.getByRole("button", { name: "Add admin" })).toHaveCount(0);

  // Promote, then demote again: the role select saves on change.
  const memberRole = memberRow.getByLabel(`Role for ${member.email}`);
  await memberRole.selectOption("super");
  await expect(memberRole).toBeEnabled(); // saved
  await expect(memberRole).toHaveValue("super");
  await memberPage.reload();
  await expect(memberPage.getByRole("heading", { name: "Admins" })).toBeVisible();
  await memberRole.selectOption("support");
  await expect(memberRole).toBeEnabled();
  await expect(memberRole).toHaveValue("support");
  await memberPage.reload();
  await expect(memberPage.getByRole("heading", { name: "Platform admin" })).toBeVisible();
  await expect(memberPage.getByRole("heading", { name: "Admins" })).toHaveCount(0);

  await memberRow.getByRole("button", { name: "Remove" }).click();
  await adminPage.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(memberRow).toHaveCount(0);
  await memberPage.goto("/admin");
  await expect(memberPage.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await adminCtx.close();
  await memberCtx.close();
});
