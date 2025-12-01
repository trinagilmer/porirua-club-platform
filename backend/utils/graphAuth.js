// backend/utils/graphAuth.js
const { cca } = require("../auth/msal");

// App-only Graph token helper (no session required)
async function getAppToken(scopes = ["https://graph.microsoft.com/.default"]) {
  try {
    const result = await cca.acquireTokenByClientCredential({ scopes });
    return result?.accessToken || null;
  } catch (err) {
    console.error("[GraphAuth] Failed to acquire app token:", err.message);
    return null;
  }
}

module.exports = { getAppToken };
