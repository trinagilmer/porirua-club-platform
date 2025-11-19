const express = require("express");
const { pool } = require("../db");
const { getFeedbackSettings, getQuestionConfig } = require("../services/feedbackService");

const router = express.Router();

router.use(express.urlencoded({ extended: true }));

function formatDisplayDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-NZ", { weekday: "long", month: "long", day: "numeric" });
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
  const recommend =
    typeof req.body.recommend !== "undefined"
      ? String(req.body.recommend).toLowerCase() === "yes"
      : null;
  const comments = (req.body.comments || "").trim();
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
    await pool.query(
      `
      UPDATE feedback_responses
         SET rating_overall = $1,
             rating_service = $2,
             recommend = $3,
             comments = $4,
             status = 'completed',
             completed_at = NOW(),
             updated_at = NOW()
       WHERE id = $5;
      `,
      [ratingOverall, ratingService, recommend, comments || null, response.id]
    );
    const updated = {
      ...response,
      rating_overall: ratingOverall,
      rating_service: ratingService,
      recommend,
      comments,
      status: "completed",
      completed_at: new Date(),
    };
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
