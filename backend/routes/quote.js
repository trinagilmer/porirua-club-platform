const express = require("express");
const router = express.Router();
const { pool } = require("../db");

/**
 * GET /functions/:functionId/quote
 * Display the quote (proposal) view for a given function
 */
router.get("/:functionId/quote", async (req, res) => {
  const { functionId } = req.params;

  try {
    // 🧩 Load base function info
    const { rows: fnRows } = await pool.query(
      `SELECT id_uuid, event_name, event_date, status, attendees, totals_price, totals_cost, budget
       FROM functions
       WHERE id_uuid = $1;`,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 🧩 Load related proposals
    const { rows: proposals } = await pool.query(
      `SELECT id, status, created_at, contact_id
       FROM proposals
       WHERE function_id = $1
       ORDER BY created_at DESC;`,
      [functionId]
    );

    // Use latest proposal
    const activeProposal = proposals[0] || null;
    let proposalItems = [];
    let payments = [];
    let totals = null;

    if (activeProposal) {
      // 🧩 Load proposal items
      const { rows: items } = await pool.query(
        `SELECT *
         FROM proposal_items
         WHERE proposal_id = $1
         ORDER BY id ASC;`,
        [activeProposal.id]
      );
      proposalItems = items;

      // 🧩 Load payments
      const { rows: payRows } = await pool.query(
        `SELECT id, amount, status, method, paid_on
         FROM payments
         WHERE proposal_id = $1
         ORDER BY paid_on ASC;`,
        [activeProposal.id]
      );
      payments = payRows;

      // 🧩 Load totals if they exist
      const { rows: totalRows } = await pool.query(
        `SELECT subtotal, gratuity_percent, gratuity_amount, discount_amount, deposit_amount, total_paid, remaining_due
         FROM proposal_totals
         WHERE proposal_id = $1
         LIMIT 1;`,
        [activeProposal.id]
      );
      totals = totalRows[0] || null;
    }

   // 🧩 Load supporting data (contacts, rooms, etc.)
const [
  linkedContactsRes,
  roomsRes,
  eventTypesRes,
  categoriesRes,
  unitsRes
] = await Promise.all([
  pool.query(
    `SELECT c.id, c.name, c.email, c.phone, fc.is_primary
     FROM contacts c
     JOIN function_contacts fc ON fc.contact_id = c.id
     WHERE fc.function_id = $1
     ORDER BY fc.is_primary DESC, c.name ASC;`,
    [functionId]
  ),
  pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
  pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),

  // 🧱 Add these two:
  pool.query(`SELECT id, name FROM menu_categories ORDER BY name ASC;`),
  pool.query(`SELECT id, name FROM menu_units ORDER BY id ASC;`)
]);


    // 🖥️ Render the Quote page
   res.render("pages/functions/quote", {
  layout: "layouts/main",
  title: `Quote — ${fn.event_name}`,
  user: req.session.user || null,
  fn,
  proposals,
  proposalItems,
  payments,
  totals,
  linkedContacts: linkedContactsRes.rows,
  rooms: roomsRes.rows,
  eventTypes: eventTypesRes.rows,
  categories: categoriesRes.rows,   // ✅ added
  units: unitsRes.rows,             // ✅ added
  activeTab: "quote"
});
  } catch (err) {
    console.error("❌ [Quote] Error loading quote page:", err);
    res.status(500).send("Error loading quote page");
  }
});

/* =========================================================
   ➕ CREATE NEW QUOTE / PROPOSAL
========================================================= */
router.post("/:id/quote/new", async (req, res) => {
  const { id: functionId } = req.params;
  const { contact_id } = req.body; // optional

  try {
    // 1️⃣ Insert new proposal
    const { rows: proposalRows } = await pool.query(
      `
      INSERT INTO proposals (function_id, contact_id, status, created_at)
      VALUES ($1, $2, 'draft', NOW())
      RETURNING id;
      `,
      [functionId, contact_id || null]
    );

    const proposal = proposalRows[0];

    // 2️⃣ Create corresponding empty totals record
    await pool.query(
      `
      INSERT INTO proposal_totals (
        proposal_id, subtotal, gratuity_percent, gratuity_amount,
        discount_amount, deposit_amount, total_paid, remaining_due
      )
      VALUES ($1, 0, 0, 0, 0, 0, 0, 0);
      `,
      [proposal.id]
    );

    console.log(`✅ Created new quote (Proposal ID ${proposal.id}) for Function ${functionId}`);

    // 3️⃣ Redirect back to quote page
    res.redirect(`/functions/${functionId}/quote`);
  } catch (err) {
    console.error("❌ Error creating new quote:", err);
    res.status(500).send("Failed to create new quote");
  }
});
/* =========================================================
   ✏️ UPDATE PROPOSAL TOTALS (AJAX)
========================================================= */
router.post("/:proposalId/totals/update", async (req, res) => {
  const { proposalId } = req.params;
  const {
    subtotal,
    gratuity_percent,
    discount_amount,
    deposit_amount
  } = req.body;

  try {
    // Recalculate totals server-side (basic)
    const gratuity_amount = ((Number(subtotal) || 0) * (Number(gratuity_percent) || 0)) / 100;
    const total_paid = 0; // placeholder until payment integration
    const remaining_due =
      (Number(subtotal) + gratuity_amount - (Number(discount_amount) || 0)) -
      (Number(deposit_amount) || 0) -
      total_paid;

    await pool.query(
      `
      UPDATE proposal_totals
      SET
        subtotal = $1,
        gratuity_percent = $2,
        gratuity_amount = $3,
        discount_amount = $4,
        deposit_amount = $5,
        remaining_due = $6
      WHERE proposal_id = $7;
      `,
      [
        subtotal || 0,
        gratuity_percent || 0,
        gratuity_amount || 0,
        discount_amount || 0,
        deposit_amount || 0,
        remaining_due || 0,
        proposalId
      ]
    );

    console.log(`✅ Updated totals for proposal ${proposalId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error updating proposal totals:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
module.exports = router;