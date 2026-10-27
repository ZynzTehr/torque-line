import { expect, test, type Page } from "@playwright/test";

// Runs against a real Neon branch, never production (see live.spec.ts for the env setup). Desktop only:
// row actions are inline there; the phone swipe path is covered by gestures.live.spec.ts.
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`; // desktop and phone run at once: the same millisecond must not mean the same email
const owner = { name: "Rae Records", email: `e2e+r${stamp}@example.com`, password: `Torque-${stamp}!` };

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

test("units and service records can be corrected, removed, and found fleet-wide", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop flow");
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
  const unitUrl = page.url();

  // Log a service with a receipt photo attached as is (no AI read).
  await page.getByRole("button", { name: "Log service" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator('input[type="file"]').nth(1).setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: await jpeg(page) });
  await expect(sheet.getByText("Saved with the record")).toBeVisible();
  await sheet.getByLabel("Service", { exact: true }).fill("Brake adjustment");
  await sheet.getByLabel("Cost (USD)").fill("150");
  await sheet.getByRole("button", { name: "Save service" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Brake adjustment")).toBeVisible();
  const receipt = page.getByRole("link", { name: "Receipt for Brake adjustment" });
  await expect(receipt).toBeVisible();
  const href = await receipt.getAttribute("href");
  expect((await page.request.get(href!)).headers()["content-type"]).toBe("image/jpeg");

  // Edit it.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(sheet.getByText("Receipt on file")).toBeVisible();
  await sheet.getByLabel("Cost (USD)").fill("175");
  await sheet.getByLabel("Notes").fill("Rear axle, both sides");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("$175.00").first()).toBeVisible();
  await expect(page.getByText("Rear axle, both sides")).toBeVisible();

  // Fleet-wide records, with filters.
  await page.getByRole("link", { name: "Records" }).first().click();
  await expect(page.getByRole("heading", { name: "Service records" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unit 301" })).toBeVisible();
  await page.getByLabel("From").fill("2099-01-01");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("No services match these filters.")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).first().click();
  await expect(page.getByText("Brake adjustment")).toBeVisible();

  // Delete it from the records page; its receipt goes with it.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No services logged yet.")).toBeVisible();
  expect((await page.request.get(href!)).status()).toBe(404);

  // Edit the unit, then remove it; its number is free again.
  await page.goto(unitUrl);
  await page.getByRole("button", { name: "Edit unit" }).click();
  await sheet.getByLabel("Make").fill("Kenworth");
  await sheet.getByLabel("Notes (optional)").fill("Bought used, 2026");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Kenworth")).toBeVisible();
  await expect(page.getByText("Bought used, 2026")).toBeVisible();

  await page.getByRole("button", { name: "Remove unit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove unit" }).click();
  await page.waitForURL("**/equipment");
  await page.goto(unitUrl);
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();

  await page.goto("/equipment");
  await page.getByRole("button", { name: /^\+ Add/ }).first().click();
  await page.getByLabel("Unit number").fill("301");
  await page.getByRole("dialog").getByRole("button", { name: "Add unit", exact: true }).click();
  await page.waitForURL(/\/equipment\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toBe(unitUrl);
});
