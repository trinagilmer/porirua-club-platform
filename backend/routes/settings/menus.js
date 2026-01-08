// backend/routes/settings/menus.js
const express = require('express');
const router = express.Router();
const { pool } = require('../../db');

router.use('/units', require('./menu-units'));
router.use('/choices', require('./menu-choices'));
router.use('/addons', require('./menu-addons'));
router.use('/categories', require('./menu-categories'));

// ======================================================
// Main Menus Page
// ======================================================

// ======================================================
// Menus Overview
// ======================================================
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM menu_categories) AS categories,
        (SELECT COUNT(*)::int FROM menus) AS menus,
        (SELECT COUNT(*)::int FROM menu_choices) AS choices,
        (SELECT COUNT(*)::int FROM menu_units) AS units;
    `);

    res.render('settings/menus', {
      layout: 'layouts/settings',
      title: 'Settings - Menus',
      pageType: 'settings',
      activeTab: 'menus',
      menuCounts: rows[0] || {},
      user: req.session.user || null,
    });
  } catch (err) {
    console.error('??  Error loading menus overview:', err);
    res.status(500).send('Error loading menus');
  }
});

// ======================================================
// Manage Menus
// ======================================================
router.get('/manage', async (req, res) => {
  try {
    const [categoriesRes, menusRes, unitsRes, countsRes] = await Promise.all([
      pool.query('SELECT id, name FROM menu_categories ORDER BY name ASC'),
      pool.query('SELECT * FROM menus ORDER BY name ASC'),
      pool.query('SELECT * FROM menu_units ORDER BY name ASC'),
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM menu_categories) AS categories,
          (SELECT COUNT(*)::int FROM menus) AS menus,
          (SELECT COUNT(*)::int FROM menu_choices) AS choices,
          (SELECT COUNT(*)::int FROM menu_units) AS units;
      `),
    ]);

    res.locals.pageJs = ['/js/settings/menus.js', '/js/settings/menuDrawer.js'];

    res.render('settings/menus-manage', {
      layout: 'layouts/settings',
      title: 'Settings - Manage Menus',
      pageType: 'settings',
      activeTab: 'menus-manage',
      categories: categoriesRes.rows,
      menus: menusRes.rows,
      units: unitsRes.rows,
      menuCounts: countsRes.rows[0] || {},
      user: req.session.user || null,
    });
  } catch (err) {
    console.error('??  Error loading manage menus page:', err);
    res.status(500).send('Error loading menus');
  }
});

// Lightweight API for frontend (quote builder / modals)
router.get('/api', async (_req, res) => {
  try {
    const [categoriesRes, menusRes] = await Promise.all([
      pool.query('SELECT id, name FROM menu_categories ORDER BY name ASC'),
      pool.query(
        `SELECT id, category_id, name, description, price
           FROM menus
          ORDER BY name ASC`
      ),
    ]);

    res.json({
      success: true,
      data: {
        categories: categoriesRes.rows,
        menus: menusRes.rows,
      },
    });
  } catch (err) {
    console.error('⚠️  Error loading menus API:', err);
    res.status(500).json({ success: false, error: 'Failed to load menus.' });
  }
});

router.get('/api/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid menu id.' });
  }
  try {
    const {
      rows,
    } = await pool.query(
      `SELECT m.*,
              c.name AS category_name
         FROM menus m
    LEFT JOIN menu_categories c ON c.id = m.category_id
        WHERE m.id = $1
        LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Menu not found.' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('⚠️  Error loading menu record:', err);
    res.status(500).json({ success: false, error: 'Failed to load menu.' });
  }
});

// ======================================================
// Create category
// ======================================================
router.post('/menu-category', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).send('Name required');
    }
    await pool.query('INSERT INTO menu_categories (name) VALUES ($1)', [name.trim()]);
    res.sendStatus(200);
  } catch (err) {
    console.error('⚠️  Error adding category:', err);
    res.status(500).send('Error adding category');
  }
});

// ======================================================
// Create menu
// ======================================================
router.post('/menu', async (req, res) => {
  try {
    const { category_id, name, description, price } = req.body || {};
    const categoryId = Number(category_id);
    const priceValue =
      price !== undefined && price !== null && price !== ''
        ? Number(price)
        : null;

    if (!Number.isInteger(categoryId) || categoryId <= 0 || !name?.trim()) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing required fields' });
    }

    const {
      rows,
    } = await pool.query(
      `INSERT INTO menus (category_id, name, description, price)
       VALUES ($1, $2, $3, $4)
       RETURNING id, category_id, name, description, price`,
      [categoryId, name.trim(), description || null, priceValue]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('??  Error adding menu:', err);
    res.status(500).json({ success: false, error: 'Error adding menu' });
  }
});

// ======================================================
// Update existing menu
// ======================================================
router.patch('/menu/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { category_id, name, description, price } = req.body || {};
  const categoryId = Number(category_id);
  const priceValue =
    price !== undefined && price !== null && price !== ''
      ? Number(price)
      : null;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid menu id' });
  }
  if (!Number.isInteger(categoryId) || categoryId <= 0 || !name?.trim()) {
    return res
      .status(400)
      .json({ success: false, error: 'Missing required fields' });
  }

  try {
    const {
      rows,
    } = await pool.query(
      `UPDATE menus
          SET category_id = $1,
              name = $2,
              description = $3,
              price = $4
        WHERE id = $5
        RETURNING id, category_id, name, description, price`,
      [categoryId, name.trim(), description || null, priceValue, id]
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, error: 'Menu not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('??  Error updating menu:', err);
    res.status(500).json({ success: false, error: 'Error updating menu' });
  }
});

// ======================================================
// Delete menu
// ======================================================
router.delete('/menu/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).send('Invalid id');
    await pool.query('DELETE FROM menus WHERE id = $1', [id]);
    res.sendStatus(200);
  } catch (err) {
    console.error('⚠️  Error deleting menu:', err);
    res.status(500).send('Error deleting menu');
  }
});

module.exports = router;

