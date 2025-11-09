// ======================================================
// Menu Choices Settings Router
// ======================================================
const express = require("express");
const router = express.Router();
const { pool } = require("../../db");

function computeCogsPercent(price, cost) {
  const priceNum =
    price !== undefined && price !== null ? Number(price) : Number.NaN;
  const costNum =
    cost !== undefined && cost !== null ? Number(cost) : Number.NaN;
  if (!Number.isFinite(priceNum) || priceNum === 0) return 0;
  if (!Number.isFinite(costNum)) return 0;
  return Number(((costNum / priceNum) * 100).toFixed(2));
}

// Utility to fetch choices + related metadata
async function loadChoices() {
  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.name,
      c.description,
      c.category_id,
      choice_cat.name AS category_name,
      COALESCE(opts.data, '[]'::json) AS options,
      COALESCE(linked_cat.data, '[]'::json) AS categories,
      COALESCE(menus.data, '[]'::json) AS menus
    FROM menu_choices c
    LEFT JOIN menu_categories choice_cat ON choice_cat.id = c.category_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
               json_build_object(
                 'id', opt.id,
                 'name', opt.name,
                 'price', opt.price,
                 'cost', opt.cost,
                 'unit_id', opt.unit_id,
                 'unit_name', opt.unit_name,
               'unit_type', opt.unit_type,
               'cogs_percent', opt.cogs_percent
               )
               ORDER BY opt.id
             ) AS data
      FROM (
        SELECT o.id,
               o.name,
               o.price,
               o.cost,
               o.unit_id,
               o.cogs_percent,
               u.name AS unit_name,
               u.type AS unit_type
          FROM menu_options o
          LEFT JOIN menu_units u ON u.id = o.unit_id
         WHERE o.choice_id = c.id
         ORDER BY o.id
      ) opt
    ) opts ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(DISTINCT jsonb_build_object('id', cat.id, 'name', cat.name)) AS data
      FROM menu_choice_links l
      JOIN menus m ON m.id = l.menu_id
      LEFT JOIN menu_categories cat ON cat.id = m.category_id
      WHERE l.choice_id = c.id
    ) linked_cat ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(DISTINCT jsonb_build_object('id', m.id, 'name', m.name, 'category_id', m.category_id)) AS data
      FROM menu_choice_links l
      JOIN menus m ON m.id = l.menu_id
      WHERE l.choice_id = c.id
    ) menus ON TRUE
    ORDER BY LOWER(c.name)
    `
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category_id
      ? {
          id: row.category_id,
          name: row.category_name || "Unassigned",
        }
      : null,
    options: Array.isArray(row.options)
      ? row.options
      : JSON.parse(row.options || "[]"),
    categories: Array.isArray(row.categories)
      ? row.categories
      : JSON.parse(row.categories || "[]"),
    menus: Array.isArray(row.menus) ? row.menus : JSON.parse(row.menus || "[]"),
  }));
}

// ======================================================
// Page render
// ======================================================
router.get("/", async (req, res) => {
  try {
    const [choices, categories, units] = await Promise.all([
      loadChoices(),
      pool
        .query("SELECT id, name FROM menu_categories ORDER BY name ASC")
        .then((r) => r.rows),
      pool
        .query(
          "SELECT id, name, type FROM menu_units ORDER BY name ASC, id ASC"
        )
        .then((r) => r.rows),
    ]);

    res.locals.pageJs = ["/js/settings/menu-choices.js"];

    res.render("settings/menu-choices", {
      layout: "layouts/settings",
      title: "Settings - Menu Choices",
      pageType: "settings",
      activeTab: "menu-choices",
      choices,
      categories,
      units,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("⚠️  Error loading menu choices page:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load menu choices.",
      error: err.message,
      stack: err.stack,
    });
  }
});

// ======================================================
// API: List choices
// ======================================================
router.get("/api", async (_req, res) => {
  try {
    const [choices, categories, units] = await Promise.all([
      loadChoices(),
      pool
        .query("SELECT id, name FROM menu_categories ORDER BY name ASC")
        .then((r) => r.rows),
      pool
        .query("SELECT id, name, type FROM menu_units ORDER BY name ASC, id ASC")
        .then((r) => r.rows),
    ]);
    res.json({
      success: true,
      data: { choices, categories, units },
    });
  } catch (err) {
    console.error("GET /settings/menus/choices/api error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to load menu choices." });
  }
});

router.get("/api/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid choice id." });
  }

  try {
    const choices = await loadChoices();
    const choice = choices.find((c) => c.id === id);
    if (!choice) {
      return res.status(404).json({ success: false, error: "Choice not found." });
    }
    res.json({ success: true, data: choice });
  } catch (err) {
    console.error("GET /settings/menus/choices/api/:id error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to load menu choice." });
  }
});

// ======================================================
// API: Create choice (with optional options array)
// ======================================================
router.post("/api", async (req, res) => {
  const {
    name,
    description = null,
    options = [],
    category_id = null,
  } = req.body || {};
  if (!name || !name.trim()) {
    return res
      .status(400)
      .json({ success: false, error: "Choice name is required." });
  }

  const categoryId =
    category_id !== undefined && category_id !== null && category_id !== ""
      ? Number(category_id)
      : null;
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid category selection." });
  }

  const normalizedOptions = [];
  let choiceUnitId = null;
  for (const opt of Array.isArray(options) ? options : []) {
    if (!opt || !opt.name) continue;
    const unitId =
      opt.unit_id !== undefined && opt.unit_id !== null && opt.unit_id !== ""
        ? Number(opt.unit_id)
        : null;
    if (choiceUnitId == null && unitId != null && Number.isFinite(unitId)) {
      choiceUnitId = unitId;
    }
    const price =
      opt.price !== undefined && opt.price !== null && opt.price !== ""
        ? Number(opt.price)
        : null;
    const cost =
      opt.cost !== undefined && opt.cost !== null && opt.cost !== ""
        ? Number(opt.cost)
        : null;
    normalizedOptions.push({
      name: opt.name.trim(),
      price,
      cost,
      cogs_percent: computeCogsPercent(price, cost),
      unit_id: unitId != null && Number.isFinite(unitId) ? unitId : null,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (categoryId !== null) {
      const { rowCount } = await client.query(
        "SELECT 1 FROM menu_categories WHERE id = $1",
        [categoryId]
      );
      if (!rowCount) {
        throw new Error("Selected category does not exist.");
      }
    }

    if (choiceUnitId == null) {
      const {
        rows: [fallbackUnit],
      } = await client.query(
        "SELECT id FROM menu_units ORDER BY id ASC LIMIT 1"
      );
      if (!fallbackUnit) {
        throw new Error("No menu units are configured. Add units before creating choices.");
      }
      choiceUnitId = fallbackUnit.id;
    }

    const {
      rows: [choice],
    } = await client.query(
      `INSERT INTO menu_choices (name, description, unit_id, category_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, unit_id, category_id`,
      [name.trim(), description, choiceUnitId, categoryId]
    );

    const recordedOptions = [];
    const optionPayloads =
      normalizedOptions.length > 0
        ? normalizedOptions
        : [
            {
              name: name.trim(),
              price: null,
              cost: null,
              cogs_percent: 0,
              unit_id: choiceUnitId,
            },
          ];

    for (const opt of optionPayloads) {
      const unitIdForOption =
        opt.unit_id != null && Number.isFinite(opt.unit_id)
          ? opt.unit_id
          : choiceUnitId;
      const {
        rows: [row],
      } = await client.query(
        `INSERT INTO menu_options (choice_id, name, price, cost, unit_id, cogs_percent)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, price, cost, unit_id, cogs_percent`,
        [
          choice.id,
          opt.name,
          opt.price,
          opt.cost,
          unitIdForOption,
          computeCogsPercent(opt.price, opt.cost),
        ]
      );
      recordedOptions.push(row);
    }

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      data: { ...choice, options: recordedOptions },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /settings/menus/choices/api error:", err);
    const missingUnit = err.message && err.message.includes("No menu units");
    res.status(missingUnit ? 400 : 500).json({
      success: false,
      error: missingUnit ? err.message : "Failed to create menu choice.",
    });
  } finally {
    client.release();
  }
});

// ======================================================
// API: Update choice name/description
// ======================================================
router.patch("/api/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, description = null, category_id = null } = req.body || {};
  if (!Number.isInteger(id) || id <= 0 || !name || !name.trim()) {
    return res.status(400).json({ success: false, error: "Invalid input." });
  }

  const categoryId =
    category_id !== undefined && category_id !== null && category_id !== ""
      ? Number(category_id)
      : null;
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid category selection." });
  }

  try {
    if (categoryId !== null) {
      const { rowCount } = await pool.query(
        "SELECT 1 FROM menu_categories WHERE id = $1",
        [categoryId]
      );
      if (!rowCount) {
        return res
          .status(400)
          .json({ success: false, error: "Selected category not found." });
      }
    }

    const {
      rows,
    } = await pool.query(
      `UPDATE menu_choices
       SET name = $1,
           description = $2,
           category_id = $3
       WHERE id = $4
       RETURNING id, name, description, unit_id, category_id`,
      [name.trim(), description, categoryId, id]
    );
    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, error: "Choice not found." });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("PATCH /settings/menus/choices/api/:id error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update menu choice." });
  }
});

// ======================================================
// API: Delete choice
// ======================================================
router.delete("/api/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid choice id." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM menu_choice_links WHERE choice_id = $1", [
      id,
    ]);
    await client.query("DELETE FROM menu_options WHERE choice_id = $1", [id]);
    const { rowCount } = await client.query(
      "DELETE FROM menu_choices WHERE id = $1",
      [id]
    );
    await client.query("COMMIT");
    if (!rowCount) {
      return res
        .status(404)
        .json({ success: false, error: "Choice not found." });
    }
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /settings/menus/choices/api/:id error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete menu choice." });
  } finally {
    client.release();
  }
});

// ======================================================
// API: Create option for choice
// ======================================================
router.post("/api/:id/options", async (req, res) => {
  const choiceId = Number(req.params.id);
  const { name, price = null, cost = null, unit_id = null } = req.body || {};
  if (
    !Number.isInteger(choiceId) ||
    choiceId <= 0 ||
    !name ||
    !name.trim()
  ) {
    return res.status(400).json({ success: false, error: "Invalid input." });
  }

  try {
    const cogsPercent = computeCogsPercent(price, cost);
    const {
      rows,
    } = await pool.query(
      `INSERT INTO menu_options (choice_id, name, price, cost, unit_id, cogs_percent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, price, cost, unit_id, cogs_percent`,
      [
        choiceId,
        name.trim(),
        price != null ? Number(price) : null,
        cost != null ? Number(cost) : null,
        unit_id || null,
        cogsPercent,
      ]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("POST /settings/menus/choices/api/:id/options error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create option." });
  }
});

// ======================================================
// API: Update option
// ======================================================
router.patch("/api/:choiceId/options/:optionId", async (req, res) => {
  const choiceId = Number(req.params.choiceId);
  const optionId = Number(req.params.optionId);
  const { name, price = null, cost = null, unit_id = null } = req.body || {};
  if (
    !Number.isInteger(choiceId) ||
    !Number.isInteger(optionId) ||
    choiceId <= 0 ||
    optionId <= 0 ||
    !name ||
    !name.trim()
  ) {
    return res.status(400).json({ success: false, error: "Invalid input." });
  }
  const unitId =
    unit_id !== undefined && unit_id !== null && unit_id !== ""
      ? Number(unit_id)
      : null;

  try {
    const cogsPercent = computeCogsPercent(price, cost);
    const {
      rows,
    } = await pool.query(
      `UPDATE menu_options
         SET name = $1,
             price = $2,
             cost = $3,
             unit_id = $4,
             cogs_percent = $5
       WHERE id = $6 AND choice_id = $7
       RETURNING id, name, price, cost, unit_id, cogs_percent`,
      [
        name.trim(),
        price != null ? Number(price) : null,
        cost != null ? Number(cost) : null,
        unitId,
        cogsPercent,
        optionId,
        choiceId,
      ]
    );
    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, error: "Option not found." });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(
      "PATCH /settings/menus/choices/api/:choiceId/options/:optionId error:",
      err
    );
    res
      .status(500)
      .json({ success: false, error: "Failed to update option." });
  }
});

// ======================================================
// API: Delete option
// ======================================================
router.delete("/api/:choiceId/options/:optionId", async (req, res) => {
  const choiceId = Number(req.params.choiceId);
  const optionId = Number(req.params.optionId);
  if (
    !Number.isInteger(choiceId) ||
    !Number.isInteger(optionId) ||
    choiceId <= 0 ||
    optionId <= 0
  ) {
    return res.status(400).json({ success: false, error: "Invalid input." });
  }

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM menu_options WHERE id = $1 AND choice_id = $2",
      [optionId, choiceId]
    );
    if (!rowCount) {
      return res
        .status(404)
        .json({ success: false, error: "Option not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(
      "DELETE /settings/menus/choices/api/:choiceId/options/:optionId error:",
      err
    );
    res
      .status(500)
      .json({ success: false, error: "Failed to delete option." });
  }
});

module.exports = router;
