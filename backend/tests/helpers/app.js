const request = require("supertest");
const app = require("../../app");

function createAgent() {
  return request.agent(app);
}

async function login(agent, email, password) {
  return agent
    .post("/auth/login")
    .type("form")
    .send({ email, password })
    .redirects(1);
}

module.exports = {
  app,
  createAgent,
  login,
};
