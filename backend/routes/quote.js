/* eslint-disable no-useless-escape */
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { renderNote } = require("../services/templateRenderer");

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------
async function ensureActiveProposal(client, functionId, contactId = null) {
  const proposalRes = await client.query(
    `SELECT id
       FROM proposals
      WHERE function_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [functionId]
  );
  if (proposalRes.rows.length) {
    return proposalRes.rows[0].id;
  }

  const {
    rows: [proposal],
  } = await client.query(
    `INSERT INTO proposals (function_id, contact_id, status, created_at)
     VALUES ($1, $2, 'draft', NOW())
     RETURNING id`,
    [functionId, contactId]
  );

  await client.query(
    `INSERT INTO proposal_totals (
        proposal_id,
        subtotal,
        gratuity_percent,
        gratuity_amount,
        discount_amount,
        deposit_amount,
        total_paid,
        remaining_due
     )
     VALUES ($1, 0, 0, 0, 0, 0, 0, 0)`,
    [proposal.id]
  );

  return proposal.id;
}

async function recalcTotals(client, proposalId) {
  const {
    rows: itemRows,
  } = await client.query(
    `SELECT unit_price, description
       FROM proposal_items
      WHERE proposal_id = $1`,
    [proposalId]
  );
  let subtotal = 0;
  let costTotal = 0;
  const costRegex = /\[cost:([0-9.\-]+)\]/i;
  itemRows.forEach((row) => {
    subtotal += Number(row.unit_price) || 0;
    const match = costRegex.exec(row.description || "");
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) costTotal += value;
    }
  });

  const {
    rows: [currentTotals],
  } = await client.query(
    `SELECT gratuity_percent,
            discount_amount,
            deposit_amount
       FROM proposal_totals
      WHERE proposal_id = $1
      LIMIT 1`,
    [proposalId]
  );
  const {
    rows: [paymentRow],
  } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
       FROM payments
      WHERE proposal_id = $1`,
    [proposalId]
  );

  const gratuityPercent = Number(currentTotals?.gratuity_percent) || 0;
  const discountAmount = Number(currentTotals?.discount_amount) || 0;
  const depositAmount = Number(currentTotals?.deposit_amount) || 0;
  const totalPaid = Number(paymentRow?.total_paid) || 0;
  const gratuityAmount = (subtotal * gratuityPercent) / 100;
  const finalTotal = subtotal + gratuityAmount - discountAmount;
  const remaining = finalTotal - depositAmount - totalPaid;

  await client.query(
    `UPDATE proposal_totals
        SET subtotal = $1,
            gratuity_amount = $2,
            total_paid = $3,
            remaining_due = $4
      WHERE proposal_id = $5`,
    [subtotal, gratuityAmount, totalPaid, remaining, proposalId]
  );

  await client.query(
    `UPDATE functions f
        SET totals_price = $1,
            totals_cost = $2
       FROM proposals p
      WHERE p.id = $3
        AND p.function_id = f.id_uuid`,
    [finalTotal, costTotal, proposalId]
  );
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function includeMetadata(description, token, value) {
  const cleaned = stripMetadata(description, token);
  return `${cleaned} [${token}:${value}]`.replace(/\s{2,}/g, " ").trim();
}

function stripMetadata(description, token) {
  const regex = new RegExp(`\\s*\\[${token}:[^\\]]+\\]`, "i");
  return description.replace(regex, "").replace(/\s{2,}/g, " ").trim();
}

function stripAllMetadata(description = "") {
  return description
    .replace(/\s*\[[^\]]+\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractMetadata(description = "") {
  const meta = {};
  const regex = /\[([a-z_]+):([^\]]+)\]/gi;
  let match;
  while ((match = regex.exec(description))) {
    meta[match[1].toLowerCase()] = match[2];
  }
  return meta;
}

function buildNoteContext(fn, contacts = [], rooms = []) {
  const safeFn = fn || {};
  const primaryContact = contacts.find((contact) => contact.is_primary) || contacts[0] || null;
  const activeRoom =
    rooms.find((room) => String(room.id) === String(safeFn?.room_id)) ||
    rooms.find((room) => room.id === safeFn?.room_id) ||
    null;
  const event = {
    name: safeFn?.event_name || "",
    event_name: safeFn?.event_name || "",
    date: safeFn?.event_date || "",
    attendees: safeFn?.attendees || 0,
    start_time: safeFn?.start_time || "",
    end_time: safeFn?.end_time || "",
    type: safeFn?.event_type || "",
    event_type: safeFn?.event_type || "",
    budget: safeFn?.budget || 0,
    room: activeRoom?.name || "",
    room_id: safeFn?.room_id || activeRoom?.id || "",
  };
  return {
    event,
    function: { ...safeFn },
    contact: primaryContact || {},
    contacts,
    room: activeRoom || {},
    rooms,
    totals: {
      price: safeFn?.totals_price || 0,
      cost: safeFn?.totals_cost || 0,
      budget: safeFn?.budget || 0,
      attendees: safeFn?.attendees || 0,
    },
  };
}

async function addMenuBundle(client, functionId, proposalId, menuId) {
  const {
    rows: [menu],
  } = await client.query(
    `SELECT m.id,
            m.name,
            m.price,
            m.description,
            m.category_id,
            c.name AS category_name,
            0::numeric AS base_cost
       FROM menus m
  LEFT JOIN menu_categories c ON c.id = m.category_id
      WHERE m.id = $1
      LIMIT 1`,
    [menuId]
  );

  if (!menu) {
    throw new Error("Menu not found");
  }

  const {
    rows: [fnRow],
  } = await client.query(
    `SELECT attendees
       FROM functions
      WHERE id_uuid = $1
      LIMIT 1`,
    [functionId]
  );
  const attendees = Number(fnRow?.attendees) || 0;

  const baseCost = Number(menu.base_cost || 0) || 0;
  let menuDescription = `Menu: ${menu.name}`;
  menuDescription = includeMetadata(menuDescription, "menu_id", menu.id);
  if (menu.category_name) {
    menuDescription = includeMetadata(menuDescription, "category", menu.category_name);
  }
  if (baseCost > 0) {
    menuDescription = includeMetadata(menuDescription, "cost", baseCost);
  }

  await client.query(
    `INSERT INTO proposal_items (proposal_id, description, unit_price)
     VALUES ($1, $2, $3)`,
    [proposalId, menuDescription, menu.price || 0]
  );

  const choices = await client.query(
    `
    SELECT c.id AS choice_id,
           c.name AS choice_name,
           o.id AS option_id,
           o.name AS option_name,
           o.price AS option_price,
           o.cost AS option_cost,
           u.name AS unit_name,
           u.type AS unit_type
      FROM public.menu_choice_links l
      JOIN public.menu_choices c ON c.id = l.choice_id
 LEFT JOIN LATERAL (
           SELECT o.*
             FROM public.menu_options o
            WHERE o.choice_id = c.id
            ORDER BY o.id ASC
            LIMIT 1
      ) o ON true
 LEFT JOIN public.menu_units u ON u.id = o.unit_id
     WHERE l.menu_id = $1
     ORDER BY c.name ASC`,
    [menuId]
  );

  for (const choice of choices.rows) {
    const basePrice = Number(choice.option_price) || 0;
    const baseCost = Number(choice.option_cost) || 0;
    const unitType = (choice.unit_type || "").toLowerCase();
    let qty = 1;
    if (
      unitType === "per_person" ||
      unitType === "per-person" ||
      unitType === "per person" ||
      (choice.unit_name || "").toLowerCase() === "pp"
    ) {
      qty = Math.max(attendees, 1);
    }
    const total = basePrice * qty;
    const totalCost = baseCost * qty;
    let description = `Choice: ${choice.choice_name}${
      choice.option_name ? ` (${choice.option_name})` : ""
    }`;
    if (qty > 1) description += ` x ${qty}`;
    if (choice.unit_name) description += ` ${choice.unit_name}`;
    description = includeMetadata(description, "base", basePrice);
    description = includeMetadata(description, "menu_id", menu.id);
    description = includeMetadata(description, "qty", qty);
    if (unitType) description = includeMetadata(description, "unit_type", unitType);
    if (choice.option_cost != null) {
      description = includeMetadata(description, "cost", totalCost);
    }

    await client.query(
      `INSERT INTO proposal_items (proposal_id, description, unit_price)
       VALUES ($1, $2, $3)`,
      [proposalId, description, total]
    );
  }

  const addons = await client.query(
    `
    SELECT a.name,
           a.price,
           a.optional_cost,
           a.enable_quantity,
           a.default_quantity,
           u.name  AS unit_name,
           u.type  AS unit_type
      FROM public.menu_addons a
 LEFT JOIN public.menu_units u ON u.id = a.unit_id
     WHERE a.menu_id = $1
     ORDER BY a.id ASC`,
    [menuId]
  );

  for (const addon of addons.rows) {
    const basePrice = Number(addon.price) || 0;
    const baseCost = Number(addon.optional_cost) || 0;
    const unitType = (addon.unit_type || "").toLowerCase();
    let qty = 1;
    if (
      unitType === "per_person" ||
      unitType === "per-person" ||
      unitType === "per person" ||
      (addon.unit_name || "").toLowerCase() === "pp"
    ) {
      qty = Math.max(attendees, 1);
    } else if (addon.enable_quantity) {
      const d = Number(addon.default_quantity);
      qty = Number.isFinite(d) && d > 0 ? d : 1;
    }
    const total = basePrice * qty;
    const totalCost = baseCost * qty;
    let description = `Add-on: ${addon.name}`;
    if (qty > 1) description += ` x ${qty}`;
    if (addon.unit_name) description += ` ${addon.unit_name}`;
    description = includeMetadata(description, "base", basePrice);
    description = includeMetadata(description, "menu_id", menu.id);
    description = includeMetadata(description, "qty", qty);
    if (unitType) description = includeMetadata(description, "unit_type", unitType);
    if (addon.optional_cost != null) {
      description = includeMetadata(description, "cost", totalCost);
    }

    await client.query(
      `INSERT INTO proposal_items (proposal_id, description, unit_price)
       VALUES ($1, $2, $3)`,
      [proposalId, description, total]
    );
  }
}

// ------------------------------------------------------
// GET Quote page
// ------------------------------------------------------
router.get("/:functionId/quote", async (req, res) => {
  const { functionId } = req.params;

  try {
    const { rows: fnRows } = await pool.query(
      `SELECT f.id_uuid,
              f.event_name,
              f.event_date,
              f.status,
              f.event_type,
              f.attendees,
              f.totals_price,
              f.totals_cost,
              f.budget,
              f.start_time,
              f.end_time,
              f.room_id,
              r.name AS room_name
         FROM functions f
    LEFT JOIN rooms r ON r.id = f.room_id
        WHERE f.id_uuid = $1
        LIMIT 1`,
      [functionId]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    const { rows: proposals } = await pool.query(
      `SELECT id, status, created_at, contact_id
         FROM proposals
        WHERE function_id = $1
        ORDER BY created_at DESC`,
      [functionId]
    );

    const activeProposal = proposals[0] || null;
    let proposalItems = [];
    let payments = [];
    let totals = null;

    if (activeProposal) {
      const [itemsRes, payRes, totalsRes] = await Promise.all([
        pool.query(
          `SELECT id, description, unit_price
             FROM proposal_items
            WHERE proposal_id = $1
            ORDER BY id ASC`,
          [activeProposal.id]
        ),
        pool.query(
          `SELECT id, amount, status, method, paid_on
             FROM payments
            WHERE proposal_id = $1
            ORDER BY paid_on ASC`,
          [activeProposal.id]
        ),
        pool.query(
          `SELECT subtotal,
                  gratuity_percent,
                  gratuity_amount,
                  discount_amount,
                  deposit_amount,
                  total_paid,
                  remaining_due
             FROM proposal_totals
            WHERE proposal_id = $1
            LIMIT 1`,
          [activeProposal.id]
        ),
      ]);
      proposalItems = itemsRes.rows;
      payments = payRes.rows;
      totals = totalsRes.rows[0] || null;
    }

    if (!totals) {
      totals = {
        subtotal: 0,
        gratuity_percent: 0,
        gratuity_amount: 0,
        discount_amount: 0,
        deposit_amount: 0,
        total_paid: 0,
        remaining_due: 0,
      };
    }

    const sessionSaved =
      (req.session.proposalBuilder && req.session.proposalBuilder[functionId]) ||
      { includeItemIds: [], includeContactIds: [], sections: [], terms: "", termIds: [] };

    const proposalBuilderSaved = {
      includeItemIds: Array.isArray(sessionSaved.includeItemIds)
        ? [...sessionSaved.includeItemIds]
        : [],
      includeContactIds: Array.isArray(sessionSaved.includeContactIds)
        ? [...sessionSaved.includeContactIds]
        : [],
      sections: Array.isArray(sessionSaved.sections)
        ? sessionSaved.sections.map((section) => ({
            content: section?.content || "",
          }))
        : [],
      terms: sessionSaved.terms || "",
      termIds: Array.isArray(sessionSaved.termIds)
        ? sessionSaved.termIds.map(String)
        : [],
    };

    const [
      contactsRes,
      roomsRes,
      eventTypesRes,
      categoriesRes,
      unitsRes,
      menusRes,
      templateRes,
      termsRes,
      functionNotesRes,
    ] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.email, c.phone, fc.is_primary
           FROM contacts c
           JOIN function_contacts fc ON fc.contact_id = c.id
          WHERE fc.function_id = $1
          ORDER BY fc.is_primary DESC, c.name ASC`,
        [functionId]
      ),
      pool.query("SELECT id, name, capacity FROM rooms ORDER BY name ASC"),
      pool.query("SELECT name FROM club_event_types ORDER BY name ASC"),
      pool.query("SELECT id, name FROM menu_categories ORDER BY name ASC"),
      pool.query("SELECT id, name, type FROM menu_units ORDER BY id ASC"),
      pool.query("SELECT id, category_id, name, description, price FROM menus ORDER BY name ASC"),
      pool.query("SELECT id, name, category FROM note_templates ORDER BY name ASC"),
      pool.query(
        `SELECT id,
                COALESCE(NULLIF(name, ''), NULLIF(notes_template, ''), CONCAT('Terms Block #', id)) AS name,
                NULLIF(category, '') AS category,
                COALESCE(content, terms_and_conditions, '') AS content,
                COALESCE(is_default, FALSE) AS is_default
           FROM proposal_settings
          ORDER BY COALESCE(is_default, FALSE) DESC, name ASC`
      ),
      pool.query(
        `SELECT id, note_type, content, rendered_html, created_at
           FROM function_notes
          WHERE function_id = $1
          ORDER BY created_at DESC`,
        [functionId]
      ),
    ]);

    if (!proposalBuilderSaved.termIds.length && termsRes.rows.length) {
      const defaultTerm = termsRes.rows.find((term) => term.is_default) || termsRes.rows[0];
      if (defaultTerm) {
        proposalBuilderSaved.termIds = [String(defaultTerm.id)];
        sessionSaved.termIds = proposalBuilderSaved.termIds;
        req.session.proposalBuilder = req.session.proposalBuilder || {};
        req.session.proposalBuilder[functionId] = sessionSaved;
      }
    }

    const noteContext = buildNoteContext(fn, contactsRes.rows, roomsRes.rows);
    const functionNotes = await Promise.all(
      functionNotesRes.rows.map(async (note) => {
        const rendered = await renderNote(
          { raw_html: note.content, rendered_html: note.rendered_html },
          noteContext
        );
        return { ...note, rendered_content: rendered };
      })
    );

    if (!proposalBuilderSaved.terms && termsRes.rows.length) {
      const defaultTerms =
        termsRes.rows.find((term) => term.is_default) || termsRes.rows[0];
      if (defaultTerms) {
        proposalBuilderSaved.terms = defaultTerms.content || "";
      }
    }

    res.locals.pageJs = [
      ...(res.locals.pageJs || []),
      "/js/settings/menuDrawer.js",
      "/js/functions/proposal-builder.js",
    ];

    res.render("pages/functions/quote", {
      layout: "layouts/main",
      title: `Quote - ${fn.event_name}`,
      pageType: "function-detail",
      activeTab: "quote",
      user: req.session.user || null,
      fn,
      proposals,
      proposalItems,
      payments,
      totals,
      linkedContacts: contactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      categories: categoriesRes.rows,
      units: unitsRes.rows,
      menus: menusRes.rows,
      templates: templateRes.rows,
      proposalBuilderSaved,
      termsLibrary: termsRes.rows,
      functionNotes,
    });
  } catch (err) {
    console.error("[Quote] Error loading quote page:", err);
    res.status(500).send("Error loading quote page");
  }
});

// ------------------------------------------------------
// Create new proposal for function
// ------------------------------------------------------
router.post("/:functionId/quote/new", async (req, res) => {
  const { functionId } = req.params;
  const { contact_id = null } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureActiveProposal(client, functionId, contact_id || null);
    await client.query("COMMIT");
    res.redirect(`/functions/${functionId}/quote`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating new quote:", err);
    res.status(500).send("Failed to create new quote");
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Add menu to proposal
// ------------------------------------------------------
router.post("/:functionId/quote/add-menu", async (req, res) => {
  const { functionId } = req.params;
  const { menu_id } = req.body || {};
  if (!menu_id) {
    return res.status(400).json({ success: false, error: "menu_id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const proposalId = await ensureActiveProposal(client, functionId);
    await addMenuBundle(client, functionId, proposalId, menu_id);

    await recalcTotals(client, proposalId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error adding menu to proposal:", err);
    res.status(500).json({ success: false, error: "Failed to add menu" });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Remove menu (base + related items)
// ------------------------------------------------------
router.post("/:functionId/quote/remove-menu", async (req, res) => {
  const { functionId } = req.params;
  const { menu_id } = req.body || {};
  if (!menu_id) return res.status(400).json({ success: false, error: "menu_id is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);

    const itemsRes = await client.query(
      `SELECT id, description
         FROM proposal_items
        WHERE proposal_id = $1
          AND description ILIKE $2`,
      [proposalId, `%[menu_id:${menu_id}]%`]
    );

    if (itemsRes.rows.length) {
      const ids = itemsRes.rows.map((r) => r.id);
      await client.query(`DELETE FROM proposal_items WHERE id = ANY($1::int[])`, [ids]);
    }

    await recalcTotals(client, proposalId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error removing menu:", err);
    res.status(500).json({ success: false, error: "Failed to remove menu" });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Reset quote (clear all proposal items & totals)
// ------------------------------------------------------
router.post("/:functionId/quote/reset", async (req, res) => {
  const { functionId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);

    await client.query(
      `DELETE FROM proposal_items
        WHERE proposal_id = $1`,
      [proposalId]
    );

    await client.query(
      `UPDATE proposal_totals
          SET subtotal = 0,
              gratuity_percent = 0,
              gratuity_amount = 0,
              discount_amount = 0,
              deposit_amount = 0,
              total_paid = 0,
              remaining_due = 0
        WHERE proposal_id = $1`,
      [proposalId]
    );

    await client.query(
      `UPDATE functions
          SET totals_price = 0,
              totals_cost = 0
        WHERE id_uuid = $1`,
      [functionId]
    );

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error resetting quote:", err);
    res.status(500).json({ success: false, error: "Failed to reset quote" });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Resync menus (single or all) with current definitions
// ------------------------------------------------------
async function rebuildMenu(client, proposalId, functionId, menuId) {
  const existing = await client.query(
    `SELECT id, description, unit_price
       FROM proposal_items
      WHERE proposal_id = $1
        AND description ILIKE $2
      ORDER BY id ASC`,
    [proposalId, `%[menu_id:${menuId}]%`]
  );

  const adjustments = new Map();
  for (const row of existing.rows) {
    const label = stripAllMetadata(row.description || "");
    if (!label) continue;
    adjustments.set(label, {
      unit_price: Number(row.unit_price) || 0,
      meta: extractMetadata(row.description || ""),
    });
  }

  await client.query(
    `DELETE FROM proposal_items
      WHERE proposal_id = $1
        AND description ILIKE $2`,
    [proposalId, `%[menu_id:${menuId}]%`]
  );
  await addMenuBundle(client, functionId, proposalId, menuId);

  if (!adjustments.size) return;

  const fresh = await client.query(
    `SELECT id, description
       FROM proposal_items
      WHERE proposal_id = $1
        AND description ILIKE $2
      ORDER BY id ASC`,
    [proposalId, `%[menu_id:${menuId}]%`]
  );

  for (const row of fresh.rows) {
    const label = stripAllMetadata(row.description || "");
    if (!label) continue;
    const saved = adjustments.get(label);
    if (!saved) continue;

    const baseMeta = extractMetadata(row.description || "");
    const mergedMeta = { ...baseMeta };

    if (saved.meta.qty !== undefined) mergedMeta.qty = saved.meta.qty;
    if (saved.meta.excluded !== undefined) mergedMeta.excluded = saved.meta.excluded;
    if (saved.meta.cost !== undefined) mergedMeta.cost = saved.meta.cost;

    const metaString = Object.entries(mergedMeta)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `[${key}:${value}]`)
      .join(" ");
    const updatedDescription = `${label}${metaString ? " " + metaString : ""}`.trim();

    await client.query(
      `UPDATE proposal_items
          SET unit_price = $1,
              description = $2
        WHERE id = $3`,
      [saved.unit_price, updatedDescription, row.id]
    );
  }
}

router.post("/:functionId/quote/resync-menu", async (req, res) => {
  const { functionId } = req.params;
  const { menu_id } = req.body || {};
  if (!menu_id) return res.status(400).json({ success: false, error: "menu_id is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);
    await rebuildMenu(client, proposalId, functionId, menu_id);
    await recalcTotals(client, proposalId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error resyncing menu:", err);
    res.status(500).json({ success: false, error: "Failed to resync menu" });
  } finally {
    client.release();
  }
});

router.post("/:functionId/quote/resync-all", async (req, res) => {
  const { functionId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);
    const menusRes = await client.query(
      `SELECT DISTINCT regexp_replace(description, '.*\\[menu_id:(\\d+)\\].*', '\\1')::int AS menu_id
         FROM proposal_items
        WHERE proposal_id = $1
          AND description ILIKE '%[menu_id:%'`,
      [proposalId]
    );

    for (const row of menusRes.rows) {
      await rebuildMenu(client, proposalId, functionId, row.menu_id);
    }

    await recalcTotals(client, proposalId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error resyncing menus:", err);
    res.status(500).json({ success: false, error: "Failed to resync menus" });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Update totals (gratuity/discount/deposit)
// ------------------------------------------------------
router.post("/:proposalId/totals/update", async (req, res) => {
  const { proposalId } = req.params;
  const {
    gratuity_percent = 0,
    discount_amount = 0,
    deposit_amount = 0,
    override_total = null,
  } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE proposal_totals
          SET gratuity_percent = $1,
              discount_amount = $2,
              deposit_amount = $3
        WHERE proposal_id = $4`,
      [
        Number(gratuity_percent) || 0,
        Number(discount_amount) || 0,
        Number(deposit_amount) || 0,
        proposalId,
      ]
    );

    let discountValue = Number(discount_amount) || 0;
    if (override_total !== null && override_total !== "") {
      const {
        rows: [{ subtotal }],
      } = await client.query(
        `SELECT COALESCE(SUM(unit_price), 0) AS subtotal
           FROM proposal_items
          WHERE proposal_id = $1`,
        [proposalId]
      );
      const gratuityAmount = (subtotal * (Number(gratuity_percent) || 0)) / 100;
      const desired = Number(override_total) || 0;
      const neededDiscount = subtotal + gratuityAmount - desired;
      discountValue = Math.max(0, neededDiscount);
      await client.query(
        `UPDATE proposal_totals
            SET discount_amount = $1
          WHERE proposal_id = $2`,
        [discountValue, proposalId]
      );
    }

    await recalcTotals(client, proposalId);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating proposal totals:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Update proposal item price + include toggle
// ------------------------------------------------------
router.post("/proposal-items/:id/price", async (req, res) => {
  const id = Number(req.params.id);
  const { unit_price, include = true, cost_total } = req.body || {};
  if (!Number.isInteger(id) || id <= 0 || unit_price === undefined) {
    return res.status(400).json({ success: false, error: "Invalid input" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      rows,
    } = await client.query(
      `SELECT proposal_id, description
         FROM proposal_items
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Item not found" });
    }

    const proposalId = rows[0].proposal_id;
    let description = rows[0].description || "";

    // Toggle excluded flag in description metadata
    description = stripMetadata(description, "excluded");
    if (!parseBoolean(include)) {
      description = includeMetadata(description, "excluded", "true");
    }

    if (cost_total !== undefined) {
      description = stripMetadata(description, "cost");
      const numericCost =
        cost_total === null || cost_total === ""
          ? null
          : Number(cost_total);
      if (Number.isFinite(numericCost)) {
        description = includeMetadata(description, "cost", numericCost);
      }
    }

    await client.query(
      `UPDATE proposal_items
          SET unit_price = $1,
              description = $2
        WHERE id = $3`,
      [Number(unit_price) || 0, description, id]
    );

    await recalcTotals(client, proposalId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating line price:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Update proposal item quantity (embedded in description)
// ------------------------------------------------------
router.post("/proposal-items/:id/qty", async (req, res) => {
  const id = Number(req.params.id);
  const qty = Number(req.body?.qty);
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ success: false, error: "Invalid input" });
  }

  try {
    const {
      rows,
    } = await pool.query(
      `SELECT description
         FROM proposal_items
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Item not found" });
    }
    let description = rows[0].description || "";
    description = stripMetadata(description, "qty");
    description = includeMetadata(description, "qty", qty);
    description = description.replace(/ x \d+/, "").trim();
    const metaIdx = description.indexOf(" [");
    let head = metaIdx >= 0 ? description.slice(0, metaIdx) : description;
    const meta = metaIdx >= 0 ? description.slice(metaIdx) : "";
    head = head.replace(/ x \d+$/i, "").trim();
    head = `${head} x ${qty}`.trim();
    await pool.query(
      `UPDATE proposal_items
          SET description = $1
        WHERE id = $2`,
      [`${head}${meta}`.trim(), id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating qty:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------
// Proposal builder page
// ------------------------------------------------------
router.get("/:functionId/proposal", async (req, res) => {
  const { functionId } = req.params;
  try {
    const { rows: fnRows } = await pool.query(
      `SELECT f.id_uuid,
              f.event_name,
              f.event_date,
              f.status,
              f.event_type,
              f.attendees,
              f.totals_price,
              f.totals_cost,
              f.budget,
              f.start_time,
              f.end_time,
              f.room_id,
              r.name AS room_name
         FROM functions f
    LEFT JOIN rooms r ON r.id = f.room_id
        WHERE f.id_uuid = $1
        LIMIT 1`,
      [functionId]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    const [proposalRes, templatesRes, termsRes, functionNotesRes, contactsRes, roomsRes] = await Promise.all([
      pool.query(
        `SELECT id
           FROM proposals
          WHERE function_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [functionId]
      ),
      pool.query(
        `SELECT id, name, category
           FROM note_templates
          ORDER BY name ASC`
      ),
      pool.query(
        `SELECT id,
                COALESCE(NULLIF(name, ''), NULLIF(notes_template, ''), CONCAT('Terms Block #', id)) AS name,
                NULLIF(category, '') AS category,
                COALESCE(content, terms_and_conditions, '') AS content,
                COALESCE(is_default, FALSE) AS is_default
           FROM proposal_settings
          ORDER BY COALESCE(is_default, FALSE) DESC, name ASC`
      ),
      pool.query(
        `SELECT id, note_type, content, rendered_html, created_at
           FROM function_notes
          WHERE function_id = $1
          ORDER BY created_at DESC`,
        [functionId]
      ),
      pool.query(
        `SELECT c.id, c.name, c.email, c.phone, fc.is_primary
           FROM contacts c
           JOIN function_contacts fc ON fc.contact_id = c.id
          WHERE fc.function_id = $1
          ORDER BY fc.is_primary DESC, c.name ASC`,
        [functionId]
      ),
      pool.query("SELECT id, name, capacity FROM rooms ORDER BY name ASC"),
    ]);

    const proposalId = proposalRes.rows[0]?.id || null;
    const sessionSaved =
      (req.session.proposalBuilder && req.session.proposalBuilder[functionId]) ||
      { includeItemIds: [], includeContactIds: [], sections: [], terms: "", termIds: [] };
    const saved = {
      includeItemIds: Array.isArray(sessionSaved.includeItemIds)
        ? [...sessionSaved.includeItemIds]
        : [],
      includeContactIds: Array.isArray(sessionSaved.includeContactIds)
        ? [...sessionSaved.includeContactIds]
        : [],
      sections: Array.isArray(sessionSaved.sections)
        ? sessionSaved.sections.map((section) => ({
            content: section?.content || "",
          }))
        : [],
      terms: sessionSaved.terms || "",
      termIds: Array.isArray(sessionSaved.termIds)
        ? sessionSaved.termIds.map(String)
        : [],
    };
    if (!saved.termIds.length && termsRes.rows.length) {
      const defaultTerms =
        termsRes.rows.find((term) => term.is_default) || termsRes.rows[0];
      if (defaultTerms) {
        saved.termIds = [String(defaultTerms.id)];
        sessionSaved.termIds = saved.termIds;
        req.session.proposalBuilder = req.session.proposalBuilder || {};
        req.session.proposalBuilder[functionId] = sessionSaved;
      }
    }
    const noteContext = buildNoteContext(fn, contactsRes.rows, roomsRes.rows);
    const functionNotes = await Promise.all(
      functionNotesRes.rows.map(async (note) => {
        const rendered = await renderNote(
          { raw_html: note.content, rendered_html: note.rendered_html },
          noteContext
        );
        return { ...note, rendered_content: rendered };
      })
    );

    let proposalItems = [];
    if (proposalId) {
      const includeIds = saved.includeItemIds.map(Number).filter(Number.isFinite);
      if (includeIds.length) {
        const { rows } = await pool.query(
          `SELECT id, description, unit_price
             FROM proposal_items
            WHERE proposal_id = $1
              AND id = ANY($2::int[])
            ORDER BY id ASC`,
          [proposalId, includeIds]
        );
        proposalItems = rows;
      } else {
        const { rows } = await pool.query(
          `SELECT id, description, unit_price
             FROM proposal_items
            WHERE proposal_id = $1
              AND COALESCE(unit_price, 0) > 0
              AND description NOT ILIKE '%[excluded:true]%'
            ORDER BY id ASC`,
          [proposalId]
        );
        proposalItems = rows;
      }
    }

    let totals = null;
    if (proposalId) {
      const { rows: totalRows } = await pool.query(
        `SELECT subtotal,
                gratuity_percent,
                gratuity_amount,
                discount_amount,
                deposit_amount,
                total_paid,
                remaining_due
           FROM proposal_totals
          WHERE proposal_id = $1
          LIMIT 1`,
        [proposalId]
      );
      totals = totalRows[0] || null;
    }
    if (!totals) {
      totals = {
        subtotal: 0,
        gratuity_percent: 0,
        gratuity_amount: 0,
        discount_amount: 0,
        deposit_amount: 0,
        total_paid: 0,
        remaining_due: 0,
      };
    }

    res.locals.pageJs = [
      ...(res.locals.pageJs || []),
      "/js/functions/proposal-builder.js",
    ];

    res.render("pages/functions/proposal", {
      layout: "layouts/main",
      title: `Proposal Builder - ${fn.event_name}`,
      pageType: "function-detail",
      activeTab: "proposal",
      user: req.session.user || null,
      fn,
      proposalId,
      proposalItems,
      templates: templatesRes.rows,
      contacts: contactsRes.rows,
      rooms: roomsRes.rows,
      saved,
      termsLibrary: termsRes.rows,
      functionNotes,
      totals,
    });
  } catch (err) {
    console.error("Error loading proposal builder:", err);
    res.status(500).send("Error loading proposal builder");
  }
});

router.post("/:functionId/proposal/save", async (req, res) => {
  const { functionId } = req.params;
  const {
    includeItemIds = [],
    includeContactIds = [],
    sections = [],
    terms = "",
    termIds = [],
  } = req.body || {};

  const cleanItems = Array.isArray(includeItemIds)
    ? includeItemIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];

  const cleanContacts = Array.isArray(includeContactIds)
    ? Array.from(
        new Set(
          includeContactIds
            .map((v) => String(v || "").trim())
            .filter((v) => v.length)
        )
      )
    : [];

  const normalizedSections = Array.isArray(sections)
    ? sections
        .map((s) => ({
          content: (s && s.content ? String(s.content) : "").trim(),
        }))
        .filter((s) => s.content.length)
    : [];

  const cleanTermIds = Array.isArray(termIds)
    ? Array.from(
        new Set(
          termIds
            .map((v) => String(v || "").trim())
            .filter((v) => v.length)
        )
      )
    : [];

  req.session.proposalBuilder = req.session.proposalBuilder || {};
  req.session.proposalBuilder[functionId] = {
    includeItemIds: cleanItems,
    includeContactIds: cleanContacts,
    sections: normalizedSections,
    terms: String(terms || ""),
    termIds: cleanTermIds,
  };

  res.json({ success: true });
});

router.get("/:functionId/proposal/preview", async (req, res) => {
  const { functionId } = req.params;
  try {
    const { rows: fnRows } = await pool.query(
      `SELECT f.id_uuid,
              f.event_name,
              f.event_date,
              f.status,
              f.event_type,
              f.attendees,
              f.totals_price,
              f.totals_cost,
              f.budget,
              f.start_time,
              f.end_time,
              f.room_id,
              r.name AS room_name
         FROM functions f
    LEFT JOIN rooms r ON r.id = f.room_id
        WHERE f.id_uuid = $1
        LIMIT 1`,
      [functionId]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    const saved =
      (req.session.proposalBuilder && req.session.proposalBuilder[functionId]) ||
      { includeItemIds: [], includeContactIds: [], sections: [], terms: "", termIds: [] };

    res.locals.pageJs = [
      ...(res.locals.pageJs || []),
      "/js/settings/menuDrawer.js",
    ];

    const { rows: proposalRows } = await pool.query(
      `SELECT id
         FROM proposals
        WHERE function_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [functionId]
    );
    const proposalId = proposalRows[0]?.id || null;

    let items = [];
    if (proposalId) {
      const includeIds = saved.includeItemIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (includeIds.length) {
        const { rows } = await pool.query(
          `SELECT id, description, unit_price
             FROM proposal_items
            WHERE proposal_id = $1
              AND id = ANY($2::int[])
            ORDER BY id ASC`,
          [proposalId, includeIds]
        );
        items = rows;
      } else {
        const { rows } = await pool.query(
          `SELECT id, description, unit_price
             FROM proposal_items
            WHERE proposal_id = $1
              AND COALESCE(unit_price, 0) > 0
              AND description NOT ILIKE '%[excluded:true]%'
            ORDER BY id ASC`,
          [proposalId]
        );
        items = rows;
      }
    }

    const contactIds = saved.includeContactIds
      .map((v) => String(v || "").trim())
      .filter((v) => v.length);
    let contacts = [];
    if (contactIds.length) {
      const {
        rows,
      } = await pool.query(
        `SELECT id, name, email, phone
           FROM contacts
          WHERE id::text = ANY($1::text[])
          ORDER BY name ASC`,
        [contactIds]
      );
      contacts = rows;
    }

    const { rows: termsLibraryRows } = await pool.query(
      `SELECT id,
              COALESCE(NULLIF(name, ''), NULLIF(notes_template, ''), CONCAT('Terms Block #', id)) AS name,
              COALESCE(content, terms_and_conditions, '') AS content,
              COALESCE(is_default, FALSE) AS is_default
         FROM proposal_settings
        ORDER BY COALESCE(is_default, FALSE) DESC, name ASC`
    );
    const savedTermIds = Array.isArray(saved.termIds)
      ? saved.termIds.map((id) => String(id || "").trim()).filter((id) => id.length)
      : [];
    let selectedTermIds = savedTermIds;
    if (!selectedTermIds.length && termsLibraryRows.length) {
      const defaultTerm = termsLibraryRows.find((term) => term.is_default) || termsLibraryRows[0];
      if (defaultTerm) selectedTermIds = [String(defaultTerm.id)];
    }
    const combinedTerms = [
      ...termsLibraryRows
        .filter((term) => selectedTermIds.includes(String(term.id)))
        .map((term) => term.content || ""),
      saved.terms || "",
    ]
      .filter((chunk) => chunk && chunk.trim().length)
      .join("\n\n");

    let totalsData = null;
    if (proposalId) {
      const { rows } = await pool.query(
        `SELECT subtotal,
                gratuity_percent,
                gratuity_amount,
                discount_amount,
                deposit_amount,
                total_paid,
                remaining_due
           FROM proposal_totals
          WHERE proposal_id = $1
          LIMIT 1`,
        [proposalId]
      );
      totalsData = rows[0] || null;
    }
    if (!totalsData) {
      totalsData = {
        subtotal: 0,
        gratuity_percent: 0,
        gratuity_amount: 0,
        discount_amount: 0,
        deposit_amount: 0,
        total_paid: 0,
        remaining_due: 0,
      };
    }

    res.render("pages/functions/proposal-preview", {
      layout: "layouts/main",
      title: `Proposal Preview - ${fn.event_name}`,
      pageType: "",
      fn,
      proposalId,
      items,
      contacts,
      sections: saved.sections || [],
      terms: combinedTerms,
      totals: totalsData,
    });
  } catch (err) {
    console.error("preview error:", err);
    res.status(500).send("Error rendering preview");
  }
});

router.get("/:proposalId/totals", async (req, res) => {
  const { proposalId } = req.params;
  try {
    const {
      rows,
    } = await pool.query(
      `SELECT pt.subtotal,
              pt.gratuity_percent,
              pt.gratuity_amount,
              pt.discount_amount,
              pt.deposit_amount,
              pt.total_paid,
              pt.remaining_due,
              f.totals_price AS function_total,
              f.totals_cost AS function_cost
         FROM proposal_totals pt
    LEFT JOIN proposals p ON p.id = pt.proposal_id
    LEFT JOIN functions f ON f.id_uuid = p.function_id
        WHERE pt.proposal_id = $1
        LIMIT 1`,
      [proposalId]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error("Error fetching proposal totals:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
