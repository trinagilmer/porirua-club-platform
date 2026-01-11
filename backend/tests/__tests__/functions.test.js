const { createAgent, login } = require("../helpers/app");

describe("functions form", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;

  test("create function requires event name", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const res = await agent.post("/functions/new").type("form").send({
      event_name: "",
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Event name is required");
  });

  test("create function succeeds with minimal data", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const res = await agent.post("/functions/new").type("form").send({
      event_name: "Test Function",
      event_date: new Date().toISOString().slice(0, 10),
    });
    expect([302, 200]).toContain(res.status);
  });
});
