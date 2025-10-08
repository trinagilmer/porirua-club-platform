/**
 * 📡 Microsoft Graph Service
 * Handles outbound email sending via Microsoft Graph API
 * Supports attachments (base64-encoded)
 */

const fetch = require("node-fetch");

/**
 * Send an email using Microsoft Graph.
 *
 * @param {string} accessToken - Valid Graph API token
 * @param {Object} mailData
 * @param {string} mailData.to - Recipient email
 * @param {string} mailData.subject - Email subject
 * @param {string} mailData.body - HTML or plain text body
 * @param {Array} [mailData.attachments] - Optional attachments
 */
async function sendMail(accessToken, { to, subject, body, attachments = [] }) {
  if (!accessToken) throw new Error("Missing Microsoft Graph access token");
  if (!to) throw new Error("Recipient email missing");

  const message = {
    message: {
      subject: subject || "(no subject)",
      body: {
        contentType: "HTML",
        content: body || "",
      },
      toRecipients: [
        {
          emailAddress: { address: to },
        },
      ],
      attachments: attachments.map((att) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.name,
        contentType: att.contentType || "application/octet-stream",
        contentBytes: att.contentBytes,
      })),
    },
    saveToSentItems: true,
  };

  const sharedMailbox = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
  const graphUrl = `https://graph.microsoft.com/v1.0/users('${sharedMailbox}')/sendMail`;

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

  console.log(`📧 Email successfully sent to ${to}`);
  return { success: true };
}

module.exports = { sendMail };
