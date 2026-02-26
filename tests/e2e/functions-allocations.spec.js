const { test, expect } = require("@playwright/test");

test("function allocations can be added from edit form", async ({ page }) => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  const today = new Date().toISOString().slice(0, 10);

  await page.goto("/auth/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

  await page.goto("/functions/new");
  await page.fill('input[name="event_name"]', "E2E Allocations");
  await page.fill('input[name="event_date"]', today);

  // Select a primary room (first non-empty option).
  const primarySelect = page.locator('select[name="room_id"]');
  const primaryValue = await primarySelect
    .locator("option")
    .nth(1)
    .evaluate((option) => option.value);
  if (primaryValue) {
    await primarySelect.selectOption(primaryValue);
  }

  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]'),
  ]);

  const detailUrl = page.url();
  await page.goto(`${detailUrl}/edit`);

  await page.click("#addAllocationRow");

  const allocationRow = page.locator(".allocation-row").last();
  const roomSelect = allocationRow.locator('select[name="allocation_room_id"]');
  const roomOption = await roomSelect
    .locator("option")
    .nth(1)
    .evaluate((option) => ({
      value: option.value,
      label: option.textContent.trim(),
    }));
  await roomSelect.selectOption(roomOption.value);
  await allocationRow.locator('input[name="allocation_start_date"]').fill(today);
  await allocationRow.locator('input[name="allocation_start_time"]').fill("18:00");
  await allocationRow.locator('input[name="allocation_end_date"]').fill(today);
  await allocationRow.locator('input[name="allocation_end_time"]').fill("22:00");
  await allocationRow.locator('input[name="allocation_notes"]').fill("E2E allocation note");

  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]'),
  ]);

  const allocationsBlock = page.locator(".detail-item", { hasText: "Room allocations" });
  await expect(allocationsBlock).toBeVisible();
  await expect(allocationsBlock).toContainText("E2E allocation note");
  await expect(allocationsBlock).toContainText(roomOption.label);

  await expect(page.locator(".detail-item", { hasText: "Room allocations" })).toContainText(
    roomOption.label
  );

  await page.goto(`${detailUrl}/edit`);
  const persistedNotes = page.locator('input[name="allocation_notes"]').first();
  await expect(persistedNotes).toHaveValue("E2E allocation note");

  await page.goto(`${detailUrl}/run-sheet`);
  await expect(page.locator("body")).toContainText("Room allocations");
  await expect(page.locator("body")).toContainText(roomOption.label);
  await expect(page.locator("body")).toContainText("E2E allocation note");
});

test("allocation removal and blank dates behave correctly", async ({ page }) => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  const today = new Date().toISOString().slice(0, 10);

  await page.goto("/auth/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

  await page.goto("/functions/new");
  await page.fill('input[name="event_name"]', "E2E Allocation Remove");
  await page.fill('input[name="event_date"]', today);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

  const detailUrl = page.url();
  await page.goto(`${detailUrl}/edit`);

  await page.click("#addAllocationRow");
  const allocationRow = page.locator(".allocation-row").last();
  const roomSelect = allocationRow.locator('select[name="allocation_room_id"]');
  const roomOption = await roomSelect
    .locator("option")
    .nth(1)
    .evaluate((option) => ({
      value: option.value,
      label: option.textContent.trim(),
    }));
  await roomSelect.selectOption(roomOption.value);
  await allocationRow.locator('input[name="allocation_notes"]').fill("No dates allocation");

  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]'),
  ]);

  const allocationsBlock = page.locator(".detail-item", { hasText: "Room allocations" });
  await expect(allocationsBlock).toContainText("No dates allocation");
  await expect(allocationsBlock).toContainText(roomOption.label);

  await page.goto(`${detailUrl}/edit`);
  await page.click(".remove-allocation");
  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]'),
  ]);

  await expect(page.locator(".detail-item", { hasText: "Room allocations" }))
    .toContainText("No room allocations set.");
});

test("allocation validation blocks end before start", async ({ page }) => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  const today = new Date().toISOString().slice(0, 10);

  await page.goto("/auth/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

  await page.goto("/functions/new");
  await page.fill('input[name="event_name"]', "E2E Allocation Validation");
  await page.fill('input[name="event_date"]', today);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

  const detailUrl = page.url();
  await page.goto(`${detailUrl}/edit`);

  await page.click("#addAllocationRow");
  const allocationRow = page.locator(".allocation-row").last();
  const roomSelect = allocationRow.locator('select[name="allocation_room_id"]');
  const allocationOptions = await roomSelect.locator("option").count();
  test.skip(allocationOptions < 2, "Need at least one room option for allocations");

  await roomSelect.selectOption({ index: 1 });
  await allocationRow.locator('input[name="allocation_start_date"]').fill(today);
  await allocationRow.locator('input[name="allocation_start_time"]').fill("18:00");
  await allocationRow.locator('input[name="allocation_end_date"]').fill(today);
  await allocationRow.locator('input[name="allocation_end_time"]').fill("17:00");

  await page.click('button[type="submit"]');
  await expect(page.locator("#allocationError")).toBeVisible();
  await expect(page.locator("#allocationError")).toContainText(
    "Allocation end must be after start."
  );
  await expect(page).toHaveURL(/\/functions\/.*\/edit/);
});
