module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  setupFiles: ["<rootDir>/backend/tests/setupEnv.js"],
  setupFilesAfterEnv: ["<rootDir>/backend/tests/setupTests.js"],
  globalSetup: "<rootDir>/backend/tests/globalSetup.js",
  globalTeardown: "<rootDir>/backend/tests/globalTeardown.js",
  verbose: true,
};
