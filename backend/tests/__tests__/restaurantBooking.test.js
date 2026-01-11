const { createAgent, login } = require("../helpers/app");

function nextDateForDay(targetDow) {
  const now = new Date();
  const date = new Date(now);
  const currentDow = date.getDay();
  const delta = (targetDow - currentDow + 7) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

describe("restaurant booking flows", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  const bookingDate = nextDateForDay(5); // Friday matches seeded service

  test("public booking form accepts a request", async () => {
    const agent = createAgent();
    const res = await agent
      .post("/calendar/restaurant/book")
      .type("form")
      .send({
        party_name: "Test Public Booking",
        contact_email: "public@example.com",
        contact_phone: "021111111",
        booking_date: bookingDate,
        booking_time: "18:00",
        size: 2,
        notes: "Public booking test",
      });
    expect([302, 200]).toContain(res.status);
  });

  test("admin booking create succeeds", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const res = await agent
      .post("/calendar/restaurant/bookings")
      .type("form")
      .send({
        booking_date: bookingDate,
        booking_time: "19:00",
        party_name: "Test Admin Booking",
        size: 4,
        status: "pending",
        channel: "internal",
      });
    expect([302, 200]).toContain(res.status);
  });
});
