// backend/routes/settings/menu-categories.js
const express = require('express');
const router = express.Router();
const { pool } = require('../../db');


// ======================================================
// 🔹 Render Sales Categories Page
// ======================================================
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM menu_categories ORDER BY name ASC');
    res.locals.pageJs = ['/js/settings/menu-categories.js'];
        res.render('settings/menu-categories', {
         layout: 'layouts/settings',
         title: 'Settings — Sales Categories',
         activeTab: 'menu-categories',
         categories: rows,
         user: req.session.user || null
       });

  } catch (err) {
    console.error('❌ Error loading categories page:', err);
    res.status(500).send('Error loading categories page');
  }
});

// ======================================================
// 🔸 API — Fetch all categories
// ======================================================
router.get('/api', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM menu_categories ORDER BY name ASC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api error:', err);
    res.status(500).json({ success: false, error: 'Failed to load categories' });
  }
});

// ======================================================
// 🔸 API — Create category
// ======================================================
router.post('/api', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    const { rows } = await pool.query(
      'INSERT INTO menu_categories (name) VALUES ($1) RETURNING id, name',
      [name.trim()]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('POST /api error:', err);
    res.status(500).json({ success: false, error: 'Failed to create category' });
  }
});

// ======================================================
// 🔸 API — Rename category
// ======================================================
router.patch('/api/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body || {};
    if (!id || !name) return res.status(400).json({ success: false, error: 'Invalid input' });

    const { rows } = await pool.query(
      'UPDATE menu_categories SET name = $1 WHERE id = $2 RETURNING id, name',
      [name.trim(), id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Category not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('PATCH /api/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to update category' });
  }
});

// ======================================================
// 🔸 API — Delete category
// ======================================================
router.delete('/api/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

    const { rowCount } = await pool.query('SELECT 1 FROM menus WHERE category_id = $1 LIMIT 1', [id]);
    if (rowCount > 0)
      return res.status(400).json({ success: false, error: 'Cannot delete: category has menus linked' });

    await pool.query('DELETE FROM menu_categories WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete category' });
  }
});


module.exports = router;
