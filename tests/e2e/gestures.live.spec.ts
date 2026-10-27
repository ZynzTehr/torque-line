import { expect, test, type Page } from "@playwright/test";

// Touch gestures on a phone viewport against a real Neon branch:
// LIVE=1 npx playwright test gestures --project=phone
test.skip(!process.env.LIVE, "set LIVE=1 to run against a real Neon branch");
test.skip(({ hasTouch }) => !hasTouch, "touch gestures need a touch-screen device profile");
test.describe.configure({ mode: "serial", timeout: 120_000 });

/** A real touch swipe through the Chrome DevTools Protocol, so the page sees pointerType "touch". */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8, stepMs = 16) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t) });
    await page.waitForTimeout(stepMs);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("phone gestures: sheet swipe-down, section swipe, row swipe actions", async ({ page }) => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`; // desktop and phone run at once: the same millisecond must not mean the same email
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill("Phone Test");
  await page.getByLabel("Email").fill(`e2e+p${stamp}@example.com`);
  await page.getByLabel("Password").fill(`Torque-${stamp}!`);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  await page.getByRole("button", { name: "+ Add equipment" }).click();
  await page.getByLabel("Unit number").fill("101");
  await page.getByRole("button", { name: "Add unit" }).click();
  await page.waitForURL(/\/equipment\/[0-9a-f-]{36}$/);

  // Bottom sheet: swipe down on the handle area to dismiss.
  await page.getByRole("button", { name: "Update reading" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  await swipe(page, { x: box.x + box.width / 2, y: box.y + 12 }, { x: box.x + box.width / 2, y: box.y + 320 }, 10);
  await expect(sheet).toBeHidden();

  // Section swipe: left from Dashboard goes to Equipment, right comes back.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Fleet workboard" })).toBeVisible();
  const vw = page.viewportSize()!.width;
  await swipe(page, { x: vw * 0.85, y: 260 }, { x: vw * 0.15, y: 270 });
  await page.waitForURL("**/equipment");
  await expect(page.getByRole("link", { name: "Equipment", exact: true }).last()).toHaveAttribute("aria-current", "page");
  await swipe(page, { x: vw * 0.15, y: 260 }, { x: vw * 0.85, y: 265 });
  await page.waitForURL("**/dashboard");

  // A vertical scroll gesture must not change section.
  await swipe(page, { x: vw / 2, y: 500 }, { x: vw / 2 + 10, y: 200 });
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/dashboard$/);

  // Row swipe: reveal the unit's actions and use one.
  await page.goto("/equipment");
  const row = page.locator(".swipe-row").first();
  await expect(row).toBeVisible(); // the list streams in after the shell
  const rb = (await row.boundingBox())!;
  // Hidden actions are out of the accessibility tree and tab order until revealed.
  const hidden = row.locator("button", { hasText: /^Service$/ });
  await expect(hidden).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("button", { name: "Service", exact: true })).toHaveCount(0);
  await swipe(page, { x: rb.x + rb.width * 0.8, y: rb.y + rb.height / 2 }, { x: rb.x + rb.width * 0.15, y: rb.y + rb.height / 2 });
  const reveal = page.getByRole("button", { name: "Service", exact: true });
  await expect(reveal).toHaveAttribute("tabindex", "0");
  await reveal.click();
  await expect(page.getByRole("dialog", { name: /Log service/ })).toBeVisible();

  await page.screenshot({ path: "test-results/gestures-phone-final.png" });
});
