/**
 * 📡 Microsoft Graph Service (Enhanced + Debug Safe)
 * Handles outbound email sending via Microsoft Graph API
 * Supports attachments + multiple recipients (To, CC, BCC)
 * Automatically validates token & endpoint.
 */

const fetch = require("node-fetch");

/**
 * Send an email using Microsoft Graph.
 *
 * @param {string} accessToken - Valid Graph API token
 * @param {Object} mailData
 * @param {string|string[]} mailData.to - Single or multiple recipients
 * @param {string|string[]} [mailData.cc] - Optional CC recipients
 * @param {string|string[]} [mailData.bcc] - Optional BCC recipients
 * @param {string} mailData.subject - Email subject
 * @param {string} mailData.body - HTML or plain text body
 * @param {Array} [mailData.attachments] - Optional attachments
 * @param {string} [mailData.fromMailbox] - Optional mailbox to send from (overrides SHARED_MAILBOX)
 */
async function sendMail(accessToken, { to, cc = [], bcc = [], subject, body, attachments = [], fromMailbox }) {
  if (!accessToken) throw new Error("Missing Microsoft Graph access token");
  if (!to || (Array.isArray(to) && to.length === 0))
    throw new Error("Recipient email missing");

  // Decode token (for debugging roles)
  try {
    const jwtPayload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64").toString());
    console.log("🔐 Graph token type:", jwtPayload.id ? "Delegated (user)" : "Application");
    if (jwtPayload.roles) console.log("🔐 Token roles:", jwtPayload.roles);
    if (jwtPayload.scp) console.log("🔐 Token scopes:", jwtPayload.scp);
  } catch {
    console.warn("⚠️ Unable to decode Graph token payload");
  }

  // Normalization utility
  const normalize = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return value
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  };

  const toRecipients = normalize(to).map((email) => ({
    emailAddress: { address: email },
  }));

  const ccRecipients = normalize(cc).map((email) => ({
    emailAddress: { address: email },
  }));

  const bccRecipients = normalize(bcc).map((email) => ({
    emailAddress: { address: email },
  }));

  // Build message object
  const message = {
    message: {
      subject: subject || "(no subject)",
      body: {
        contentType: "HTML",
        content: body || "",
      },
      toRecipients,
      ccRecipients,
      bccRecipients,
      attachments: attachments.map((att) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.name,
        contentType: att.contentType || "application/octet-stream",
        contentBytes: att.contentBytes,
      })),
    },
    saveToSentItems: true,
  };

  // ✅ Correct Graph endpoint syntax
  const sharedMailbox = fromMailbox || process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
  const graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sharedMailbox)}/sendMail`;

  console.log("📡 Sending mail via Graph:", graphUrl);

  const response = await fetch(graphUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("❌ Graph API sendMail Error:", errorText);
    throw new Error(`Graph sendMail failed (${response.status}): ${errorText}`);
  }

  console.log(`✅ Email successfully sent to ${normalize(to).join(", ")}`);
  return { success: true };
}

module.exports = { sendMail };


