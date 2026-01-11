const { createAgent } = require("../helpers/app");

describe("auth guard", () => {
  test("protected routes redirect to login", async () => {
    const agent = createAgent();
    const res = await agent.get("/settings/overview");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/auth/login");
  });
});
