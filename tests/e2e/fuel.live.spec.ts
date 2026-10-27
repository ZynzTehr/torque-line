import { expect, test, type Page } from "@playwright/test";

// Runs against a real Neon branch, never production (see live.spec.ts for the env setup). Desktop only:
// row actions are inline there; the phone swipe path is covered by gestures.live.spec.ts.
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const stamp = `${Date.now()}`;

async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 48;
    c.getContext("2d")!.fillRect(0, 0, 64, 48);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

test("fuel stops can be corrected, filtered, and deleted with their receipt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop flow");
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill("Finn Fuel");
  await page.getByLabel("Email").fill(`e2e+f${stamp}@example.com`);
  await page.getByLabel("Password").fill(`Torque-${stamp}!`);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  await page.goto("/fuel");
  await expect(page.getByText("Add a tractor or reefer to start tracking fuel.")).toBeVisible();
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ Add equipment" }).click();
  await page.getByLabel("Unit number").fill("88");
  await page.getByRole("dialog").getByRole("button", { name: "Add unit", exact: true }).click();
  await page.waitForURL(/\/equipment\/[0-9a-f-]{36}$/);

  await page.goto("/fuel");
  await page.getByRole("button", { name: "+ Fuel stop" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Station").fill("Pilot #412");
  await sheet.getByLabel("Diesel gallons").fill("100");
  await sheet.getByRole("button", { name: "Save stop" }).click();
  await expect(sheet.getByText("Enter the Diesel subtotal, or clear that row.")).toBeVisible();
  await sheet.getByLabel("Diesel price per gallon").fill("4");
  await expect(sheet.getByLabel("Diesel subtotal")).toHaveValue("400.00");
  await sheet.locator('input[type="file"]').nth(1).setInputFiles({ name: "r.jpg", mimeType: "image/jpeg", buffer: await jpeg(page) });
  await expect(sheet.getByText("Saved with the record")).toBeVisible();
  await sheet.getByRole("button", { name: "Save stop" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("100 gal")).toBeVisible();
  const receipt = page.getByRole("link", { name: /^Receipt for Fuel stop/ });
  const href = await receipt.getAttribute("href");
  expect((await page.request.get(href!)).headers()["content-type"]).toBe("image/jpeg");

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(sheet.getByText("Receipt on file")).toBeVisible();
  await sheet.getByLabel("Diesel gallons").fill("110");
  await sheet.getByLabel("Notes").fill("Corrected gallons");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("110 gal")).toBeVisible();
  await expect(page.getByText("Corrected gallons")).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: "$440.00" }).first()).toBeVisible();

  const month = new Date().getMonth() + 1;
  await page.getByLabel("Month").selectOption(String((month % 12) + 1));
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("No fuel stops match these filters.")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).first().click();
  await expect(page.getByText("110 gal")).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No fuel stops yet. Add one from a receipt.")).toBeVisible();
  expect((await page.request.get(href!)).status()).toBe(404);
});
