const { createAgent, login } = require("../helpers/app");

describe("contacts API", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;

  test("create contact via API", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const res = await agent.post("/contacts").send({
      name: "Test Contact",
      email: "contact@example.com",
      phone: "021222222",
      company: "Test Co",
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeTruthy();
  });
});
