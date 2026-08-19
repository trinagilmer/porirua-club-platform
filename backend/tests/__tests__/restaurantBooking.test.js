const request = require("supertest");
const { app, login } = require("../helpers/app");

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nextDateForDay(targetDow) {
  const now = new Date();
  const date = new Date(now);
  const currentDow = date.getDay();
  const delta = (targetDow - currentDow + 7) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return formatLocalDate(date);
}

describe("restaurant booking flows", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  const bookingDate = nextDateForDay(5); // Friday matches seeded service
  let server;
  beforeAll(() => {
    server = app.listen(0);
    server.unref();
  });
  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("public booking form accepts a request", async () => {
    const res = await request(server)
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

  test("Father's Day form is standalone and fixed to the event date", async () => {
    const res = await request(server).get("/calendar/restaurant/book/fathers-day");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Father&#39;s Day Buffet");
    expect(res.text).toContain("Eastwood Restaurant");
    expect(res.text).toContain('value="2026-09-06"');
    expect(res.text).not.toContain("portal-sidebar");
    expect(res.text).not.toContain("main-nav");
  });

  test("admin booking create succeeds", async () => {
    const agent = request.agent(server);
    try {
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
    } finally {
      if (typeof agent.close === "function") {
        await agent.close();
      }
    }
  });
});
