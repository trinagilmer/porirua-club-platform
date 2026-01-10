/* eslint-disable no-useless-escape */
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { renderNote } = require("../services/templateRenderer");
const { sendMail: graphSendMail } = require("../services/graphService");
const { getAppToken } = require("../utils/graphAuth");

const PROPOSAL_STATUSES = [
  "draft",
  "sent",
  "approved",
  "declined",
  "accepted-pending-menu",
  "accepted-final",
];

function getAppUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

async function getGraphAccessTokenFromSession() {
  return await getAppToken();
}

// ------------------------------------------------------
// Client-facing proposal (tokenized)
// ------------------------------------------------------
router.get("/proposal/client/:token", async (req, res) => {
  try {
    const token = req.params.token;
    const proposal = await findProposalByToken(token);
    if (!proposal) return res.status(404).send("Link not found or expired.");

    // Load function data, contacts, notes, terms, items, totals similar to admin preview
    const {
      rows: fnRows,
    } = await pool.query(
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
      [proposal.function_id]
    );
    const fn = fnRows[0] || null;

    const [templatesRes, termsRes, functionNotesRes, contactsRes, roomsRes] = await Promise.all([
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
        [proposal.function_id]
      ),
      pool.query(
        `SELECT c.id, c.name, c.email, c.phone, fc.is_primary
           FROM contacts c
           JOIN function_contacts fc ON fc.contact_id = c.id
          WHERE fc.function_id = $1
          ORDER BY fc.is_primary DESC, c.name ASC`,
        [proposal.function_id]
      ),
      pool.query("SELECT id, name, capacity FROM rooms ORDER BY name ASC"),
    ]);

    const saved = { includeItemIds: [], includeContactIds: [], sections: [], terms: "", termIds: [], termIdsExplicit: false };
    // default terms fallback
    if (!saved.termIds.length && termsRes.rows.length) {
      const defaultTerms = termsRes.rows.find((term) => term.is_default) || termsRes.rows[0];
      if (defaultTerms) {
        saved.termIds = [String(defaultTerms.id)];
        saved.termIdsExplicit = false;
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

    const { rows: rawItems } = await pool.query(
      `
      SELECT id, description, unit_price, client_selectable
        FROM proposal_items
       WHERE proposal_id = $1
       ORDER BY id ASC;
      `,
      [proposal.id]
    );

    // Fallback: if this proposal has no items (e.g., older token), try the latest proposal for the same function
    let items = rawItems;
    let itemsFallbackNote = null;
    if (!items.length) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const rebuilt = await rebuildMenusForFunction(client, proposal.id, proposal.function_id, null);
        await client.query("COMMIT");
        if (rebuilt) {
          const { rows: refreshed } = await pool.query(
            `SELECT id, description, unit_price, client_selectable FROM proposal_items WHERE proposal_id = $1 ORDER BY id ASC`,
            [proposal.id]
          );
          items = refreshed;
          itemsFallbackNote = "Menus were rebuilt automatically for this link.";
        }
      } catch (e) {
        await pool.query("ROLLBACK");
        console.error("[Client Proposal] Rebuild failed:", e);
      } finally {
        client.release();
      }
    }

    const { rows: totalsRes } = await pool.query(
      `
      SELECT subtotal,
             gratuity_percent,
             gratuity_amount,
             discount_amount,
             deposit_amount,
             total_paid,
             remaining_due
        FROM proposal_totals
       WHERE proposal_id = $1
       LIMIT 1;
      `,
      [proposal.id]
    );
    const { rows: payments } = await pool.query(
      `SELECT id, payment_type, amount, method, paid_on
         FROM payments
        WHERE proposal_id = $1
        ORDER BY paid_on ASC`,
      [proposal.id]
    );
    const totals = totalsRes[0] || {
      subtotal: 0,
      gratuity_percent: 0,
      gratuity_amount: 0,
      discount_amount: 0,
      deposit_amount: 0,
      total_paid: 0,
      remaining_due: 0,
    };

    // Apply saved selections (if any) to items for rendering
    if (proposal.client_selection) {
      let savedSel = proposal.client_selection;
      if (typeof savedSel === "string") {
        try {
          savedSel = JSON.parse(savedSel);
        } catch (e) {
          savedSel = null;
        }
      }
      if (savedSel?.selections) {
        items = applySelectionsToItems(rawItems, savedSel.selections);
      }
    }

    const menuMetaLookup = await fetchMenuMetaLookup(items);

    res.render("pages/functions/proposal-preview", {
      layout: "layouts/main",
      title: "Confirm Proposal",
      fn,
      proposalId: proposal.id,
      proposal,
      items,
      totals,
      menuMetaLookup,
      payments,
      contacts: contactsRes.rows,
      sections: saved.sections.length ? saved.sections : functionNotes.map((n) => ({ content: n.rendered_content })),
      terms:
        (saved.termIds.length
          ? termsRes.rows.filter((t) => saved.termIds.includes(String(t.id))).map((t) => t.content).join("<hr/>")
          : (termsRes.rows.find((t) => t.is_default) || termsRes.rows[0] || {}).content) || "",
      saved,
      itemsFallbackNote,
      clientMode: true,
      acceptedDisplayDate: proposal.client_accepted_at || null,
      hideChrome: true,
    });
  } catch (err) {
    console.error("[Client Proposal] Failed to load:", err);
    res.status(500).send("Unable to load proposal.");
  }
});

router.post("/proposal/client/:token/accept", async (req, res) => {
  const token = req.params.token;
  const action = req.body.action === "final" ? "accepted-final" : "accepted-pending-menu";
  const clientName = req.body.client_name || "";
  const clientEmail = (req.body.client_email || "").trim();
  try {
    const proposal = await findProposalByToken(token);
    if (!proposal) return res.status(404).send("Link not found or expired.");
    if (!req.body.accept_terms) {
      return res.status(400).render("pages/functions/proposal-preview", {
        layout: "layouts/main",
        title: "Confirm Proposal",
        fn: {
          id_uuid: proposal.function_id,
          event_name: proposal.event_name,
          event_date: proposal.event_date,
          start_time: proposal.start_time,
          end_time: proposal.end_time,
          attendees: proposal.attendees,
          room_id: proposal.room_id,
        },
        proposalId: proposal.id,
        proposal,
        items: [],
        totals: null,
        menuMetaLookup: {},
        payments: [],
        contacts: [],
        sections: [],
        terms: null,
        saved: { includeItemIds: [], includeContactIds: [], sections: [], terms: "" },
        clientMode: true,
        successMessage: null,
        errorMessage: "You must agree to the Terms & Conditions to confirm.",
        acceptedDisplayDate: proposal.client_accepted_at || null,
        hideChrome: true,
      });
    }

    const { rows: rawItems } = await pool.query(
      `SELECT id, description, unit_price, client_selectable FROM proposal_items WHERE proposal_id = $1 ORDER BY id ASC`,
      [proposal.id]
    );

    let items = rawItems;

    const selections = items
      .filter((item) => {
        const meta = extractMetadata(item.description || "");
        const allowQty = parseBoolean(meta.client_allow_qty);
        return item.client_selectable || allowQty;
      })
      .map((item) => {
        const meta = extractMetadata(item.description || "");
        const allowQty = parseBoolean(meta.client_allow_qty);
        const include = item.client_selectable
          ? Boolean(req.body[`item_${item.id}_include`])
          : true;
        const rawQty = req.body[`item_${item.id}_qty`];
        const qty =
          rawQty !== undefined && rawQty !== null
            ? parseInt(rawQty, 10) || 1
            : parseInt(meta.qty, 10) || 1;
        return {
          id: item.id,
          include,
          qty,
          description: item.description,
          unit_price: item.unit_price,
          client_allow_qty: allowQty,
        };
      });

    const itemsWithSelection = applySelectionsToItems(rawItems, selections);
    const menuMetaLookup = await fetchMenuMetaLookup(itemsWithSelection);

    const payload = {
      action,
      selections,
      client_name: clientName,
      submitted_at: new Date().toISOString(),
    };

    const acceptedAt = new Date();
    await pool.query(
      `UPDATE proposals
          SET client_status = $1,
              client_accepted_at = $2,
              client_accepted_by = $3,
              client_ip = $4,
              client_selection = $5
        WHERE id = $6;`,
      [action, acceptedAt, clientName || proposal.client_accepted_by || null, req.ip, JSON.stringify(payload), proposal.id]
    );

    await pool.query(
      `
      INSERT INTO proposal_acceptance_events
        (proposal_id, client_status, submitted_by, submitted_ip, payload, snapshot)
      VALUES
        ($1, $2, $3, $4, $5, $6);
      `,
      [
        proposal.id,
        action,
        clientName || null,
        req.ip,
        JSON.stringify(payload),
        JSON.stringify({ items: itemsWithSelection, selections: payload, totals: req.body }),
      ]
    );

    // Notify via email + communications log if possible
    try {
      const accessToken = await getGraphAccessTokenFromSession();
      if (accessToken) {
        const link = `${getAppUrl(req)}/functions/proposal/client/${proposal.client_token}`;
        const summaryLines = selections
          .filter((s) => s.include)
          .map((s) => `<li>${s.description} x${s.qty}</li>`)
          .join("");
        const body = `
          <p>${clientName || "Client"} submitted selections for <strong>${proposal.event_name || "Function"}</strong>.</p>
          <p><strong>Name:</strong> ${clientName || "n/a"}<br>
             <strong>IP:</strong> ${req.ip || "n/a"}</p>
          <p><strong>Selections:</strong></p>
          ${summaryLines ? `<ul>${summaryLines}</ul>` : "<p>No selections provided</p>"}
          <p><a href="${link}">View proposal</a></p>
        `;
        await graphSendMail(accessToken, {
          to: process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz",
          subject: `${clientName || "Client"} - Porirua Club Events | Proposal submission`,
          body,
        });
        // Optional: log to communications if table exists
        try {
          await pool.query(
            `INSERT INTO communications (function_id, subject, body, direction, created_at)
               VALUES ($1, $2, $3, 'outbound', NOW())`,
            [proposal.function_id, `${clientName || "Client"} - Porirua Club Events | Proposal submission`, body]
          );
        } catch (e) {
          console.warn("Communications log skipped:", e.message);
        }
      }
    } catch (mailErr) {
      console.warn("Client submission email skipped:", mailErr.message);
    }

    // Load supporting data for the preview render
    const { rows: totalsRows } = await pool.query(
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
      [proposal.id]
    );
    const totals =
      totalsRows[0] || {
        subtotal: 0,
        gratuity_percent: 0,
        gratuity_amount: 0,
        discount_amount: 0,
        deposit_amount: 0,
        total_paid: 0,
        remaining_due: 0,
      };
    const { rows: payments } = await pool.query(
      `SELECT id, payment_type, amount, method, paid_on
         FROM payments
        WHERE proposal_id = $1
        ORDER BY paid_on ASC`,
      [proposal.id]
    );
    const {
      rows: contactsRows,
    } = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, fc.is_primary
         FROM contacts c
         JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC`,
      [proposal.function_id]
    );
    const { rows: termsRows } = await pool.query(
      `SELECT id,
              COALESCE(content, terms_and_conditions, '') AS content,
              COALESCE(is_default, FALSE) AS is_default
         FROM proposal_settings
        ORDER BY COALESCE(is_default, FALSE) DESC, id ASC`
    );
    const termsContent =
      (termsRows.find((t) => t.is_default) || termsRows[0] || {}).content || "";

    res.render("pages/functions/proposal-preview", {
      layout: "layouts/main",
      title: "Confirm Proposal",
      fn: {
        id_uuid: proposal.function_id,
        event_name: proposal.event_name,
        event_date: proposal.event_date,
        start_time: proposal.start_time,
        end_time: proposal.end_time,
        attendees: proposal.attendees,
        room_id: proposal.room_id,
      },
      proposalId: proposal.id,
      proposal: {
        ...proposal,
        client_status: action,
        client_accepted_by: clientName || proposal.client_accepted_by || null,
        client_accepted_at: acceptedAt,
      },
      items: itemsWithSelection,
      totals: totals || null,
      menuMetaLookup,
      payments,
      contacts: contactsRows,
      sections: [],
      terms: termsContent,
      saved: { includeItemIds: [], includeContactIds: [], sections: [], terms: "" },
      clientMode: true,
      acceptedDisplayDate: acceptedAt,
      successMessage:
        action === "accepted-final"
          ? "Thanks! Your selections have been submitted."
          : "Thanks! Your booking is confirmed. You can update menu selections later using this link.",
      errorMessage: null,
      hideChrome: true,
    });
  } catch (err) {
    console.error("[Client Proposal] Failed to accept:", err);
    res.status(500).render("pages/functions/proposal-client", {
      layout: "layouts/main",
      title: "Confirm Proposal",
      pageType: "proposal-client",
      proposal: null,
      items: [],
      totals: null,
      successMessage: null,
      errorMessage: "We could not save your confirmation. Please try again or contact the club.",
    });
  }
});

// ------------------------------------------------------
// Apply latest client selections to the proposal items (include/qty) and recalc totals
// ------------------------------------------------------
router.post("/:functionId/proposal/apply-client", async (req, res) => {
  const { functionId } = req.params;
  const userId = req.session.user?.id || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: proposalRows } = await client.query(
      `SELECT id, client_selection FROM proposals WHERE function_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [functionId]
    );
    const proposal = proposalRows[0];
    if (!proposal) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Proposal not found" });
    }
    let selection = proposal.client_selection;
    if (!selection) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, error: "No client selections to apply" });
    }
    if (typeof selection === "string") {
      try {
        selection = JSON.parse(selection);
      } catch (e) {
        selection = null;
      }
    }
    const selections = selection?.selections || [];
    if (!selections.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, error: "No client selections to apply" });
    }

    const { rows: itemRows } = await client.query(
      `SELECT id, description, unit_price
         FROM proposal_items
        WHERE proposal_id = $1`,
      [proposal.id]
    );
    const itemsById = new Map(itemRows.map((row) => [Number(row.id), row]));
    const itemsByLabel = new Map(
      itemRows.map((row) => [normalizeItemLabel(row.description || ""), row]).filter(([label]) => label)
    );

    for (const sel of selections) {
      const itemId = Number(sel.id);
      let row = Number.isInteger(itemId) ? itemsById.get(itemId) : null;
      if (!row && sel.description) {
        row = itemsByLabel.get(normalizeItemLabel(sel.description || "")) || null;
      }
      if (!row) continue;
      const baseLabel = stripAllMetadata(row.description || "");
      const meta = extractMetadata(row.description || "");
      const originalQty = Number(meta.qty || 1) || 1;
      const perUnit = (Number(row.unit_price) || 0) / originalQty || 0;
      const newQty = Number(
        sel.qty !== undefined && sel.qty !== null ? sel.qty : meta.qty || 1
      );
      // Default to included unless the client explicitly unchecked it
      const includeFlag =
        sel.include === undefined || sel.include === null ? true : Boolean(sel.include);

      meta.qty = newQty;
      meta.excluded = includeFlag ? false : true;
      const metaString = Object.entries(meta)
        .filter(([, val]) => val !== undefined && val !== null && val !== "")
        .map(([k, v]) => `[${k}:${v}]`)
        .join(" ");
      const updatedDescription = `${baseLabel}${metaString ? " " + metaString : ""}`.trim();
      const newTotal = includeFlag ? perUnit * newQty : 0;

      await client.query(
        `UPDATE proposal_items
            SET description = $1,
                unit_price = $2,
                updated_by = COALESCE($4, updated_by),
                updated_at = NOW()
          WHERE id = $3`,
        [updatedDescription, newTotal, row.id, userId]
      );
    }

    await recalcTotals(client, proposal.id, userId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Quote] apply-client failed:", err);
    res.status(500).json({ success: false, error: "Failed to apply client selections" });
  } finally {
    client.release();
  }
});

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

async function findProposalByToken(token) {
  const { rows } = await pool.query(
    `
    SELECT p.*,
           f.event_name,
           f.event_date,
           f.start_time,
           f.end_time,
           f.attendees,
           f.room_id,
           r.name AS room_name,
           f.id_uuid AS function_id
      FROM proposals p
      JOIN functions f ON f.id_uuid = p.function_id
 LEFT JOIN rooms r ON r.id = f.room_id
     WHERE p.client_token = $1
     LIMIT 1;
    `,
    [token]
  );
  return rows[0] || null;
}

async function recalcTotals(client, proposalId, userId = null) {
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
  itemRows.forEach((row) => {
    const meta = extractMetadata(row.description || "");
    const excluded = parseBoolean(meta.excluded);
    let linePrice = Number(row.unit_price) || 0;
    if (!excluded) {
      const qty = Number(meta.qty) || 1;
      const perUnit = derivePerUnitPrice(meta, linePrice);
      linePrice = qty > 0 ? perUnit * qty : perUnit;
    } else {
      linePrice = 0;
    }
    subtotal += linePrice;
    if (excluded) return;
    const qty = Number(meta.qty) || 1;
    let lineCost = 0;
    if (meta.cost_each !== undefined) {
      const ce = Number(meta.cost_each);
      if (Number.isFinite(ce)) lineCost = ce * (qty > 0 ? qty : 1);
    } else if (meta.cost !== undefined) {
      const ct = Number(meta.cost);
      if (Number.isFinite(ct)) lineCost = ct;
    }
    costTotal += lineCost;
  });

  const {
    rows: [currentTotals],
  } = await client.query(
    `SELECT discount_amount
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

  const discountAmount = Number(currentTotals?.discount_amount) || 0;
  const totalPaid = Number(paymentRow?.total_paid) || 0;
  const finalTotal = subtotal - discountAmount;
  const remaining = finalTotal - totalPaid;

  await client.query(
    `UPDATE proposal_totals
        SET subtotal = $1,
            gratuity_amount = $2,
            gratuity_percent = 0,
            deposit_amount = 0,
            total_paid = $3,
            remaining_due = $4,
            updated_at = NOW(),
            updated_by = COALESCE($5, updated_by)
      WHERE proposal_id = $6`,
    [subtotal, 0, totalPaid, remaining, userId, proposalId]
  );

  await client.query(
    `UPDATE functions f
        SET totals_price = $1,
            totals_cost = $2,
            updated_at = NOW(),
            updated_by = COALESCE($4, f.updated_by)
       FROM proposals p
      WHERE p.id = $3
        AND p.function_id = f.id_uuid`,
    [finalTotal, costTotal, proposalId, userId]
  );
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function isPerPersonUnit(value) {
  const normalized = String(value || "").toLowerCase();
  return (
    normalized === "per_person" ||
    normalized === "per-person" ||
    normalized === "per person" ||
    normalized === "pp"
  );
}

function derivePerUnitPrice(meta = {}, unitPrice = 0) {
  const qty = Number(meta.qty) || 1;
  const base = meta.base != null ? Number(meta.base) : null;
  if (Number.isFinite(base)) return base;
  const unitType = String(meta.unit_type || "").toLowerCase();
  if (isPerPersonUnit(unitType)) return Number(unitPrice) || 0;
  const numericUnitPrice = Number(unitPrice) || 0;
  if (qty > 1 && numericUnitPrice < qty) return numericUnitPrice;
  return qty > 0 ? numericUnitPrice / qty : numericUnitPrice;
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

function normalizeItemLabel(description = "") {
  return stripAllMetadata(description || "").replace(/ x \d+$/i, "").trim();
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

async function markMenuUpdated(client, functionId, menuId, userId) {
  if (!functionId || !menuId) return;
  await client.query(
    `INSERT INTO function_menu_updates (function_id, menu_id, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (function_id, menu_id)
     DO UPDATE
           SET updated_at = EXCLUDED.updated_at,
               updated_by = EXCLUDED.updated_by`,
    [functionId, menuId, userId || null]
  );
}

async function fetchMenuMetaLookup(items = []) {
  const ids = Array.from(
    new Set(
      (items || [])
        .map((item) => Number(extractMetadata(item.description || "").menu_id || 0))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
  if (!ids.length) return {};
  const { rows } = await pool.query(
    `SELECT m.id,
            m.name,
            c.name AS category_name
       FROM menus m
  LEFT JOIN menu_categories c ON c.id = m.category_id
      WHERE m.id = ANY($1::int[])`,
    [ids]
  );
  return rows.reduce((acc, row) => {
    acc[row.id] = {
      name: row.name,
      category: row.category_name || "",
    };
    return acc;
  }, {});
}

// Apply client selection (include/qty) to a local items array for rendering
function applySelectionsToItems(items = [], selections = []) {
  const selMap = new Map();
  const selLabelMap = new Map();
  selections.forEach((s) => {
    if (!s) return;
    if (s.id) selMap.set(Number(s.id), s);
    if (s.description) {
      const label = normalizeItemLabel(s.description || "");
      if (label && !selLabelMap.has(label)) selLabelMap.set(label, s);
    }
  });
  return items.map((item) => {
    const sel =
      selMap.get(Number(item.id)) ||
      selLabelMap.get(normalizeItemLabel(item.description || ""));
    if (!sel) return item;
    // Default to included unless client explicitly unchecked
    const include = sel.include === false ? false : true;
    const qty = Number(sel.qty || 1) || 1;
    // adjust description metadata for view only
    const baseLabel = stripAllMetadata(item.description || "");
    const meta = extractMetadata(item.description || "");
    const originalQty = Number(meta.qty || 1) || 1;
    if (!include) {
      meta.excluded = true;
    } else {
      delete meta.excluded;
    }
    meta.qty = qty;
    const metaString = Object.entries(meta)
      .filter(([, val]) => val !== undefined && val !== null && val !== "")
      .map(([k, v]) => `[${k}:${v}]`)
      .join(" ");
    const updatedDesc = `${baseLabel}${metaString ? " " + metaString : ""}`.trim();
    const perUnit = derivePerUnitPrice(meta, Number(item.unit_price) || 0);
    return {
      ...item,
      description: updatedDesc,
      unit_price: include ? perUnit * qty : 0,
    };
  });
}

async function addMenuBundle(client, functionId, proposalId, menuId, userId = null) {
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
    `INSERT INTO proposal_items (proposal_id, description, unit_price, updated_by)
     VALUES ($1, $2, $3, $4)`,
    [proposalId, menuDescription, menu.price || 0, userId]
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
    const optionLabel = choice.option_name || choice.choice_name;
    let description = `Choice: ${optionLabel || choice.choice_name}`;
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
      `INSERT INTO proposal_items (proposal_id, description, unit_price, updated_by)
       VALUES ($1, $2, $3, $4)`,
      [proposalId, description, total, userId]
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
      `INSERT INTO proposal_items (proposal_id, description, unit_price, updated_by)
       VALUES ($1, $2, $3, $4)`,
      [proposalId, description, total, userId]
    );
  }

  await markMenuUpdated(client, functionId, menu.id, userId);
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
      `SELECT id, status, created_at, contact_id,
              client_status,
              client_accepted_at,
              client_accepted_by,
              client_token,
              client_selection
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
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await recalcTotals(client, activeProposal.id, req.session.user?.id || null);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        console.warn("[Quote] Failed to recalc totals:", err.message);
      } finally {
        client.release();
      }

      const [itemsRes, payRes, totalsRes] = await Promise.all([
        pool.query(
          `SELECT id, description, unit_price
             FROM proposal_items
            WHERE proposal_id = $1
            ORDER BY id ASC`,
          [activeProposal.id]
        ),
        pool.query(
          `SELECT id, payment_type, amount, status, method, paid_on
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

      // Keep quote UI in sync with stored proposal items; client selections can be applied explicitly.
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
      { includeItemIds: [], includeContactIds: [], sections: [], terms: "", termIds: [], termIdsExplicit: false };

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
      termIdsExplicit: Boolean(sessionSaved.termIdsExplicit),
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

    if (
      !proposalBuilderSaved.termIds.length &&
      termsRes.rows.length &&
      !proposalBuilderSaved.termIdsExplicit
    ) {
      const defaultTerm = termsRes.rows.find((term) => term.is_default) || termsRes.rows[0];
      if (defaultTerm) {
        proposalBuilderSaved.termIds = [String(defaultTerm.id)];
        sessionSaved.termIds = proposalBuilderSaved.termIds;
        sessionSaved.termIdsExplicit = false;
        proposalBuilderSaved.termIdsExplicit = false;
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
      "/js/functions/detail.js",
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
      clientStatus: activeProposal?.client_status || "draft",
      clientAcceptedAt: activeProposal?.client_accepted_at || null,
      clientAcceptedBy: activeProposal?.client_accepted_by || null,
      clientSelection: activeProposal?.client_selection || null,
      clientLink: activeProposal ? `${getAppUrl(req)}/functions/proposal/client/${activeProposal.client_token}` : null,
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
      proposalStatus: activeProposal?.status || "draft",
      proposalStatusOptions: PROPOSAL_STATUSES,
      hideChrome: false,
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
  const userId = req.session.user?.id || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const proposalId = await ensureActiveProposal(client, functionId);
    await addMenuBundle(client, functionId, proposalId, menu_id, userId);

    await recalcTotals(client, proposalId, userId);
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
  const userId = req.session.user?.id || null;

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

    await markMenuUpdated(client, functionId, menu_id, userId);
    await recalcTotals(client, proposalId, userId);
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
  const userId = req.session.user?.id || null;
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
              remaining_due = 0,
              updated_at = NOW(),
              updated_by = COALESCE($2, updated_by)
        WHERE proposal_id = $1`,
      [proposalId, userId]
    );

    await client.query(
      `UPDATE functions
          SET totals_price = 0,
              totals_cost = 0,
              updated_at = NOW(),
              updated_by = COALESCE($2, updated_by)
        WHERE id_uuid = $1`,
      [functionId, userId]
    );

    await client.query(
      `DELETE FROM function_menu_updates WHERE function_id = $1`,
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
async function rebuildMenu(client, proposalId, functionId, menuId, userId = null) {
  const existing = await client.query(
    `SELECT id, description, unit_price, client_selectable
       FROM proposal_items
      WHERE proposal_id = $1
        AND description ILIKE $2
      ORDER BY id ASC`,
    [proposalId, `%[menu_id:${menuId}]%`]
  );

  const adjustments = new Map();
  for (const row of existing.rows) {
    const label = normalizeItemLabel(row.description || "");
    if (!label) continue;
    adjustments.set(label, {
      unit_price: Number(row.unit_price) || 0,
      meta: extractMetadata(row.description || ""),
      client_selectable: row.client_selectable,
    });
  }

  await client.query(
    `DELETE FROM proposal_items
      WHERE proposal_id = $1
        AND description ILIKE $2`,
    [proposalId, `%[menu_id:${menuId}]%`]
  );
  await addMenuBundle(client, functionId, proposalId, menuId, userId);

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
    const label = normalizeItemLabel(row.description || "");
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

    const qty = Number(mergedMeta.qty) || 1;
    const base = mergedMeta.base != null ? Number(mergedMeta.base) : null;
    let nextUnitPrice = saved.unit_price;
    if (Number.isFinite(base) && qty > 0) {
      const baseTotal = base * qty;
      if (Math.abs(nextUnitPrice - baseTotal) <= 0.01 || nextUnitPrice < base) {
        nextUnitPrice = baseTotal;
      }
    }

    await client.query(
      `UPDATE proposal_items
          SET unit_price = $1,
              description = $2,
              client_selectable = COALESCE($4, client_selectable)
        WHERE id = $3`,
      [nextUnitPrice, updatedDescription, row.id, saved.client_selectable]
    );
  }
}

async function rebuildMenusForFunction(client, proposalId, functionId, userId = null) {
  const { rows: menuRows } = await client.query(
    `SELECT DISTINCT menu_id FROM function_menu_updates WHERE function_id = $1 AND menu_id IS NOT NULL`,
    [functionId]
  );
  if (!menuRows.length) return false;
  for (const row of menuRows) {
    await rebuildMenu(client, proposalId, functionId, row.menu_id, userId);
  }
  await recalcTotals(client, proposalId, userId);
  return true;
}

router.post("/:functionId/quote/resync-menu", async (req, res) => {
  const { functionId } = req.params;
  const { menu_id } = req.body || {};
  if (!menu_id) return res.status(400).json({ success: false, error: "menu_id is required" });
  const userId = req.session.user?.id || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);
    await rebuildMenu(client, proposalId, functionId, menu_id, userId);
    await recalcTotals(client, proposalId, userId);
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
  const userId = req.session.user?.id || null;
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
      await rebuildMenu(client, proposalId, functionId, row.menu_id, userId);
    }

    await recalcTotals(client, proposalId, userId);
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
// Update totals (discount only)
// ------------------------------------------------------
router.post("/:proposalId/totals/update", async (req, res) => {
  const { proposalId } = req.params;
  const { discount_amount = 0 } = req.body || {};

  const userId = req.session.user?.id || null;
  const discountValue = Math.max(0, Number(discount_amount) || 0);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE proposal_totals
          SET discount_amount = $1,
              gratuity_percent = 0,
              gratuity_amount = 0,
              deposit_amount = 0,
              updated_at = NOW(),
              updated_by = COALESCE($3, updated_by)
        WHERE proposal_id = $2`,
      [discountValue, proposalId, userId]
    );

    await recalcTotals(client, proposalId, userId);

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
// Add a payment
// ------------------------------------------------------
router.post("/:proposalId/payments", async (req, res) => {
  const { proposalId } = req.params;
  const { payment_type, amount, paid_on, method } = req.body || {};

  const parsedAmount = Number(amount);
  if (!proposalId || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, error: "Invalid payment data" });
  }

  let paidOnValue = null;
  if (paid_on) {
    const dateValue = new Date(paid_on);
    if (Number.isNaN(dateValue.getTime())) {
      return res.status(400).json({ success: false, error: "Invalid paid_on date" });
    }
    paidOnValue = paid_on;
  }

  const description = String(payment_type || "Payment").trim() || "Payment";
  const methodValue = String(method || "other").toLowerCase();
  const statusValue = "completed";
  const userId = req.session.user?.id || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO payments (proposal_id, payment_type, amount, method, status, paid_on)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
       RETURNING id`,
      [proposalId, description, parsedAmount, methodValue, statusValue, paidOnValue]
    );

    await recalcTotals(client, proposalId, userId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error adding payment:", err);
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
  const { unit_price, include = true, cost_total, cost_each } = req.body || {};
  if (!Number.isInteger(id) || id <= 0 || unit_price === undefined) {
    return res.status(400).json({ success: false, error: "Invalid input" });
  }
  const userId = req.session.user?.id || null;

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

    if (cost_each !== undefined || cost_total !== undefined) {
      // Prefer cost_each; fallback to cost_total
      description = stripMetadata(description, "cost");
      description = stripMetadata(description, "cost_each");
      const numericCostEach =
        cost_each === null || cost_each === ""
          ? null
          : Number(cost_each);
      if (Number.isFinite(numericCostEach)) {
        description = includeMetadata(description, "cost_each", numericCostEach);
      } else if (cost_total !== undefined) {
        const numericCostTotal =
          cost_total === null || cost_total === ""
            ? null
            : Number(cost_total);
        if (Number.isFinite(numericCostTotal)) {
          description = includeMetadata(description, "cost", numericCostTotal);
        }
      }
    }

    const numericUnitPrice = Number(unit_price);
    const storedUnitPrice = parseBoolean(include) && Number.isFinite(numericUnitPrice) ? numericUnitPrice : 0;

    await client.query(
      `UPDATE proposal_items
          SET unit_price = $1,
              description = $2,
              updated_at = NOW(),
              updated_by = COALESCE($4, updated_by)
        WHERE id = $3`,
      [storedUnitPrice, description, id, userId]
    );
    const meta = extractMetadata(description);
    if (meta.menu_id) {
      const {
        rows: fnRows,
      } = await client.query(
        `SELECT function_id
           FROM proposals
          WHERE id = $1
          LIMIT 1`,
        [proposalId]
      );
      const fnRow = fnRows[0];
      if (fnRow?.function_id) {
        await markMenuUpdated(client, fnRow.function_id, Number(meta.menu_id), userId);
      }
    }

    await recalcTotals(client, proposalId, userId);
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
  const userId = req.session.user?.id || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {
      rows,
    } = await client.query(
      `SELECT description, proposal_id, unit_price
         FROM proposal_items
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Item not found" });
    }
    const currentDescription = rows[0].description || "";
    const baseLabel = stripAllMetadata(currentDescription || "").replace(/ x \d+$/i, "").trim();
    const meta = extractMetadata(currentDescription || "");
    const previousQty = Number(meta.qty || 1) || 1;
    const perUnitPrice =
      previousQty > 0 ? (Number(rows[0].unit_price) || 0) / previousQty : Number(rows[0].unit_price) || 0;
    let perUnitCost = null;
    if (meta.cost_each !== undefined) {
      const ce = Number(meta.cost_each);
      if (Number.isFinite(ce)) perUnitCost = ce;
    } else if (meta.cost !== undefined) {
      const ct = Number(meta.cost);
      if (Number.isFinite(ct) && previousQty > 0) {
        perUnitCost = ct / previousQty;
      }
    }

    meta.qty = qty;
    if (perUnitCost !== null && meta.cost_each === undefined) {
      const newCost = perUnitCost * qty;
      if (Number.isFinite(newCost)) {
        meta.cost = Number(newCost.toFixed(2));
      }
    }

    const metaString = Object.entries(meta)
      .filter(([, val]) => val !== undefined && val !== null && val !== "")
      .map(([k, v]) => `[${k}:${v}]`)
      .join(" ");
    const updatedDescription = `${baseLabel ? `${baseLabel} x ${qty}` : `Item x ${qty}`}${
      metaString ? " " + metaString : ""
    }`.trim();
    const updatedUnitPrice = Number.isFinite(perUnitPrice) ? perUnitPrice * qty : 0;

    await client.query(
      `UPDATE proposal_items
          SET description = $1,
              unit_price = $2,
              updated_at = NOW(),
              updated_by = COALESCE($4, updated_by)
        WHERE id = $3`,
      [updatedDescription, updatedUnitPrice, id, userId]
    );

    const metaMap = extractMetadata(updatedDescription);
    if (metaMap.menu_id) {
      const { rows: fnRows } = await client.query(
        `SELECT function_id FROM proposals WHERE id = $1 LIMIT 1`,
        [rows[0].proposal_id]
      );
      const fnRecord = fnRows[0];
      if (fnRecord?.function_id) {
        await markMenuUpdated(client, fnRecord.function_id, Number(metaMap.menu_id), userId);
      }
    }

    await recalcTotals(client, rows[0].proposal_id, userId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating qty:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
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
      { includeItemIds: [], includeContactIds: [], sections: [], terms: "", termIds: [], termIdsExplicit: false };
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
      termIdsExplicit: Boolean(sessionSaved.termIdsExplicit),
    };
    if (!saved.termIds.length && termsRes.rows.length && !saved.termIdsExplicit) {
      const defaultTerms =
        termsRes.rows.find((term) => term.is_default) || termsRes.rows[0];
      if (defaultTerms) {
        saved.termIds = [String(defaultTerms.id)];
        sessionSaved.termIds = saved.termIds;
        sessionSaved.termIdsExplicit = false;
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
      const { rows } = await pool.query(
        `SELECT id, description, unit_price, client_selectable
           FROM proposal_items
          WHERE proposal_id = $1
          ORDER BY id ASC`,
        [proposalId]
      );
      proposalItems = rows;
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
    termIdsExplicit: true,
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
          `SELECT id, description, unit_price, client_selectable
             FROM proposal_items
            WHERE proposal_id = $1
              AND id = ANY($2::int[])
            ORDER BY id ASC`,
          [proposalId, includeIds]
        );
        items = rows;
      } else {
        const { rows } = await pool.query(
          `SELECT id, description, unit_price, client_selectable
             FROM proposal_items
            WHERE proposal_id = $1
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
    if (!saved.termIdsExplicit && !selectedTermIds.length && termsLibraryRows.length) {
      const defaultTerm = termsLibraryRows.find((term) => term.is_default) || termsLibraryRows[0];
      if (defaultTerm) selectedTermIds = [String(defaultTerm.id)];
    }
    const normalizeBlockMarkup = (block = "") => {
      const trimmed = String(block || "").trim();
      if (!trimmed) return "";
      const hasHtml = /<[a-z][\s\S]*>/i.test(trimmed);
      return hasHtml ? trimmed : trimmed.replace(/\n/g, "<br>");
    };

    const blockKey = (html = "") =>
      html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const selectedTermBlocks = termsLibraryRows
      .filter((term) => selectedTermIds.includes(String(term.id)))
      .map((term) => normalizeBlockMarkup(term.content || ""))
      .filter((chunk) => chunk && chunk.trim().length);

    const blocks = [...selectedTermBlocks];
    if (saved.terms && saved.terms.trim().length) {
      blocks.push(normalizeBlockMarkup(saved.terms));
    }

    const seen = new Set();
    const dedupedBlocks = blocks.filter((chunk) => {
      const normalised = blockKey(chunk);
      if (!normalised) return false;
      if (seen.has(normalised)) return false;
      seen.add(normalised);
      return true;
    });

    const combinedTerms = dedupedBlocks.join("\n\n");

    let totalsData = null;
    let payments = [];
    if (proposalId) {
      const [{ rows: totalsRows }, { rows: paymentRows }] = await Promise.all([
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
          [proposalId]
        ),
        pool.query(
          `SELECT id, payment_type, amount, method, paid_on
             FROM payments
            WHERE proposal_id = $1
            ORDER BY paid_on ASC`,
          [proposalId]
        ),
      ]);
      totalsData = totalsRows[0] || null;
      payments = paymentRows || [];
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

    const menuMetaLookup = await fetchMenuMetaLookup(items);

    res.render("pages/functions/proposal-preview", {
      layout: "layouts/main",
      title: `Proposal Preview - ${fn.event_name}`,
      pageType: "",
      hideChrome: true,
      saved,
      fn,
      proposalId,
      items,
      contacts,
      sections: saved.sections || [],
      terms: combinedTerms,
      totals: totalsData,
      menuMetaLookup,
      payments,
    });
  } catch (err) {
    console.error("preview error:", err);
    res.status(500).send("Error rendering preview");
  }
});

router.post("/:functionId/proposal/status", async (req, res) => {
  const { functionId } = req.params;
  const normalized = String(req.body?.status || "").toLowerCase();
  if (!PROPOSAL_STATUSES.includes(normalized)) {
    return res.status(400).json({ success: false, error: "Invalid proposal status." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id FROM proposals WHERE function_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [functionId]
    );
    const proposal = rows[0];
    if (!proposal) {
      return res.status(404).json({ success: false, error: "No proposal found for this function." });
    }

    await pool.query(`UPDATE proposals SET status = $1, updated_at = NOW() WHERE id = $2`, [
      normalized,
      proposal.id,
    ]);

    res.json({ success: true, status: normalized });
  } catch (err) {
    console.error("Error updating proposal status:", err);
    res.status(500).json({ success: false, error: "Failed to update proposal status." });
  }
});

// ------------------------------------------------------
// Mark menu items as client-selectable
// ------------------------------------------------------
router.post("/:functionId/quote/menu/client-toggle", async (req, res) => {
  const { functionId } = req.params;
  const { menu_id, selectable } = req.body || {};
  const flag = selectable === false || selectable === "false" ? false : true;
  if (!menu_id) return res.status(400).json({ success: false, error: "menu_id is required" });
  const userId = req.session.user?.id || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);
    const { rows } = await client.query(
      `SELECT id, description FROM proposal_items WHERE proposal_id = $1 AND description ILIKE $2`,
      [proposalId, `%[menu_id:${menu_id}]%`]
    );

    for (const row of rows) {
      const baseLabel = stripAllMetadata(row.description || "");
      const meta = extractMetadata(row.description || "");
      meta.client_selectable = flag;
      const metaString = Object.entries(meta)
        .filter(([, val]) => val !== undefined && val !== null && val !== "")
        .map(([k, v]) => `[${k}:${v}]`)
        .join(" ");
      const updatedDescription = `${baseLabel}${metaString ? " " + metaString : ""}`.trim();
      await client.query(
        `
        UPDATE proposal_items
           SET client_selectable = $1,
               description = $2,
               updated_by = COALESCE($4, updated_by),
               updated_at = NOW()
         WHERE id = $3;
        `,
        [flag, updatedDescription, row.id, userId]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Quote] client-toggle failed:", err);
    res.status(500).json({ success: false, error: "Failed to update client-selectable flag" });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Hide/show menu on proposal (set excluded meta on all items for that menu)
// ------------------------------------------------------
router.post("/:functionId/quote/menu/proposal-toggle", async (req, res) => {
  const { functionId } = req.params;
  const { menu_id, hide } = req.body || {};
  if (!menu_id) return res.status(400).json({ success: false, error: "menu_id is required" });
  const userId = req.session.user?.id || null;
  const hideFlag = hide === false || hide === "false" ? false : true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);
    const { rows } = await client.query(
      `SELECT id, description
         FROM proposal_items
        WHERE proposal_id = $1
          AND description ILIKE $2`,
      [proposalId, `%[menu_id:${menu_id}]%`]
    );
    for (const row of rows) {
      const baseLabel = stripAllMetadata(row.description || "");
      const meta = extractMetadata(row.description || "");
      meta.excluded = hideFlag;
      const metaString = Object.entries(meta)
        .filter(([, val]) => val !== undefined && val !== null && val !== "")
        .map(([k, v]) => `[${k}:${v}]`)
        .join(" ");
      const updatedDescription = `${baseLabel}${metaString ? " " + metaString : ""}`.trim();
      await client.query(
        `UPDATE proposal_items
            SET description = $1,
                updated_by = COALESCE($3, updated_by),
                updated_at = NOW()
          WHERE id = $2`,
        [updatedDescription, row.id, userId]
      );
    }
    await recalcTotals(client, proposalId, userId);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Quote] proposal-toggle failed:", err);
    res.status(500).json({ success: false, error: "Failed to toggle proposal visibility" });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Send client link (sets status to sent)
// ------------------------------------------------------
router.post("/:functionId/quote/send-client", async (req, res) => {
  const { functionId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);
    const {
      rows: [proposal],
    } = await client.query(`SELECT client_token FROM proposals WHERE id = $1 LIMIT 1`, [proposalId]);
    const token = proposal?.client_token;
    await client.query(
      `UPDATE proposals
          SET client_status = 'sent',
              updated_at = NOW()
        WHERE id = $1`,
      [proposalId]
    );
    await client.query("COMMIT");
    const link = `${getAppUrl(req)}/functions/proposal/client/${token}`;
    res.json({ success: true, link });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Quote] send-client failed:", err);
    res.status(500).json({ success: false, error: "Failed to prepare client link" });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------
// Email client link (uses Graph; lands in Sent Items)
// ------------------------------------------------------
router.post("/:functionId/quote/send-client-email", async (req, res) => {
  const { functionId } = req.params;
  const { contactId, email, name, linkType = "client", message } = req.body || {};

  const accessToken = await getGraphAccessTokenFromSession();
  if (!accessToken) {
    return res.status(401).json({ success: false, error: "Unable to acquire mail token." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proposalId = await ensureActiveProposal(client, functionId);
    const {
      rows: [proposal],
    } = await client.query(`SELECT client_token FROM proposals WHERE id = $1 LIMIT 1`, [proposalId]);

    const {
      rows: [fn],
    } = await client.query(
      `SELECT id_uuid, event_name, event_date, attendees FROM functions WHERE id_uuid = $1 LIMIT 1`,
      [functionId]
    );

    let contact = null;
    if (contactId) {
      const {
        rows: [c],
      } = await client.query(`SELECT id, name, email FROM contacts WHERE id = $1 LIMIT 1`, [contactId]);
      contact = c || null;
    }

    const recipientEmail = (contact?.email || email || "").trim();
    if (!recipientEmail) throw new Error("No recipient email available.");
    const recipientName = (contact?.name || name || "").trim();

    const link = `${getAppUrl(req)}/functions/proposal/client/${proposal.client_token}`;
    const fnName = fn?.event_name || "your booking";
    const fnDate = fn?.event_date
      ? new Date(fn.event_date).toLocaleDateString("en-NZ", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "";

    const bodyMessage =
      (message && message.trim()) ||
      `Here is your proposal for ${fnName}${fnDate ? ` on ${fnDate}` : ""}. Please review and confirm using the link below.`;

    const subject = `${recipientName || fnName} - Porirua Club Events | Proposal`;
    const html = `
      <p>Hi ${recipientName || "there"},</p>
      <p>${bodyMessage}</p>
      <p><a href="${link}">View &amp; confirm your proposal</a></p>
      <p style="font-size:12px;color:#666;">This email was automatically sent by Porirua Club Platform.</p>
    `;

    await graphSendMail(accessToken, {
      to: recipientEmail,
      subject,
      body: html,
    });

    // Log to messages so it appears in communications/overview
    await client.query(
      `
      INSERT INTO messages
        (related_function, related_contact, from_email, to_email, subject, body, body_html, created_at, message_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'outbound');
      `,
      [
        fn?.id_uuid || functionId,
        contact?.id || null,
        process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz",
        recipientEmail,
        subject,
        html.replace(/<[^>]+>/g, ""),
        html,
      ]
    );

    await client.query(
      `UPDATE proposals
          SET client_status = 'sent',
              updated_at = NOW()
        WHERE id = $1`,
      [proposalId]
    );

    await client.query(
      `
      INSERT INTO proposal_acceptance_events
        (proposal_id, client_status, submitted_by, submitted_ip, payload, snapshot)
      VALUES
        ($1, $2, $3, $4, $5, $6);
      `,
      [
        proposalId,
        "sent",
        recipientEmail,
        req.ip,
        JSON.stringify({ linkType, recipientEmail, recipientName, message: bodyMessage }),
        JSON.stringify({}),
      ]
    );

    await client.query("COMMIT");
    res.json({ success: true, link, sentTo: recipientEmail });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Quote] send-client-email failed:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to send email" });
  } finally {
    client.release();
  }
});

router.get("/:proposalId/totals", async (req, res) => {
  const { proposalId } = req.params;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await recalcTotals(client, proposalId, req.session.user?.id || null);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.warn("[Quote] Totals recalc skipped:", err.message);
    } finally {
      client.release();
    }
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
