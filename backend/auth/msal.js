// backend/auth/msal.js
if (process.env.NODE_ENV === "test" || process.env.EMAIL_MODE === "disabled") {
  module.exports = {
    cca: {
      acquireTokenByClientCredential: async () => ({ accessToken: "test-token" }),
    },
    getTokenSilent: async () => null,
  };
} else {
  const msal = require("@azure/msal-node");

  const msalConfig = {
    auth: {
      clientId: process.env.AZURE_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
    },
  };

  // ? Shared Microsoft Confidential Client
  const cca = new msal.ConfidentialClientApplication(msalConfig);

  console.log("?? MSAL Authority:", msalConfig.auth.authority);
  console.log("?? Azure credentials loaded?", {
    clientId: !!process.env.AZURE_CLIENT_ID,
    tenantId: !!process.env.AZURE_TENANT_ID,
    secret: process.env.AZURE_CLIENT_SECRET ? "(set)" : "(missing)",
  });
  // ?? Attempt silent token acquisition
  async function getTokenSilent(account) {
    if (!account) return null;
    try {
      const silentResult = await cca.acquireTokenSilent({
        account,
        scopes: ["https://graph.microsoft.com/.default"],
      });
      console.log("? [MSAL] Silent token acquired");
      return silentResult;
    } catch (err) {
      console.warn("?? [MSAL] Silent token failed:", err.message);
      return null;
    }
  }

  module.exports = { cca, getTokenSilent };
}
