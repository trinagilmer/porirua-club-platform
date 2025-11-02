// backend/utils/graphAuth.js
const { cca } = require("../auth/msal");

/**
 * Returns a valid Microsoft Graph access token for this session.
 * Refreshes it silently using MSAL if it's expired or about to expire.
 */
async function getValidGraphToken(req) {
  if (!req.session.graphToken || !req.session.graphTokenExpires) {
    throw new Error("No Graph token in session");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = req.session.graphTokenExpires;

  // Refresh if the token expires within 2 minutes
  if (exp - now < 120) {
    console.log("🔄 Refreshing Microsoft Graph token...");
    try {
      const refreshed = await cca.acquireTokenSilent({
        account: req.session.account,
        scopes: ["https://graph.microsoft.com/.default"],
      });

      req.session.graphToken = refreshed.accessToken;
      req.session.graphTokenExpires = Math.floor(refreshed.expiresOn.getTime() / 1000);
      console.log("✅ Token refreshed successfully");
    } catch (err) {
      console.error("❌ Token refresh failed:", err.message);
      throw new Error("Graph token refresh failed, please re-login.");
    }
  }

  return req.session.graphToken;
}

module.exports = { getValidGraphToken };

