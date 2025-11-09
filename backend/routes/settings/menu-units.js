const express = require('express');
const router = express.Router();
const { pool } = require('../../db');

// Render units page
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, type FROM menu_units ORDER BY name ASC');
    res.locals.pageJs = ['/js/settings/menu-units.js'];
    res.render('settings/menu-units', {
      layout: 'layouts/settings',
      title: 'Settings - Sales Units',
      activeTab: 'menu-units',
      units: rows,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error('⚠️  Error loading units page:', err);
    res.status(500).send('Error loading units page');
  }
});

// API: list units
router.get('/api', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, type FROM menu_units ORDER BY name ASC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('⚠️  GET /settings/menus/units/api error:', err);
    res.status(500).json({ success: false, error: 'Failed to load units.' });
  }
});

// API: create unit
router.post('/api', async (req, res) => {
  try {
    const { name, type = 'quantity' } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name required.' });
    }
    const {
      rows: [row],
    } = await pool.query(
      'INSERT INTO menu_units (name, type) VALUES ($1, $2) RETURNING id, name, type',
      [name.trim(), type]
    );
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('⚠️  POST /settings/menus/units/api error:', err);
    res.status(500).json({ success: false, error: 'Failed to create unit.' });
  }
});

// API: update unit
router.patch('/api/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, type } = req.body || {};
    if (!Number.isInteger(id) || id <= 0 || !name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid input.' });
    }
    const {
      rows,
    } = await pool.query(
      'UPDATE menu_units SET name = $1, type = $2 WHERE id = $3 RETURNING id, name, type',
      [name.trim(), type, id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Unit not found.' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('⚠️  PATCH /settings/menus/units/api/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to update unit.' });
  }
});

// API: delete unit
router.delete('/api/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid id.' });
    }
    const { rowCount } = await pool.query(
      'SELECT 1 FROM menu_choices WHERE unit_id = $1 LIMIT 1',
      [id]
    );
    if (rowCount > 0) {
      return res
        .status(400)
        .json({ success: false, error: 'Cannot delete: unit linked to choices.' });
    }
    await pool.query('DELETE FROM menu_units WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('⚠️  DELETE /settings/menus/units/api/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete unit.' });
  }
});

module.exports = router;

