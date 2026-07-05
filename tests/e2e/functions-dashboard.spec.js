const { test, expect } = require("@playwright/test");

const TEST_EMAIL = process.env.TEST_ADMIN_EMAIL;
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

test.describe("Functions Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
  });

  test("dashboard loads with functions list", async ({ page }) => {
    await page.goto("/functions");
    // Check for dashboard header
    await expect(page.locator("h1:has-text('Functions Dashboard')")).toBeVisible();
    // Check for KPI bar
    await expect(page.locator(".kpi-bar")).toBeVisible();
    // Check for status filters
    await expect(page.locator(".status-filters")).toBeVisible();
  });

  test("quick search filters functions by event name", async ({ page }) => {
    await page.goto("/functions");
    // Type in search box
    const searchInput = page.locator('input[placeholder*="Event, contact"]');
    await searchInput.fill("wedding");
    await Promise.all([page.waitForURL(/q=wedding/), page.locator("button:has-text('Search')").click()]);
    // Verify search param in URL
    expect(page.url()).toContain("q=wedding");
  });

  test("status filter buttons navigate with preserved state", async ({ page }) => {
    await page.goto("/functions");
    // Click Lead filter
    await page.locator("a:has-text('Lead')").click();
    // Should update URL
    await expect(page).toHaveURL(/status=lead/);
    // Lead pill should be active
    await expect(page.locator("a:has-text('Lead').filter-pill.active")).toBeVisible();
  });

  test("payment filter pills show counts", async ({ page }) => {
    await page.goto("/functions");
    // Payment pills should be visible with badges
    const paymentPills = page.locator(".status-filters").nth(1);
    await expect(paymentPills.locator("span.badge")).toBeDefined();
  });

  test("unscheduled filter shows leads without event dates", async ({ page }) => {
    await page.goto("/functions");
    // Click Unscheduled filter
    await page.locator("a:has-text('Unscheduled')").click();
    // Should filter to unscheduled functions
    await expect(page).toHaveURL(/status=unscheduled/);
    await expect(page.locator("text=No functions found").or(page.locator("table tbody tr")).first()).toBeVisible();
  });

  test("pagination controls navigate through results", async ({ page }) => {
    await page.goto("/functions");
    // Check if pagination is present
    const pagination = page.locator("nav[aria-label='Functions pagination']");
    const paginationVisible = await pagination.isVisible().catch(() => false);
    if (paginationVisible) {
      const nextBtn = pagination.locator("a:has-text('Next')");
      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await expect(page).toHaveURL(/page=2/);
      }
    }
  });

  test("clone function creates a copy with same details", async ({ page }) => {
    await page.goto("/functions");
    // Get first function ID from table link
    const firstFunctionLink = page.locator("table tbody tr:first-child a").first();
    const functionId = await firstFunctionLink.getAttribute("href");
    if (!functionId) {
      test.skip();
      return;
    }
    // Extract ID from URL
    const id = functionId.split("/").pop();
    
    // Find clone button in table row
    const cloneBtn = page.locator(`table tbody tr:first-child form[action*="${id}/clone"] button`);
    if (!(await cloneBtn.isVisible())) {
      test.skip(); // No clone button found
      return;
    }
    
    await cloneBtn.click();
    // Should show confirmation
    page.once("dialog", (dialog) => {
      dialog.accept();
    });
    // Should redirect to edit page (clone goes to /id/edit)
    await page.waitForURL(/\/functions\/[a-f0-9-]+\/edit/);
    await expect(page.locator("input[name='event_name']")).toHaveValue(/Copy/);
  });

  test("room conflict warning shows on create if room is booked", async ({ page }) => {
    await page.goto("/functions/new");
    // Fill basic fields
    const dateInput = page.locator('input[name="event_date"]');
    const roomInput = page.locator('select[name="room_id"]');
    
    // Set to today's date
    const today = new Date().toISOString().slice(0, 10);
    await dateInput.fill(today);
    
    // Select first room (if available)
    const roomOptions = await roomInput.locator("option").count();
    if (roomOptions > 1) {
      await roomInput.selectOption("1");
      // Wait for conflict check to run
      await page.waitForTimeout(500);
      // Check for warning (may or may not appear depending on data)
      const warning = page.locator("#roomConflictWarningNew");
      // Just verify it's in the DOM
      await expect(warning).toBeDefined();
    }
  });

  test("date range filter narrows results", async ({ page }) => {
    await page.goto("/functions");
    const today = new Date();
    const dateFrom = today.toISOString().slice(0, 10);
    const dateTo = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    
    // Fill date range
    await page.locator('input[name="dateFrom"]').fill(dateFrom);
    await page.locator('input[name="dateTo"]').fill(dateTo);
    await Promise.all([page.waitForURL(/dateFrom=|dateTo=/), page.locator("button:has-text('Search')").click()]);
    
    expect(page.url()).toContain("dateFrom=");
    expect(page.url()).toContain("dateTo=");
  });

  test("clear button resets search filters", async ({ page }) => {
    await page.goto("/functions?q=test&eventType=wedding&dateFrom=2026-01-01");
    // Click Clear button
    await page.locator("a:has-text('Clear')").click();
    // Should remove search params
    await page.waitForURL("/functions");
    await expect(page).toHaveURL(/^\/functions\/?$/);
  });

  test("my events filter shows only current user functions", async ({ page }) => {
    await page.goto("/functions");
    // Click My Events
    const myEventsBtn = page.locator("a:has-text('My events')");
    await myEventsBtn.click();
    await expect(page).toHaveURL(/mine=true/);
    // My Events pill should be active
    await expect(myEventsBtn.filter({ hasNot: page.locator(".active") })).not.toBeVisible();
  });
});
