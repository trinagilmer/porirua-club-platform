const express = require("express");
const router = express.Router();
const { pool } = require("../../db");

let schemaReady = false;
const baseSelect = `
  SELECT id,
         COALESCE(NULLIF(name, ''), NULLIF(notes_template, ''), CONCAT('Terms Block #', id)) AS name,
         NULLIF(category, '') AS category,
         COALESCE(content, terms_and_conditions, '') AS content,
         COALESCE(is_default, FALSE) AS is_default,
         updated_at
    FROM proposal_settings
   ORDER BY COALESCE(is_default, FALSE) DESC, name ASC
`;

async function ensureProposalSettingsReady() {
  if (schemaReady) return;
  await pool.query(`
    ALTER TABLE proposal_settings
      ADD COLUMN IF NOT EXISTS name TEXT,
      ADD COLUMN IF NOT EXISTS category TEXT,
      ADD COLUMN IF NOT EXISTS content TEXT,
      ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS created_by UUID,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
  await pool.query(`
    UPDATE proposal_settings
       SET name = COALESCE(NULLIF(name, ''), NULLIF(notes_template, ''), CONCAT('Terms Block #', id)),
           content = COALESCE(content, terms_and_conditions, ''),
           updated_at = NOW(),
           is_default = COALESCE(is_default, FALSE)
     WHERE (name IS NULL OR name = '')
        OR content IS NULL
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS proposal_settings_default_idx
      ON proposal_settings (is_default)
      WHERE is_default IS TRUE
  `);
  schemaReady = true;
}

router.use(express.json({ limit: "1mb" }));

router.get("/", async (req, res) => {
  try {
    await ensureProposalSettingsReady();
    const { rows } = await pool.query(baseSelect);
    res.locals.pageJs = [
      ...(res.locals.pageJs || []),
      "/js/settings/proposal-terms.js",
    ];
    res.render("settings/proposal-terms", {
      title: "Settings - Proposal Terms",
      pageType: "settings",
      activeTab: "proposal-terms",
      terms: rows,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("Error loading proposal terms:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load proposal terms.",
      error: err.message,
      stack: err.stack,
    });
  }
});

router.get("/api", async (_req, res) => {
  try {
    await ensureProposalSettingsReady();
    const { rows } = await pool.query(baseSelect);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching proposal terms:", err);
    res.status(500).json({ success: false, error: "Failed to load terms" });
  }
});

function resolveUserUuid(req) {
  const rawId = req.session.user?.id_uuid || req.session.user?.id || null;
  if (typeof rawId === "string" && /^[0-9a-f-]{36}$/i.test(rawId)) {
    return rawId;
  }
  return null;
}

router.post("/api", async (req, res) => {
  const { name, category = null, content = "", is_default = false } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: "Name is required." });
  }
  const createdBy = resolveUserUuid(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureProposalSettingsReady();
    if (is_default) {
      await client.query(`UPDATE proposal_settings SET is_default = FALSE WHERE is_default = TRUE`);
    }
    const {
      rows,
    } = await client.query(
      `INSERT INTO proposal_settings (name, category, content, is_default, created_by, notes_template, terms_and_conditions)
       VALUES ($1, NULLIF($2,''), $3, $4, $5, NULLIF($1,''), $3)
       RETURNING id, name, category, content, is_default, updated_at`,
      [name.trim(), category || null, content || "", Boolean(is_default), createdBy]
    );
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating proposal terms:", err);
    res.status(500).json({ success: false, error: "Failed to create terms" });
  } finally {
    client.release();
  }
});

router.patch("/api/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid term id." });
  }
  const { name, category = null, content = "", is_default = false } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: "Name is required." });
  }
  const updatedBy = resolveUserUuid(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureProposalSettingsReady();
    if (is_default) {
      await client.query(`UPDATE proposal_settings SET is_default = FALSE WHERE is_default = TRUE`);
    }
    const {
      rows,
    } = await client.query(
      `UPDATE proposal_settings
          SET name = $1,
              category = NULLIF($2,''),
              content = $3,
              is_default = $4,
              created_by = COALESCE($6, created_by),
              notes_template = NULLIF($1,''),
              terms_and_conditions = $3,
              updated_at = NOW()
        WHERE id = $5
        RETURNING id, name, category, content, is_default, updated_at`,
      [name.trim(), category || null, content || "", Boolean(is_default), id, updatedBy]
    );
    await client.query("COMMIT");
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Term not found." });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating proposal terms:", err);
    res.status(500).json({ success: false, error: "Failed to update terms" });
  } finally {
    client.release();
  }
});

router.delete("/api/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid term id." });
  }
  try {
    await ensureProposalSettingsReady();
    const { rowCount } = await pool.query(`DELETE FROM proposal_settings WHERE id = $1`, [id]);
    if (!rowCount) {
      return res.status(404).json({ success: false, error: "Term not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting proposal terms:", err);
    res.status(500).json({ success: false, error: "Failed to delete terms" });
  }
});

module.exports = router;
