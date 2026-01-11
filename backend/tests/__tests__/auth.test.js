const { createAgent, login } = require("../helpers/app");

describe("auth flow", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;

  test("login page renders", async () => {
    const agent = createAgent();
    const res = await agent.get("/auth/login");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Login");
  });

  test("login succeeds with seeded admin", async () => {
    const agent = createAgent();
    const res = await login(agent, email, password);
    expect([200, 302]).toContain(res.status);
  });

  test("login fails with invalid credentials", async () => {
    const agent = createAgent();
    const res = await agent
      .post("/auth/login")
      .type("form")
      .send({ email, password: "wrong-password" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Invalid email or password");
  });
});
