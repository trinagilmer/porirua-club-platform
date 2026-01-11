const { test, expect } = require("@playwright/test");

function nextDateForDay(targetDow) {
  const now = new Date();
  const date = new Date(now);
  const currentDow = date.getDay();
  const delta = (targetDow - currentDow + 7) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

test("public restaurant booking submits", async ({ page }) => {
  await page.goto("/calendar/restaurant/book");
  await page.fill('input[name="party_name"]', "E2E Public Booking");
  await page.fill('input[name="contact_email"]', "public@example.com");
  await page.fill('input[name="contact_phone"]', "021333333");

  const bookingDate = nextDateForDay(5);
  await page.evaluate(({ bookingDate }) => {
    const dateInput = document.getElementById("hiddenBookingDate");
    const timeInput = document.getElementById("hiddenBookingTime");
    if (dateInput) dateInput.value = bookingDate;
    if (timeInput) timeInput.value = "18:00";
  }, { bookingDate });

  await page.fill('input[name="size"]', "2");
  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]'),
  ]);
  await expect(page.locator(".alert.alert-success")).toContainText("Thanks!");
});
