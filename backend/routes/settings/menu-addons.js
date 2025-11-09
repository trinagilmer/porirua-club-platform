// backend/routes/settings/menu-addons.js
const express = require('express');
const router = express.Router();
const { pool } = require('../../db');

const BASE_SELECT = `
  SELECT
    a.id,
    a.menu_id,
    a.name,
    a.price,
    a.optional_cost,
    a.unit_id,
    u.name AS unit_name,
    u.type AS unit_type,
    a.enable_quantity,
    a.default_quantity
  FROM menu_addons a
  LEFT JOIN menu_units u ON u.id = a.unit_id
`;

function toNumber(value, allowNull = true) {
  if (value === undefined || value === null || value === '') return allowNull ? null : 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : allowNull ? null : 0;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

async function fetchAddonById(id) {
  const { rows } = await pool.query(`${BASE_SELECT} WHERE a.id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

// ======================================================
// Get add-ons for a specific menu
// ======================================================
router.get('/:menu_id', async (req, res) => {
  try {
    const menuId = Number(req.params.menu_id);
    if (!Number.isInteger(menuId)) {
      return res.status(400).json({ success: false, error: 'Invalid menu id.' });
    }

    const { rows } = await pool.query(
      `${BASE_SELECT}
       WHERE a.menu_id = $1
       ORDER BY a.id ASC`,
      [menuId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /addons/:menu_id error:', err);
    res.status(500).json({ success: false, error: 'Failed to load add-ons' });
  }
});

// ======================================================
// Create new add-on
// ======================================================
router.post('/', async (req, res) => {
  try {
    const {
      menu_id,
      name,
      price,
      optional_cost,
      unit_id,
      enable_quantity,
      default_quantity,
    } = req.body || {};

    const menuId = Number(menu_id);
    if (!Number.isInteger(menuId) || !name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid input.' });
    }

    const priceVal = toNumber(price);
    const optionalCostVal = toNumber(optional_cost);
    const unitIdVal = toNumber(unit_id);
    const enableQty = toBoolean(enable_quantity);
    const defaultQtyVal = enableQty ? toNumber(default_quantity, false) || 1 : null;

    const { rows } = await pool.query(
      `INSERT INTO menu_addons
         (menu_id, name, price, optional_cost, unit_id, enable_quantity, default_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [menuId, name.trim(), priceVal, optionalCostVal, unitIdVal, enableQty, defaultQtyVal]
    );

    const addon = await fetchAddonById(rows[0].id);
    res.status(201).json({ success: true, data: addon });
  } catch (err) {
    console.error('POST /addons error:', err);
    res.status(500).json({ success: false, error: 'Failed to create add-on' });
  }
});

// ======================================================
// Update add-on
// ======================================================
router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, error: 'Invalid add-on id.' });
    }

    const {
      name,
      price,
      optional_cost,
      unit_id,
      enable_quantity,
      default_quantity,
    } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required.' });
    }

    const priceVal = toNumber(price);
    const optionalCostVal = toNumber(optional_cost);
    const unitIdVal = toNumber(unit_id);
    const enableQty = toBoolean(enable_quantity);
    const defaultQtyVal = enableQty ? toNumber(default_quantity, false) || 1 : null;

    const { rowCount } = await pool.query(
      `UPDATE menu_addons
          SET name = $1,
              price = $2,
              optional_cost = $3,
              unit_id = $4,
              enable_quantity = $5,
              default_quantity = $6,
              updated_at = NOW()
        WHERE id = $7`,
      [name.trim(), priceVal, optionalCostVal, unitIdVal, enableQty, defaultQtyVal, id]
    );

    if (!rowCount) {
      return res.status(404).json({ success: false, error: 'Add-on not found' });
    }

    const addon = await fetchAddonById(id);
    res.json({ success: true, data: addon });
  } catch (err) {
    console.error('PATCH /addons/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to update add-on' });
  }
});

// ======================================================
// Delete add-on
// ======================================================
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, error: 'Invalid add-on id.' });
    }

    const { rowCount } = await pool.query('DELETE FROM menu_addons WHERE id = $1', [id]);
    if (!rowCount) {
      return res.status(404).json({ success: false, error: 'Add-on not found.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /addons/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete add-on' });
  }
});

module.exports = router;

