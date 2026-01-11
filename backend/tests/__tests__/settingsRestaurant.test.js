const { createAgent, login } = require("../helpers/app");

describe("restaurant settings", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;

  test("add service via settings", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const res = await agent
      .post("/settings/restaurant/services/add")
      .type("form")
      .send({
        name: "Test Lunch",
        day_of_week: 1,
        start_time: "11:00",
        end_time: "14:00",
        slot_minutes: 30,
        turn_minutes: 90,
        active: "on",
      });
    expect([302, 200]).toContain(res.status);
  });
});
