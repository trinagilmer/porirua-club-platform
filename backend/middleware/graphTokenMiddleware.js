// backend/middleware/graphTokenMiddleware.js
const { cca } = require("../auth/msal");

/**
 * 🧠 Middleware: Ensures a valid Microsoft Graph access token.
 * - If expired or near expiry → refresh silently
 * - If missing → redirect to /auth/graph/login
 */
async function ensureGraphToken(req, res, next) {
  try {
    if (!req.session.graphToken || !req.session.graphTokenExpires) {
      console.warn("⚠️ No Microsoft Graph token found. Redirecting to login...");
      return res.redirect("/auth/graph/login");
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = req.session.graphTokenExpires;

    // If token expires in less than 2 minutes, refresh it
    if (exp - now < 120) {
      console.log("🔄 Token expiring soon. Attempting silent refresh...");
      try {
        const refreshed = await cca.acquireTokenSilent({
          account: req.session.account,
          scopes: ["https://graph.microsoft.com/.default"],
        });

        req.session.graphToken = refreshed.accessToken;
        req.session.graphTokenExpires = Math.floor(refreshed.expiresOn.getTime() / 1000);

        console.log("✅ Microsoft Graph token refreshed successfully.");
      } catch (refreshError) {
        console.error("❌ Silent token refresh failed:", refreshError.message);
        console.warn("Redirecting to Microsoft login...");
        return res.redirect("/auth/graph/login");
      }
    }

    // Continue to the next route if token is valid
    next();
  } catch (err) {
    console.error("💥 ensureGraphToken middleware error:", err.message);
    res.status(500).send("Internal Microsoft authentication error.");
  }
}

module.exports = { ensureGraphToken };
