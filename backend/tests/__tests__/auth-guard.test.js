const { createAgent } = require("../helpers/app");

describe("auth guard", () => {
  test("public routes stay accessible without authentication", async () => {
    const agent = createAgent();
    const res = await agent.get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  test("protected routes redirect to login", async () => {
    const agent = createAgent();
    const res = await agent.get("/settings/overview");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/auth/login");
  });
});
