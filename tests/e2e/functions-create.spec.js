const { test, expect } = require("@playwright/test");

test("create function form submits", async ({ page }) => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  await page.goto("/auth/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

  await page.goto("/functions/new");
  await page.fill('input[name="event_name"]', "E2E Function");
  await page.fill('input[name="event_date"]', new Date().toISOString().slice(0, 10));
  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]'),
  ]);
  await expect(page.url()).toContain("/functions/");
});
