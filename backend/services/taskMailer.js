// /services/taskMailer.js
const { sendMail } = require("./graphService");

/**
 * Sends an assignment email via Microsoft Graph.
 * @param {string} accessToken - A valid Graph token (from session)
 * @param {Object} task - Task info
 * @param {Object} assignedUser - User info (must include email)
 * @param {Object} assignedBy - Assigning user info
 */
async function sendTaskAssignmentEmail(accessToken, task, assignedUser, assignedBy) {
  if (!accessToken) throw new Error("Missing Graph token for task email.");
  if (!assignedUser?.email) throw new Error("Assigned user has no email.");

  const subject = `📋 New Task Assigned: ${task.title}`;
  const body = `
    <p>Hi ${assignedUser.name || "there"},</p>
    <p>You have been assigned a new task:</p>
    <blockquote>
      <strong>${task.title}</strong><br>
      ${task.description || ""}
    </blockquote>
    <p><strong>Assigned by:</strong> ${assignedBy.name || "Unknown"}<br>
    <strong>Due:</strong> ${task.due_at ? new Date(task.due_at).toLocaleDateString() : "No due date"}</p>
    <p><a href="${process.env.APP_URL || "https://poriruaclub.co.nz"}/functions/${task.function_id}?tab=tasks">
      🔗 View Task in Dashboard
    </a></p>
    <hr>
    <p style="font-size:0.8em;color:#888;">This email was automatically sent by Porirua Club Platform.</p>
  `;

  await sendMail(accessToken, {
    to: assignedUser.email,
    subject,
    body,
  });
}

module.exports = { sendTaskAssignmentEmail };
