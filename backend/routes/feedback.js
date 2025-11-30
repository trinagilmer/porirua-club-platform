const express = require("express");
const { pool } = require("../db");
const { getFeedbackSettings, getQuestionConfig } = require("../services/feedbackService");
const { sendMail: graphSendMail } = require("../services/graphService");
const { cca } = require("../auth/msal");

const router = express.Router();

router.use(express.urlencoded({ extended: true }));

function formatDisplayDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-NZ", { weekday: "long", month: "long", day: "numeric" });
}

async function acquireGraphToken() {
  if (!cca) return null;
  try {
    const response = await cca.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    return response?.accessToken || null;
  } catch (err) {
    console.error("[Feedback] Failed to acquire Graph token:", err.message);
    return null;
  }
}

router.get("/:token", async (req, res) => {
  const { token } = req.params;
  try {
    const settings = await getFeedbackSettings();
    const { rows } = await pool.query(
      `
      SELECT r.*,
             f.event_name AS function_name,
             f.event_date AS function_date,
             rb.party_name AS booking_name,
             rb.booking_date AS booking_date
        FROM feedback_responses r
        LEFT JOIN functions f ON r.entity_type = 'function' AND f.id_uuid::text = r.entity_id
        LEFT JOIN restaurant_bookings rb ON r.entity_type = 'restaurant' AND rb.id::text = r.entity_id
       WHERE r.token = $1
       LIMIT 1;
      `,
      [token]
    );
    const response = rows[0] || null;
    const questionConfig = getQuestionConfig(
      settings,
      response?.entity_type || "function"
    );
    const alreadyCompleted = response && response.status === "completed";
    res.render("pages/feedback/form", {
      layout: "layouts/main",
      hideChrome: true,
      title: "Feedback",
      pageType: "feedback",
      entry: response,
      surveyHeaderHtml: settings.survey_header_html,
      errorMessage: null,
      success: alreadyCompleted,
      questionConfig,
      preview: false,
      formatDisplayDate,
    });
  } catch (err) {
    console.error("[Feedback] Failed to load token:", err);
    res.status(500).render("pages/feedback/form", {
      layout: "layouts/main",
      hideChrome: true,
      title: "Feedback",
      pageType: "feedback",
      entry: null,
      surveyHeaderHtml: "",
      errorMessage: "Something went wrong loading your survey link.",
      success: false,
      questionConfig: getQuestionConfig(await getFeedbackSettings(), "function"),
      preview: false,
      formatDisplayDate,
    });
  }
});

router.post("/:token", async (req, res) => {
  const { token } = req.params;
  const ratingOverall = parseInt(req.body.rating_overall, 10);
  const ratingService = req.body.rating_service ? parseInt(req.body.rating_service, 10) : null;
  const npsScore =
    typeof req.body.nps_score !== "undefined" && req.body.nps_score !== ""
      ? Math.min(10, Math.max(0, parseInt(req.body.nps_score, 10)))
      : null;
  const recommend =
    typeof req.body.recommend !== "undefined"
      ? String(req.body.recommend).toLowerCase() === "yes"
      : null;
  const rawComments = (req.body.comments || "").trim();
  const issueArea = (req.body.issue_area || "").trim();
  const issueTags = []
    .concat(req.body.issue_tags || [])
    .map((v) => String(v).trim())
    .filter(Boolean);
  let comments = rawComments;
  try {
    const settings = await getFeedbackSettings();
    const { rows } = await pool.query(
      `
      SELECT r.*,
             f.event_name AS function_name,
             f.event_date AS function_date,
             rb.party_name AS booking_name,
             rb.booking_date AS booking_date
        FROM feedback_responses r
        LEFT JOIN functions f ON r.entity_type = 'function' AND f.id_uuid::text = r.entity_id
        LEFT JOIN restaurant_bookings rb ON r.entity_type = 'restaurant' AND rb.id::text = r.entity_id
       WHERE r.token = $1
       LIMIT 1;
      `,
      [token]
    );
    const response = rows[0] || null;
    if (!response) {
      return res.status(404).render("pages/feedback/form", {
        layout: "layouts/main",
        hideChrome: true,
        title: "Feedback",
        pageType: "feedback",
        entry: null,
        surveyHeaderHtml: settings.survey_header_html,
        errorMessage: "This feedback link is no longer valid.",
        success: false,
        questionConfig: getQuestionConfig(settings, "function"),
        preview: false,
        formatDisplayDate,
      });
    }
    const questionConfig = getQuestionConfig(settings, response.entity_type);
    if (response.status === "completed") {
      return res.render("pages/feedback/form", {
        layout: "layouts/main",
        hideChrome: true,
        title: "Feedback",
        pageType: "feedback",
        entry: response,
        surveyHeaderHtml: settings.survey_header_html,
        errorMessage: null,
        success: true,
        questionConfig,
        preview: false,
        formatDisplayDate,
      });
    }
    if (!ratingOverall || ratingOverall < 1 || ratingOverall > 5) {
      return res.status(400).render("pages/feedback/form", {
        layout: "layouts/main",
        hideChrome: true,
        title: "Feedback",
        pageType: "feedback",
        entry: response,
        surveyHeaderHtml: settings.survey_header_html,
        errorMessage: "Please select an overall rating.",
        success: false,
        questionConfig,
        preview: false,
        formatDisplayDate,
      });
    }
    if (ratingOverall <= 2 && !rawComments) {
      return res.status(400).render("pages/feedback/form", {
        layout: "layouts/main",
        hideChrome: true,
        title: "Feedback",
        pageType: "feedback",
        entry: response,
        surveyHeaderHtml: settings.survey_header_html,
        errorMessage: "Please tell us what went wrong so we can improve.",
        success: false,
        questionConfig,
        preview: false,
        formatDisplayDate,
      });
    }
    if (response.entity_type === "restaurant" && issueArea) {
      comments = `Issue: ${issueArea}\n${rawComments}`;
    }
    const tags = Array.from(new Set(issueTags.concat(issueArea ? [issueArea] : [])));
    await pool.query(
      `
      UPDATE feedback_responses
         SET rating_overall = $1,
             rating_service = $2,
             nps_score = $3,
             recommend = $4,
             comments = $5,
             issue_tags = $6,
             status = 'completed',
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = $7;
      `,
      [
        ratingOverall,
        ratingService,
        npsScore,
        recommend,
        comments || null,
        tags.length ? tags : null,
        response.id,
      ]
    );
    const updated = {
      ...response,
      rating_overall: ratingOverall,
      rating_service: ratingService,
      nps_score: npsScore,
      recommend,
      issue_tags: tags,
      comments,
      status: "completed",
      completed_at: new Date(),
    };

    // Log to messages
    try {
      const subject = `Feedback received: ${ratingOverall}/5 (${response.entity_type || "feedback"})`;
      const plainBody = [
        `Rating: ${ratingOverall}/5`,
        ratingService ? `Service: ${ratingService}/5` : "",
        npsScore !== null && !Number.isNaN(npsScore) ? `NPS: ${npsScore}/10` : "",
        recommend !== null ? `Recommend: ${recommend ? "Yes" : "No"}` : "",
        comments ? `Comments: ${comments}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await pool.query(
        `
        INSERT INTO messages
          (related_function, from_email, to_email, subject, body, body_html, created_at, message_type)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'feedback');
        `,
        [
          response.entity_type === "function" ? response.entity_id : null,
          process.env.FEEDBACK_MAILBOX || process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz",
          response.contact_email || "",
          subject,
          plainBody,
          plainBody.replace(/\n/g, "<br>"),
        ]
      );
    } catch (logErr) {
      console.warn("[Feedback] Message log skipped:", logErr.message);
    }

    // Alert on low ratings
    if (ratingOverall <= 2) {
      try {
        const accessToken = await acquireGraphToken();
        if (accessToken) {
          const subject = `Low feedback alert: ${ratingOverall}/5`;
          const body = `
            <p>A feedback submission was received with a low rating.</p>
            <p><strong>Type:</strong> ${response.entity_type || "feedback"}<br>
               <strong>Rating:</strong> ${ratingOverall}/5<br>
               ${ratingService ? `<strong>Service:</strong> ${ratingService}/5<br>` : ""}
               ${recommend !== null ? `<strong>Recommend:</strong> ${recommend ? "Yes" : "No"}<br>` : ""}
               ${comments ? `<strong>Comments:</strong> ${comments.replace(/\n/g, "<br>")}` : ""}</p>
            <p>Contact: ${response.contact_email || "n/a"}</p>
          `;
          const to = process.env.RESTAURANT_NOTIFICATIONS || process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
          await graphSendMail(accessToken, {
            to,
            subject,
            body,
            fromMailbox: process.env.FEEDBACK_MAILBOX || process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz",
          });
        }
      } catch (alertErr) {
        console.warn("[Feedback] Low-rating alert skipped:", alertErr.message);
      }
    }
    res.render("pages/feedback/form", {
      layout: "layouts/main",
      hideChrome: true,
      title: "Feedback",
      pageType: "feedback",
      entry: updated,
      surveyHeaderHtml: settings.survey_header_html,
      errorMessage: null,
      success: true,
      questionConfig,
      preview: false,
      formatDisplayDate,
    });
  } catch (err) {
    console.error("[Feedback] Failed to submit response:", err);
    const settings = await getFeedbackSettings();
    res.status(500).render("pages/feedback/form", {
      layout: "layouts/main",
      hideChrome: true,
      title: "Feedback",
      pageType: "feedback",
      entry: null,
      surveyHeaderHtml: settings.survey_header_html,
      errorMessage: "Something went wrong saving your feedback.",
      success: false,
      questionConfig: getQuestionConfig(settings, "function"),
      preview: false,
      formatDisplayDate,
    });
  }
});

module.exports = router;
