// backend/routes/settings/menus.js
const express = require('express');
const router = express.Router();
const { pool } = require('../../db');

// ======================================================
// 🔹 Render the Menus Page (menus + linked choices only)
// ======================================================
router.get('/', async (req, res) => {
  try {
    // Fetch menus, categories, and units only
    const [categoriesRes, menusRes, unitsRes] = await Promise.all([
      pool.query('SELECT * FROM menu_categories ORDER BY name'),
      pool.query('SELECT * FROM menus ORDER BY id ASC'),
      pool.query('SELECT * FROM menu_units ORDER BY id ASC')
    ]);

    const categories = categoriesRes.rows;
    const menus = menusRes.rows;
    const units = unitsRes.rows;

    // ✅ Inject only relevant JS files for this page
    res.locals.pageJs = [
      '/js/settings/menus.js',
      '/js/settings/menuDrawer.js'
    ];

    res.render('settings/menus', {
      layout: 'layouts/settings',
      title: 'Settings — Menus',
      pageType: 'settings',
      activeTab: 'menus',
      categories,
      menus,
      units,
      user: req.session.user || null
    });
  } catch (err) {
    console.error('❌ Error loading menus page:', err);
    res.status(500).send('Error loading menus');
  }
});


// ======================================================
// 🧱 CREATE CATEGORY
// ======================================================
router.post('/menu-category', async (req, res) => {
  try {
    const { name } = req.body;
    await pool.query('INSERT INTO menu_categories (name) VALUES ($1)', [name]);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error adding category:', err);
    res.status(500).send('Error adding category');
  }
});

// ======================================================
// 🧾 CREATE MENU
// ======================================================
router.post('/menu', async (req, res) => {
  try {
    const { category_id, name, description, price } = req.body;
    await pool.query(
      `INSERT INTO menus (category_id, name, description, price)
       VALUES ($1, $2, $3, $4)`,
      [category_id, name, description, price]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error adding menu:', err);
    res.status(500).send('Error adding menu');
  }
});

// ======================================================
// ❌ DELETE MENU
// ======================================================
router.delete('/menu/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM menus WHERE id = $1', [req.params.id]);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error deleting menu:', err);
    res.status(500).send('Error deleting menu');
  }
});

module.exports = router;

