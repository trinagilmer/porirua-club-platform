// backend/auth/msal.js
const msal = require("@azure/msal-node");

const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
};

// ✅ Shared Microsoft Confidential Client
const cca = new msal.ConfidentialClientApplication(msalConfig);

console.log("🔗 MSAL Authority:", msalConfig.auth.authority);
console.log("🔑 Azure credentials loaded?", {
  clientId: !!process.env.AZURE_CLIENT_ID,
  tenantId: !!process.env.AZURE_TENANT_ID,
  secret: process.env.AZURE_CLIENT_SECRET ? "(set)" : "(missing)",
});

module.exports = { cca };
