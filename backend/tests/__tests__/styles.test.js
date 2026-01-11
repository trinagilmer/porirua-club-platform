const fs = require("fs");
const { execSync } = require("child_process");

describe("styles build", () => {
  test("sass build completes and outputs CSS", () => {
    execSync("npm run build-scss", { stdio: "inherit" });
    const cssPath = "backend/public/css/main.css";
    const stat = fs.statSync(cssPath);
    expect(stat.size).toBeGreaterThan(1000);
  });
});
