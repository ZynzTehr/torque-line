import { expect, test } from "@playwright/test";

test("landing renders the brand, headline and entry button without horizontal overflow", async ({ page }, info) => {
  await page.goto("/");
  // toBeVisible() accepts opacity 0, so wait for the entrance sequence to finish fading the hero in.
  const hero = page.locator(".landing-hero");
  await expect(hero).toHaveClass(/hero-visible/, { timeout: 6000 });
  await expect.poll(() => hero.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 3000 }).toBe(1);
  await expect(page.getByRole("heading", { level: 1, name: "Stay Ahead of Overdue Service" })).toBeInViewport();
  await expect(page.getByRole("img", { name: "Torqueline" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open my fleet/ })).toBeEnabled();

  const overflow = await page.evaluate(() => {
    const hero = document.querySelector(".landing-hero-center")!.getBoundingClientRect();
    return { hero: [Math.round(hero.left), Math.round(hero.right)], viewport: window.innerWidth };
  });
  expect(overflow.hero[0]).toBeGreaterThanOrEqual(0);
  expect(overflow.hero[1]).toBeLessThanOrEqual(overflow.viewport);

  await page.screenshot({ path: `test-results/landing-${info.project.name}.png` });
});

test("reduced motion shows the hero immediately", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".landing-hero")).toHaveClass(/hero-visible/, { timeout: 1000 });
  await context.close();
});
