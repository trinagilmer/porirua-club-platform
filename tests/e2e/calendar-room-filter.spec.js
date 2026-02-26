const { test, expect } = require("@playwright/test");

test("calendar room filters include allocation rooms", async ({ page }) => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  const today = new Date().toISOString().slice(0, 10);
  const title = `E2E Calendar Allocation ${Date.now()}`;

  await page.goto("/auth/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);

  await page.goto("/functions/new");
  await page.fill('input[name="event_name"]', title);
  await page.fill('input[name="event_date"]', today);

  // Pick a primary room if available.
  const primarySelect = page.locator('select[name="room_id"]');
  const primaryOptionCount = await primarySelect.locator("option").count();
  if (primaryOptionCount > 1) {
    const primaryValue = await primarySelect
      .locator("option")
      .nth(1)
      .evaluate((option) => option.value);
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
  const allocationOptions = await roomSelect.locator("option").count();
  test.skip(allocationOptions < 2, "Need at least one room option for allocations");
  const allocationOption = await roomSelect
    .locator("option")
    .nth(1)
    .evaluate((option) => ({
      value: option.value,
      label: option.textContent.trim(),
    }));
  await roomSelect.selectOption(allocationOption.value);
  await allocationRow.locator('input[name="allocation_notes"]').fill("Calendar filter allocation");

  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]'),
  ]);

  await page.goto("/calendar");
  const calendarShell = page.locator("#functionCalendar");
  await expect(calendarShell).toBeVisible();

  const eventTitle = page.locator(".fc-event", { hasText: title });
  await expect(eventTitle).toBeVisible();

  const targetRoomId = allocationOption.value;
  const roomButtons = page.locator(".calendar-room-btn");
  const btnCount = await roomButtons.count();
  let alternateRoomId = null;

  for (let i = 0; i < btnCount; i += 1) {
    const btn = roomButtons.nth(i);
    const id = await btn.getAttribute("data-room-id");
    const isActive = await btn.evaluate((el) => el.classList.contains("active"));
    if (id === targetRoomId) {
      if (!isActive) await btn.click();
    } else {
      if (!alternateRoomId && id) alternateRoomId = id;
      if (isActive) await btn.click();
    }
  }

  await expect(eventTitle).toBeVisible();

  if (alternateRoomId) {
    for (let i = 0; i < btnCount; i += 1) {
      const btn = roomButtons.nth(i);
      const id = await btn.getAttribute("data-room-id");
      const isActive = await btn.evaluate((el) => el.classList.contains("active"));
      if (id === alternateRoomId) {
        if (!isActive) await btn.click();
      } else if (isActive) {
        await btn.click();
      }
    }
    await expect(eventTitle).toHaveCount(0);
  }
});
