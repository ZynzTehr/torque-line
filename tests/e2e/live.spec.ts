import { expect, test, type Page } from "@playwright/test";

// Runs against a real Neon branch: LIVE=1 npx playwright test live --project=desktop
// Creates real users, so never against production. Pull the test branch's env to its own file and layer it over .env.local:
//   neon env pull --branch e2e-20261026 --file .env.e2e && set -a && . ./.env.local && . ./.env.e2e && set +a
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const stamp = `${Date.now()}`;
const owner = { name: "Avery Test", email: `e2e+a${stamp}@example.com`, password: `Torque-${stamp}!` };
const other = { name: "Blake Test", email: `e2e+b${stamp}@example.com`, password: `Torque-${stamp}?` };
const shared: { unitUrl?: string; attachmentUrl?: string; storage?: string } = {};

async function signUp(page: Page, who: typeof owner) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

/** A real JPEG produced by the browser, so the server's signature check sees genuine bytes. */
async function jpegFromCanvas(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 48;
    const g = c.getContext("2d")!;
    g.fillStyle = "#334155"; g.fillRect(0, 0, 64, 48);
    g.fillStyle = "#f87171"; g.fillRect(20, 14, 24, 20);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

test("anonymous visitors are sent to sign in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
});

test("an owner signs up and their fleet is created", async ({ page, context }) => {
  await signUp(page, owner);
  await expect(page.getByRole("heading", { name: "Add your first unit." })).toBeVisible();
  shared.storage = JSON.stringify(await context.storageState());
});

test("maintenance flow persists to Postgres", async ({ browser }) => {
  const context = await browser.newContext({ storageState: JSON.parse(shared.storage!) });
  const page = await context.newPage();
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "+ Add equipment" }).click();
  await page.getByLabel("Unit number").fill("101");
  await page.getByLabel("Make").fill("Freightliner");
  await page.getByLabel("Model").fill("Cascadia");
  await page.getByRole("button", { name: "Add unit" }).click();
  await page.waitForURL(/\/equipment\/[0-9a-f-]{36}$/);
  shared.unitUrl = page.url();
  await expect(page.getByRole("heading", { name: "Unit 101" })).toBeVisible();
  await expect(page.getByText("Oil & Filter Change")).toBeVisible();

  await page.getByRole("button", { name: "Update reading" }).click();
  await page.getByLabel("Odometer", { exact: true }).fill("482150");
  await page.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByText("482,150 mi").first()).toBeVisible();

  await page.getByRole("button", { name: "Update reading" }).click();
  await page.getByLabel("Odometer", { exact: true }).fill("470000");
  await page.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByText("This reading is lower than the one on file.")).toBeVisible();
  await page.getByLabel("Reason").fill("Instrument cluster replaced");
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("470,000 mi").first()).toBeVisible();

  await page.getByRole("button", { name: "Log service" }).first().click();
  await page.getByLabel("Schedule item").selectOption({ index: 1 });
  await page.getByLabel("Cost (USD)").fill("289.50");
  await page.getByLabel("Shop").fill("Rush Truck Center");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Rush Truck Center")).toBeVisible();
  await expect(page.getByText("$289.50").first()).toBeVisible();
  // Regression: logging a service right after a confirmed lower reading must not restore the old value.
  await page.reload();
  await expect(page.getByText("470,000 mi").first()).toBeVisible();
  await expect(page.getByText("482,150 mi")).toHaveCount(0);

  await page.goto("/fuel");
  await page.getByRole("button", { name: "+ Fuel stop" }).click();
  await page.getByLabel("Diesel subtotal").fill("469.83");
  await page.getByLabel("DEF subtotal").fill("17.50");
  await page.getByRole("button", { name: "Save stop" }).click();
  await expect(page.getByText("$487.33").first()).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("$289.50").first()).toBeVisible();
  await context.close();
});

test("a diagnosis keeps its photo in object storage", async ({ browser }) => {
  const context = await browser.newContext({ storageState: JSON.parse(shared.storage!) });
  const page = await context.newPage();
  await page.goto("/diagnostics");
  await page.getByLabel("What is it doing?").fill("Loses power climbing grades after 20 minutes. Check engine light on.");
  await page.locator('input[type="file"]').setInputFiles({ name: "dash.jpg", mimeType: "image/jpeg", buffer: await jpegFromCanvas(page) });
  await expect(page.getByRole("button", { name: "Remove photo 1" })).toBeVisible();
  await page.getByRole("button", { name: "Find probable causes" }).click();
  await page.waitForURL(/\/diagnostics\/[0-9a-f-]{36}/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: /Loses power climbing grades/ })).toBeVisible();

  const photo = page.getByRole("img", { name: "Photo 1 of the problem" });
  await expect(photo).toBeVisible();
  shared.attachmentUrl = new URL(await photo.getAttribute("src") ?? "", page.url()).toString();
  const res = await context.request.get(shared.attachmentUrl);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect((await res.body()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  await context.close();
});

test("another fleet cannot see the first fleet's unit or files", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, other);
  // The page shell streams before the fleet check runs, so the HTTP status stays 200 (Partial Prerendering);
  // what matters is that the not-found screen renders and none of the other fleet's data does.
  await page.goto(shared.unitUrl!);
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await expect(page.getByText("Unit 101")).toHaveCount(0);
  await expect(page.getByText("Freightliner")).toHaveCount(0);
  expect((await context.request.get(shared.attachmentUrl!)).status()).toBe(404);
  await page.goto("/equipment");
  await expect(page.getByText("No units yet.")).toBeVisible();
  await context.close();

  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(shared.attachmentUrl!)).status()).toBe(401);
  await anonymous.close();
});

test("the gear style picked in Settings applies at once and survives a reload", async ({ browser }) => {
  const context = await browser.newContext({ storageState: JSON.parse(shared.storage!) });
  const page = await context.newPage();
  await page.goto("/settings");
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-gear-style", "amber");
  await page.getByRole("radio", { name: "Amber" }).click();
  await expect(html).toHaveAttribute("data-gear-style", "amber");
  await page.reload();
  await expect(html).toHaveAttribute("data-gear-style", "amber");
  await expect(page.getByRole("radio", { name: "Amber" })).toHaveAttribute("aria-checked", "true");
  await context.close();
});

test("the owner can sign out, and the dashboard then asks them to sign in", async ({ browser }) => {
  const context = await browser.newContext({ storageState: JSON.parse(shared.storage!) });
  const page = await context.newPage();
  await page.goto("/settings");
  await expect(page.getByText(`Signed in as ${owner.email}`)).toBeVisible();

  // The sidebar offers it too; on a phone the sidebar sits behind the menu button.
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await expect(page.locator("#sidebar").getByRole("button", { name: "Sign out" })).toBeVisible();
  if (await menu.isVisible()) await page.getByRole("button", { name: "Close navigation" }).click();

  await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/auth\/sign-in/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await context.close();
});
