// backend/routes/menus.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db'); // path is correct from /routes/menus.js

// ---------------------------------------------------------
// Small helper to keep JSON responses consistent
// ---------------------------------------------------------
function ok(res, data, code = 200) {
  return res.status(code).json({ success: true, data });
}
function fail(res, err, code = 500) {
  const message = typeof err === 'string' ? err : (err?.message || 'Server error');
  return res.status(code).json({ success: false, error: message });
}

// =========================================================
// 1️⃣ Menu Selections
// =========================================================

// GET all selections with category name
router.get('/selections', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ms.id,
              ms.name,
              ms.gst_applicable,
              ms.apply_to_minimum,
              ms.category_id,
              mc.name AS category_name
         FROM public.menu_selections ms
    LEFT JOIN public.menu_categories mc ON mc.id = ms.category_id
        ORDER BY ms.id ASC`
    );
    return ok(res, rows);
  } catch (err) {
    console.error('GET /selections error:', err);
    return fail(res, err);
  }
});

// POST new selection
router.post('/selections', async (req, res) => {
  try {
    const { name, category_id, gst_applicable, apply_to_minimum } = req.body || {};
    if (!name) return fail(res, 'Name is required', 400);

    const { rows } = await pool.query(
      `INSERT INTO public.menu_selections (name, category_id, gst_applicable, apply_to_minimum)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, category_id ?? null, gst_applicable ?? false, apply_to_minimum ?? false]
    );
    return ok(res, rows, 201);
  } catch (err) {
    console.error('POST /selections error:', err);
    return fail(res, err);
  }
});

// =========================================================
// 2️⃣ Menu Items
// =========================================================

// GET items for a specific selection (with unit name)
router.get('/items/:selection_id', async (req, res) => {
  try {
    const selectionId = Number(req.params.selection_id);
    if (!Number.isInteger(selectionId) || selectionId <= 0) {
      return fail(res, 'Invalid selection_id', 400);
    }

    const { rows } = await pool.query(
      `SELECT mi.id,
              mi.selection_id,
              mi.name,
              mi.description,
              mi.base_price,
              mi.unit_id,
              mi.image_url,
              mi.show_on_guest_menu,
              mu.name AS unit_name
         FROM public.menu_items mi
    LEFT JOIN public.menu_units mu ON mu.id = mi.unit_id
        WHERE mi.selection_id = $1
        ORDER BY mi.id ASC`,
      [selectionId]
    );

    // (If you need choices/addons per item, we can extend this later.)
    return ok(res, rows);
  } catch (err) {
    console.error('GET /items/:selection_id error:', err);
    return fail(res, err);
  }
});

// POST new item
router.post('/items', async (req, res) => {
  try {
    const { selection_id, name, description, base_price, unit_id, image_url, show_on_guest_menu } = req.body || {};
    if (!selection_id || !name) return fail(res, 'selection_id and name are required', 400);

    const { rows } = await pool.query(
      `INSERT INTO public.menu_items
        (selection_id, name, description, base_price, unit_id, image_url, show_on_guest_menu)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        selection_id,
        name,
        description ?? null,
        base_price ?? null,
        unit_id ?? null,
        image_url ?? null,
        show_on_guest_menu ?? true
      ]
    );
    return ok(res, rows, 201);
  } catch (err) {
    console.error('POST /items error:', err);
    return fail(res, err);
  }
});

// =========================================================
// 3️⃣ Menu Choices (legacy endpoints — schema mismatch)
// =========================================================

// NOTE: Your schema does NOT have menu_choices.menu_item_id.
// The old endpoints used that column, so they can’t function correctly.
// We’ll return 410 and point callers to the builder endpoints.
router.get('/choices/:menu_item_id', (_req, res) => {
  return fail(res, 'This endpoint is deprecated. Use /menus/builder/menus/:menu_id/choices instead.', 410);
});
router.post('/choices', (_req, res) => {
  return fail(res, 'This endpoint is deprecated. Use POST /menus/builder/menus/:menu_id/choices instead.', 410);
});

// =========================================================
// 4️⃣ Menu Options
// =========================================================

router.post('/options', async (req, res) => {
  try {
    const { choice_id, name, price, unit_id, enable_guest_quantity } = req.body || {};
    if (!choice_id) return fail(res, 'choice_id is required', 400);

    const { rows } = await pool.query(
      `INSERT INTO public.menu_options (choice_id, name, price, unit_id, enable_guest_quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [choice_id, name ?? null, (price === '' ? null : price), unit_id ?? null, enable_guest_quantity ?? false]
    );
    return ok(res, rows, 201);
  } catch (err) {
    console.error('POST /options error:', err);
    return fail(res, err);
  }
});

// =========================================================
// 5️⃣ Menu Add-ons
// =========================================================

router.get('/addons/:menu_item_id', async (req, res) => {
  try {
    const menuItemId = Number(req.params.menu_item_id);
    if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
      return fail(res, 'Invalid menu_item_id', 400);
    }

    const { rows } = await pool.query(
      `SELECT id, menu_item_id, name, price, unit_id, enable_quantity, enable_guest_quantity
         FROM public.menu_addons
        WHERE menu_item_id = $1
        ORDER BY id ASC`,
      [menuItemId]
    );
    return ok(res, rows);
  } catch (err) {
    console.error('GET /addons/:menu_item_id error:', err);
    return fail(res, err);
  }
});

router.post('/addons', async (req, res) => {
  try {
    const { menu_item_id, name, price, unit_id, enable_quantity, enable_guest_quantity } = req.body || {};
    if (!menu_item_id || !name) return fail(res, 'menu_item_id and name are required', 400);

    const { rows } = await pool.query(
      `INSERT INTO public.menu_addons
        (menu_item_id, name, price, unit_id, enable_quantity, enable_guest_quantity)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [menu_item_id, name, (price === '' ? null : price), unit_id ?? null, enable_quantity ?? false, enable_guest_quantity ?? false]
    );
    return ok(res, rows, 201);
  } catch (err) {
    console.error('POST /addons error:', err);
    return fail(res, err);
  }
});

// =========================================================
// 0️⃣ Builder: linked choices for a menu (uses SQL view)
// GET /menus/builder/menus/:menu_id/choices
// =========================================================
router.get('/builder/menus/:menu_id/choices', async (req, res) => {
  const menu_id = Number(req.params.menu_id);
  if (!Number.isInteger(menu_id) || menu_id <= 0) {
    return fail(res, 'Invalid menu_id', 400);
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         menu_id,
         choice_id,
         choice_name,
         option_id,
         option_name,
         option_price,
         unit_name,
         limit_count,
         enable_quantity
       FROM public.vw_menu_choices_flat
       WHERE menu_id = $1
       ORDER BY choice_name ASC`,
      [menu_id]
    );

    const data = rows.map(r => ({
      menuId: r.menu_id,
      id: r.choice_id,
      name: r.choice_name,
      optionId: r.option_id,
      optionName: r.option_name,
      price: r.option_price !== null ? Number(r.option_price) : null,
      unit: r.unit_name || null,
      limitCount: r.limit_count,
      enableQuantity: r.enable_quantity
    }));

    return ok(res, data);
  } catch (err) {
    console.error('GET builder choices error:', err);
    return fail(res, err);
  }
});

// =========================================================
/*
  0️⃣ Builder: create choice (+ default option) and link
  POST /menus/builder/menus/:menu_id/choices
  Body: { name, price?, unit_id?, option_name? }
*/
// =========================================================
router.post('/builder/menus/:menu_id/choices', async (req, res) => {
  const menu_id = Number(req.params.menu_id);
  if (!Number.isInteger(menu_id) || menu_id <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid menu_id' });
  }

  const { name, price = null, unit_id = null, option_name } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ success: false, error: 'Choice name is required' });
  }

  const normPrice = (price === '' || price === undefined) ? null : Number(price);
  const optName = (option_name && String(option_name).trim()) || name || 'Default';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) choice
    const choiceIns = await client.query(
      `INSERT INTO public.menu_choices (name)
       VALUES ($1)
       RETURNING id`,
      [name]
    );
    const choiceId = choiceIns.rows[0].id;

    // 2) default option (name is NOT NULL in schema)
    await client.query(
      `INSERT INTO public.menu_options (choice_id, name, price, unit_id)
       VALUES ($1, $2, $3, $4)`,
      [choiceId, optName, normPrice, unit_id || null]
    );

    // 3) link (idempotent)
    await client.query(
      `INSERT INTO public.menu_choice_links (menu_id, choice_id)
       VALUES ($1, $2)
       ON CONFLICT (menu_id, choice_id) DO NOTHING`,
      [menu_id, choiceId]
    );

    // 4) fetch flat row
    const flat = await client.query(
      `SELECT
         menu_id, choice_id, choice_name,
         option_id, option_name, option_price, unit_name,
         limit_count, enable_quantity
       FROM public.vw_menu_choices_flat
       WHERE menu_id = $1 AND choice_id = $2
       LIMIT 1`,
      [menu_id, choiceId]
    );

    await client.query('COMMIT');

    const r = flat.rows[0] || {};
    return res.status(201).json({
      success: true,
      data: {
        menuId: r.menu_id ?? menu_id,
        id: r.choice_id ?? choiceId,
        name: r.choice_name ?? name,
        optionId: r.option_id ?? null,
        optionName: r.option_name ?? optName,
        price: r.option_price != null ? Number(r.option_price) : normPrice,
        unit: r.unit_name || null,
        limitCount: r.limit_count ?? null,
        enableQuantity: r.enable_quantity ?? false
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST builder choice error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create choice' });
  } finally {
    client.release();
  }
});
// DELETE /menus/builder/menus/:menu_id/choices/:choice_id
router.delete('/builder/menus/:menu_id/choices/:choice_id', async (req, res) => {
  const menu_id = Number(req.params.menu_id);
  const choice_id = Number(req.params.choice_id);
  if (!Number.isInteger(menu_id) || !Number.isInteger(choice_id) || menu_id <= 0 || choice_id <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid ids' });
  }
  try {
    await pool.query(
      `DELETE FROM public.menu_choice_links WHERE menu_id = $1 AND choice_id = $2`,
      [menu_id, choice_id]
    );
    return res.status(204).end();
  } catch (err) {
    console.error('DELETE unlink choice error:', err);
    return res.status(500).json({ success: false, error: 'Failed to unlink choice' });
  }
});

// POST /menus/builder/menus/:menu_id/link   (link an existing choice by id)
router.post('/builder/menus/:menu_id/link', async (req, res) => {
  const menu_id = Number(req.params.menu_id);
  const { choice_id } = req.body || {};
  if (!Number.isInteger(menu_id) || menu_id <= 0 || !Number.isInteger(choice_id) || choice_id <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid ids' });
  }
  try {
    await pool.query(
      `INSERT INTO public.menu_choice_links (menu_id, choice_id)
       VALUES ($1, $2)
       ON CONFLICT (menu_id, choice_id) DO NOTHING`,
      [menu_id, choice_id]
    );

    const { rows } = await pool.query(
      `SELECT menu_id, choice_id, choice_name, option_id, option_name, option_price, unit_name,
              limit_count, enable_quantity
         FROM public.vw_menu_choices_flat
        WHERE menu_id = $1 AND choice_id = $2
        LIMIT 1`,
      [menu_id, choice_id]
    );

    return res.status(201).json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error('POST link existing choice error:', err);
    return res.status(500).json({ success: false, error: 'Failed to link choice' });
  }
});

// GET /menus/builder/choices/search?q=...&menu_id=123   (simple search; excludes already linked)
router.get('/builder/choices/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const menu_id = Number(req.query.menu_id || 0);

  try {
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE mc.name ILIKE $${params.length}`;
    }

    // exclude already-linked-to-this-menu if menu_id provided
    let exclude = '';
    if (Number.isInteger(menu_id) && menu_id > 0) {
      params.push(menu_id);
      exclude = `${where ? ' AND' : ' WHERE'} NOT EXISTS (
                   SELECT 1 FROM public.menu_choice_links l
                    WHERE l.choice_id = mc.id AND l.menu_id = $${params.length}
                 )`;
    }

    // return a few options too (first option price/unit if any)
    const { rows } = await pool.query(
      `
      SELECT mc.id AS choice_id,
             mc.name AS choice_name,
             mo.id  AS option_id,
             mo.name AS option_name,
             mo.price AS option_price,
             mu.name AS unit_name
        FROM public.menu_choices mc
   LEFT JOIN LATERAL (
             SELECT o.id, o.name, o.price, o.unit_id
               FROM public.menu_options o
              WHERE o.choice_id = mc.id
              ORDER BY o.id ASC
              LIMIT 1
        ) mo ON true
   LEFT JOIN public.menu_units mu ON mu.id = mo.unit_id
       ${where} ${exclude}
       ORDER BY mc.name ASC
       LIMIT 20
      `,
      params
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET search choices error:', err);
    return res.status(500).json({ success: false, error: 'Failed to search choices' });
  }
});

// =========================
// Export router
// =========================
module.exports = router;