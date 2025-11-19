const { pool } = require("../db");

const DEFAULT_TEMPLATE_SUBJECT = "How was your experience at Porirua Club?";
const DEFAULT_TEMPLATE_BODY =
  "<p>Hi {{NAME}},</p><p>Thank you for choosing Porirua Club for {{EVENT_NAME}} on {{EVENT_DATE}}.</p><p>We'd love to know how everything went — it only takes a minute.</p><p><a href=\"{{SURVEY_LINK}}\">Share your feedback</a></p>";
const DEFAULT_SURVEY_HEADER =
  "<h1>Tell us how we did</h1><p>Your feedback helps us create even better experiences.</p>";
const DEFAULT_EVENT_HEADER =
  "<p class=\"text-uppercase fw-semibold tracking-wide mb-1\">Porirua Club</p><h1 class=\"display-4 fw-bold mb-3\">Live entertainment &amp; events</h1><p class=\"lead mb-0\">Discover upcoming music, comedy, and special nights at the Club.</p>";

const DEFAULT_FUNCTION_QUESTIONS = {
  overallLabel: "Overall, how was your experience?",
  showService: true,
  serviceLabel: "How would you rate our service?",
  showRecommend: true,
  recommendLabel: "Would you recommend us?",
  showComments: true,
  commentsLabel: "Anything we could improve?",
};

const DEFAULT_RESTAURANT_QUESTIONS = {
  overallLabel: "Overall, how was your dining experience?",
  showService: true,
  serviceLabel: "How would you rate our food & service?",
  showRecommend: true,
  recommendLabel: "Would you dine with us again?",
  showComments: true,
  commentsLabel: "Anything we could improve?",
};

const DEFAULT_SETTINGS = {
  auto_functions: true,
  auto_restaurant: true,
  send_delay_days: 1,
  reminder_days: 0,
  email_subject: DEFAULT_TEMPLATE_SUBJECT,
  email_body_html: DEFAULT_TEMPLATE_BODY,
  survey_header_html: DEFAULT_SURVEY_HEADER,
  events_header_html: DEFAULT_EVENT_HEADER,
  function_question_config: DEFAULT_FUNCTION_QUESTIONS,
  restaurant_question_config: DEFAULT_RESTAURANT_QUESTIONS,
};

function normalizeSettings(row = {}) {
  return {
    id: row.id,
    auto_functions: Boolean(row.auto_functions ?? DEFAULT_SETTINGS.auto_functions),
    auto_restaurant: Boolean(row.auto_restaurant ?? DEFAULT_SETTINGS.auto_restaurant),
    send_delay_days:
      row.send_delay_days !== undefined ? Number(row.send_delay_days) : DEFAULT_SETTINGS.send_delay_days,
    reminder_days:
      row.reminder_days !== undefined ? Number(row.reminder_days) : DEFAULT_SETTINGS.reminder_days,
    email_subject: row.email_subject || DEFAULT_SETTINGS.email_subject,
    email_body_html: row.email_body_html || DEFAULT_SETTINGS.email_body_html,
    survey_header_html: row.survey_header_html || DEFAULT_SETTINGS.survey_header_html,
    events_header_html: row.events_header_html || DEFAULT_SETTINGS.events_header_html,
    function_question_config: row.function_question_config || DEFAULT_FUNCTION_QUESTIONS,
    restaurant_question_config: row.restaurant_question_config || DEFAULT_RESTAURANT_QUESTIONS,
  };
}

async function getFeedbackSettings() {
  const existing = await pool.query(
    "SELECT * FROM feedback_settings ORDER BY id DESC LIMIT 1;"
  );
  if (!existing.rows[0]) {
    const insert = await pool.query(
      `INSERT INTO feedback_settings
        (auto_functions, auto_restaurant, send_delay_days, reminder_days, email_subject, email_body_html, survey_header_html, events_header_html, function_question_config, restaurant_question_config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *;`,
      [
        DEFAULT_SETTINGS.auto_functions,
        DEFAULT_SETTINGS.auto_restaurant,
        DEFAULT_SETTINGS.send_delay_days,
        DEFAULT_SETTINGS.reminder_days,
        DEFAULT_SETTINGS.email_subject,
        DEFAULT_SETTINGS.email_body_html,
        DEFAULT_SETTINGS.survey_header_html,
        DEFAULT_SETTINGS.events_header_html,
        JSON.stringify(DEFAULT_FUNCTION_QUESTIONS),
        JSON.stringify(DEFAULT_RESTAURANT_QUESTIONS),
      ]
    );
    return normalizeSettings(insert.rows[0]);
  }
  return normalizeSettings(existing.rows[0]);
}

function renderTemplate(template, context = {}) {
  if (!template) return "";
  return template.replace(/{{\s*([\w_]+)\s*}}/g, (match, key) => {
    const value = context[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function normalizeQuestionConfig(config, defaults) {
  const source = config || {};
  return {
    overallLabel: source.overallLabel || defaults.overallLabel,
    showService: source.showService !== undefined ? Boolean(source.showService) : defaults.showService,
    serviceLabel: source.serviceLabel || defaults.serviceLabel,
    showRecommend:
      source.showRecommend !== undefined ? Boolean(source.showRecommend) : defaults.showRecommend,
    recommendLabel: source.recommendLabel || defaults.recommendLabel,
    showComments:
      source.showComments !== undefined ? Boolean(source.showComments) : defaults.showComments,
    commentsLabel: source.commentsLabel || defaults.commentsLabel,
  };
}

function getQuestionConfig(settings, entityType) {
  if (entityType === "restaurant") {
    return normalizeQuestionConfig(settings.restaurant_question_config, DEFAULT_RESTAURANT_QUESTIONS);
  }
  return normalizeQuestionConfig(settings.function_question_config, DEFAULT_FUNCTION_QUESTIONS);
}

module.exports = {
  getFeedbackSettings,
  renderTemplate,
  getQuestionConfig,
  DEFAULT_EVENT_HEADER,
  DEFAULT_TEMPLATE_SUBJECT,
  DEFAULT_TEMPLATE_BODY,
  DEFAULT_SURVEY_HEADER,
  DEFAULT_FUNCTION_QUESTIONS,
  DEFAULT_RESTAURANT_QUESTIONS,
};
